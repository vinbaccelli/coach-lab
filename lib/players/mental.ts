/**
 * Mental questionnaires, coach assessments and the player's to-do (assignments): pure logic shared
 * by the routes and the pages.
 *
 * Strict access: an ASSESSMENT is filled by the coach about the player and is never sent through a
 * share link. A QUESTIONNAIRE is answered by the player; the player sees their past answers only when
 * the coach lets the link see the Mental section.
 */
export const QUESTION_KINDS = ['scale', 'choice', 'yesno', 'text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export type QKind = 'questionnaire' | 'assessment';
export interface Question {
  id: string;
  kind: QuestionKind;
  label: string;
  min?: number;
  max?: number;
  low?: string;
  high?: string;
  better?: 'higher' | 'lower';
  options?: string[];
}
export type Answer = number | string | boolean;
export type Answers = Record<string, Answer>;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'q';

export const MAX_QUESTIONS = 40;

export function validateQuestions(raw: unknown): Result<Question[]> {
  if (!Array.isArray(raw)) return fail('Add at least one question');
  if (raw.length > MAX_QUESTIONS) return fail(`At most ${MAX_QUESTIONS} questions`);
  const out: Question[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const label = text(o.label, 200);
    if (!label) continue;
    const kind = (QUESTION_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as QuestionKind) : 'text';
    let id = typeof o.id === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(o.id) ? o.id : slug(label);
    for (let i = 2; ids.has(id); i++) id = `${slug(label)}_${i}`;
    ids.add(id);
    const q: Question = { id, kind, label };
    if (kind === 'scale') {
      const min = Number.isInteger(o.min) ? (o.min as number) : 1;
      const max = Number.isInteger(o.max) ? (o.max as number) : 10;
      if (min < 0 || max > 100 || max - min < 1) return fail(`The scale of “${label}” must go from a low to a higher whole number (0 to 100)`);
      q.min = min;
      q.max = max;
      const low = text(o.low, 40);
      const high = text(o.high, 40);
      if (low) q.low = low;
      if (high) q.high = high;
      if (o.better === 'lower') q.better = 'lower';
    }
    if (kind === 'choice') {
      const options = [...new Set((Array.isArray(o.options) ? o.options : []).map((x) => text(x, 60)).filter(Boolean))].slice(0, 12);
      if (options.length < 2) return fail(`“${label}” needs at least two choices`);
      q.options = options;
    }
    out.push(q);
  }
  if (!out.length) return fail('Add at least one question');
  return { ok: true, value: out };
}

export interface QuestionnaireInput { kind: QKind; title: string; description: string; questions: Question[] }
export function validateQuestionnaire(raw: unknown): Result<QuestionnaireInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = text(b.title, 120);
  if (!title) return fail('The questionnaire needs a name');
  const qs = validateQuestions(b.questions);
  if (!qs.ok) return qs;
  return { ok: true, value: { kind: b.kind === 'assessment' ? 'assessment' : 'questionnaire', title, description: text(b.description, 2000), questions: qs.value } };
}

/** Answers checked against the questions: scales whole numbers in range, choices from the list, yes/no, text. */
export function validateAnswers(questions: readonly Question[], raw: unknown): Result<Answers> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Answers = {};
  for (const q of questions) {
    const v = b[q.id];
    if (v === undefined || v === null || v === '') continue;
    if (q.kind === 'scale') {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(n) || n < (q.min ?? 1) || n > (q.max ?? 10)) return fail(`“${q.label}”: choose ${q.min ?? 1} to ${q.max ?? 10}`);
      out[q.id] = n;
    } else if (q.kind === 'choice') {
      if (typeof v !== 'string' || !(q.options ?? []).includes(v)) return fail(`“${q.label}”: choose one of the options`);
      out[q.id] = v;
    } else if (q.kind === 'yesno') {
      if (typeof v !== 'boolean') return fail(`“${q.label}”: answer yes or no`);
      out[q.id] = v;
    } else {
      const t = text(v, 2000);
      if (t) out[q.id] = t;
    }
  }
  if (!Object.keys(out).length) return fail('Answer at least one question');
  return { ok: true, value: out };
}

export function describeAnswer(q: Question, a: Answer | undefined): string {
  if (a === undefined) return '—';
  if (q.kind === 'scale') return `${a} / ${q.max ?? 10}`;
  if (q.kind === 'yesno') return a ? 'Yes' : 'No';
  return String(a);
}

/** The values of each scale question over time (oldest first), for a small trend per question. */
export function scaleTrends(questions: readonly Question[], responses: readonly { answered_on: string; answers: Answers; status?: string }[]) {
  const sorted = [...responses].filter((r) => r.status !== 'needs_revision').sort((a, b) => (a.answered_on < b.answered_on ? -1 : a.answered_on > b.answered_on ? 1 : 0));
  return questions.filter((q) => q.kind === 'scale').map((q) => {
    const points = sorted.filter((r) => typeof r.answers[q.id] === 'number').map((r) => ({ date: r.answered_on, value: r.answers[q.id] as number }));
    const first = points[0]?.value;
    const last = points[points.length - 1]?.value;
    const change = points.length > 1 && first !== undefined && last !== undefined ? last - first : null;
    const improved = change === null || change === 0 ? null : (q.better === 'lower' ? change < 0 : change > 0);
    return { id: q.id, label: q.label, min: q.min ?? 1, max: q.max ?? 10, points, change, improved };
  });
}

// ── Assignments (the player's to-do) ────────────────────────────────────────────────────────────
export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABELS: Record<Recurrence, string> = { none: 'Once', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
export interface AssignmentInput { title: string; description: string; due_on: string | null; recurrence: Recurrence }

export function validateAssignment(raw: unknown): Result<AssignmentInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = text(b.title, 120);
  if (!title) return fail('Give the task a title');
  const due_on = b.due_on === null || b.due_on === undefined || b.due_on === '' ? null : b.due_on;
  if (due_on !== null && !isDate(due_on)) return fail('Choose a valid due date');
  const recurrence = (RECURRENCES as readonly unknown[]).includes(b.recurrence) ? (b.recurrence as Recurrence) : 'none';
  if (recurrence !== 'none' && !due_on) return fail('A repeating task needs a first due date');
  return { ok: true, value: { title, description: text(b.description, 2000), due_on: due_on as string | null, recurrence } };
}

/** The due date of the next occurrence of a repeating task (months keep the day, clamped to the month's end). */
export function nextDue(due: string, recurrence: Recurrence): string | null {
  if (recurrence === 'none' || !isDate(due)) return null;
  const d = new Date(`${due}T00:00:00Z`);
  if (recurrence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (recurrence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

export type AssignmentState = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done' | 'cancelled';
export function assignmentState(a: { status: string; due_on: string | null }, today: string): AssignmentState {
  if (a.status === 'done') return 'done';
  if (a.status === 'cancelled') return 'cancelled';
  if (!a.due_on) return 'no_date';
  if (a.due_on < today) return 'overdue';
  return a.due_on === today ? 'today' : 'upcoming';
}
