/**
 * Blueprint: the definition of each stroke, taken from the AngleMotion eBook ("Tennis Mechanics"),
 * and how a player's technical sheet is checked against it.
 *
 * THE CONNECTION (Vin, 2026-11-19):
 *   Blueprint (the eBook's definition)  ->  the player's choices (which variant he plays)
 *   Blueprint                           ->  the technical sheet: every Fundamentals Check item is marked
 *   player's choices                    ->  one extra check per chosen variant: "is he executing the
 *                                           variant he chose correctly?"
 *
 * Everything here is transcribed from the eBook's own pages: "Part 1: Fundamentals Check" and
 * "Part 2: Your Personal Variants Blueprint" for groundstrokes, "Fundamentals Check — Serve" and
 * "Your Serve Variants Blueprint", "Fundamentals Check — Volleys" and "Your Volley Blueprint".
 * The wording is the book's. Where the book gives a statement and no answer set (the serve),
 * the app's three-state set is used (CHECK_STATE below) and says so.
 *
 * Pure data and functions (no React, no database), so it can be tested. The stored form lives on
 * players.blueprint (jsonb) and is always cleaned by sanitizeBlueprint before it is saved or shown.
 */

import { STROKE_PHASE_DEFINITIONS } from '@/lib/biomechanics/strokePhases';

export const BLUEPRINT_VERSION = 'ebook-1';

export type StrokeKey = 'forehand' | 'two_handed_backhand' | 'one_handed_backhand' | 'serve' | 'volley';
/** `general` = the groundstroke-wide choices the book lists once (stance, timing, slice). */
export type BlueprintScope = StrokeKey | 'general';

export const STROKE_LABELS: Record<BlueprintScope, string> = {
  forehand: 'Forehand',
  two_handed_backhand: 'Two-handed backhand',
  one_handed_backhand: 'One-handed backhand',
  serve: 'Serve',
  volley: 'Volley',
  general: 'Stance, timing and slice (all groundstrokes)',
};

export interface Answer {
  label: string;
  /** The book marks this answer "(error)" or "(problem)": it is a fault to work on. */
  fault?: boolean;
}

export interface Checkpoint {
  id: string;
  /** eBook chapter the item belongs to (C1, G2, S3 …). */
  chapter: string;
  /** One of the stroke's step ids (lib/biomechanics/strokePhases), or null = applies to the whole stroke. */
  stepId: string | null;
  text: string;
  answers: Answer[];
}

export interface VariantOption { id: string; label: string }

export interface VariantGroup {
  id: string;
  label: string;
  chapter?: string;
  stepId: string | null;
  options: VariantOption[];
  /** Every row in the book ends with a blank "Other: ______". */
  allowOther: true;
}

/** The app's answer set where the book gives only a statement to verify. */
export const CHECK_STATE: Answer[] = [{ label: 'OK' }, { label: 'Needs work', fault: true }, { label: 'Not seen' }];
/** Answers for "is he executing the variant he chose correctly?". */
export const EXECUTION_ANSWERS: Answer[] = [{ label: 'Yes' }, { label: 'Partly', fault: true }, { label: 'No', fault: true }];

const A = (label: string, fault = false): Answer => (fault ? { label, fault: true } : { label });
const YN = [A('Yes'), A('No')];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const opts = (...labels: string[]): VariantOption[] => labels.map((label) => ({ id: slug(label), label }));
const V = (id: string, label: string, chapter: string | undefined, stepId: string | null, ...labels: string[]): VariantGroup => ({
  id, label, chapter, stepId, options: opts(...labels), allowOther: true,
});

// ── Fundamentals Check ─────────────────────────────────────────────────────

/** Part 1 of the groundstroke blueprint: the same list serves the forehand and both backhands. */
const GROUND_CHECKS: Checkpoint[] = [
  { id: 'c1-stable', chapter: 'C1', stepId: null, text: 'Grip provides stable control while enabling wrist and forearm whip mechanics?', answers: YN },
  { id: 'c1-trigger', chapter: 'C1', stepId: null, text: 'Trigger finger separation?', answers: [A('Loose'), A('Tight')] },
  { id: 'c1-thickness', chapter: 'C1', stepId: null, text: 'Grip thickness optimized?', answers: [A('Yes'), A('Needs adjustment')] },
  { id: 'g1-airborne', chapter: 'G1', stepId: 'split_step', text: "Airborne at opponent's contact (share of the time)?", answers: [A('95%'), A('75%'), A('50%'), A('25–0%')] },
  { id: 'g1-postserve', chapter: 'G1', stepId: 'split_step', text: 'Post-serve split step consistent?', answers: [A('Yes'), A('50%'), A('Needs development')] },
  { id: 'g2-shoulder', chapter: 'G2', stepId: 'unit_turn', text: 'Front shoulder crosses back shoulder?', answers: [A('Consistently'), A('Inconsistently'), A('Rarely')] },
  { id: 'g2-nondominant', chapter: 'G2', stepId: 'unit_turn', text: 'Non-dominant arm with deliberate position?', answers: YN },
  { id: 'g3-timing', chapter: 'G3', stepId: 'power_position', text: 'Timing consistency — reaching power position at chosen moment?', answers: [A('Yes'), A('Variable')] },
  { id: 'g3-behind', chapter: 'G3', stepId: 'power_position', text: 'Racket positioned behind ball trajectory?', answers: [A('Yes'), A('Not quite')] },
  { id: 'g4-gravity', chapter: 'G4', stepId: 'racket_drop', text: 'Racket drop occurring naturally through gravity?', answers: YN },
  { id: 'g4-hips', chapter: 'G4', stepId: 'racket_drop', text: 'Hips initiating rotation first, shoulders remaining closed?', answers: [A('Yes'), A('Simultaneous', true)] },
  { id: 'g4-wrist', chapter: 'G4', stepId: 'racket_drop', text: 'Wrist relaxed during drop?', answers: [A('Loose'), A('Some tension'), A('Rigid', true)] },
  { id: 'g5-natural', chapter: 'G5', stepId: 'racket_lag', text: 'Lag developing naturally from rotation rather than forced wrist manipulation?', answers: YN },
  { id: 'g5-angle', chapter: 'G5', stepId: 'racket_lag', text: 'Appropriate lag angle (near 90°) achieved?', answers: [A('Yes'), A('High angle 110°+', true)] },
  { id: 'c7-shoulder', chapter: 'C7', stepId: null, text: 'Slice: full shoulder turn (front shoulder crosses back)?', answers: [A('Yes'), A('Arm-only chop', true)] },
  { id: 'c7-wrist', chapter: 'C7', stepId: null, text: 'Slice: firm wrist through contact — no scooping?', answers: YN },
  { id: 'c7-bounce', chapter: 'C7', stepId: null, text: 'Slice bounce stays low and skids?', answers: [A('Yes'), A('Floats and sits up', true)] },
  { id: 'g6-ahead', chapter: 'G6', stepId: 'contact', text: 'Contact consistently 30–40cm ahead of body?', answers: [A('Yes'), A('Usually late', true)] },
  { id: 'g7-follow', chapter: 'G7', stepId: 'extension', text: 'Complete follow-through maintained?', answers: [A('Yes'), A('Cutting short', true)] },
  { id: 'g8-recovery', chapter: 'G8', stepId: 'finish', text: 'Immediate recovery to bisectrix as finish completes?', answers: [A('Yes'), A('Delayed', true)] },
];

const SERVE_CHECKS: Checkpoint[] = [
  { id: 's-grip', chapter: 'CS1', stepId: null, text: 'Grip: your chosen grip allows free forearm pronation — palm rotates fully away from the body after contact. If using eastern forehand grip, note that pronation restriction is a trade-off requiring compensation and carries elevated injury risk.', answers: CHECK_STATE },
  { id: 's-toss', chapter: 'S2', stepId: 'initiation', text: 'Toss synchronization: both arms begin simultaneously, confirmed through shadow serve practice.', answers: CHECK_STATE },
  { id: 's-trophy', chapter: 'S3', stepId: 'trophy', text: 'Trophy position: shoulders closed (front shoulder toward back fence), elbow at shoulder height.', answers: CHECK_STATE },
  { id: 's-drop', chapter: 'S4', stepId: 'racket_drop', text: 'Racket drop: wrist relaxed, racket reaches scratch-the-back naturally via gravity and elbow drive.', answers: CHECK_STATE },
  { id: 's-leg', chapter: 'S5', stepId: 'leg_drive', text: 'Leg drive: both legs contribute actively; landing inside the baseline.', answers: CHECK_STATE },
  { id: 's-pronation', chapter: 'S6', stepId: 'pronation_contact', text: 'Pronation: forearm rotates through contact; palm faces away after contact.', answers: CHECK_STATE },
  { id: 's-extension', chapter: 'S7', stepId: 'extension', text: 'Extension: arm completes full arc across body; not stopped at contact.', answers: CHECK_STATE },
  { id: 's-recovery', chapter: 'S8', stepId: 'landing', text: 'Recovery: split step initiated at landing; position based on serve placement.', answers: CHECK_STATE },
];

const VOLLEY_CHECKS: Checkpoint[] = [
  { id: 'v-grip', chapter: 'CV1', stepId: 'preparation', text: 'Continental grip confirmed — one grip for both sides?', answers: [A('Yes'), A('Still adjusting')] },
  { id: 'v-shoulder', chapter: 'V1', stepId: 'punch_recovery', text: 'Racket in front of hitting shoulder at contact?', answers: [A('Yes'), A('Behind', true)] },
  { id: 'v-elbow', chapter: 'V1', stepId: 'punch_recovery', text: 'Elbow angle at contact?', answers: [A('90° (correct)'), A('Locked (arm too straight)', true), A('Over-bent', true)] },
  { id: 'v-wrist', chapter: 'V1', stepId: 'punch_recovery', text: 'Wrist firm throughout punch?', answers: [A('Yes'), A('Snapping', true)] },
  { id: 'v-split', chapter: 'V1', stepId: 'punch_recovery', text: 'Split step executed after every volley?', answers: [A('Yes'), A('Inconsistent')] },
];

// ── Variants Blueprint ─────────────────────────────────────────────────────

const GENERAL_VARIANTS: VariantGroup[] = [
  V('stance', 'General stance', 'C2', null, 'Use all stances for different situations (recommended)', 'Primarily semi-open and open', 'Predominantly open'),
  V('pp-timing', 'Power position timing', 'G3', 'power_position', 'When ball crosses net (early — Dimitrov/Rune)', 'Before bounce (fluid — Federer/Djokovic)', 'At bounce', 'Delayed after bounce (late — Nadal/Sinner)'),
  V('drop-timing', 'Racket drop timing', 'G4', 'racket_drop', 'Before bounce', 'At bounce', 'After bounce', 'Delayed'),
  V('slice-intent', 'Primary slice intent', 'C7', null, 'Knife slice — penetrating attack/approach', 'Float slice — neutralize and reset', 'Drive slice — aggressive redirect', 'Full spectrum by situation (recommended)'),
  V('slice-wings', 'Slice wings', 'C7', null, 'Backhand slice only', 'Backhand + forehand slice', 'Backhand slice + forehand squash shot for defense'),
];

const DROP_STYLE = (): VariantGroup => V('drop-style', 'Racket drop style', 'G4', 'racket_drop', 'Edge-down (del Potro approach)', 'Face-down (Federer approach)');
const LAG_SETUP = (): VariantGroup => V('lag-setup', 'Racket lag setup', 'G5', 'racket_lag', 'Set up 90° consciously right after drop', 'Let rotation set it up naturally');

const VARIANTS: Record<BlueprintScope, VariantGroup[]> = {
  general: GENERAL_VARIANTS,
  forehand: [
    V('grip', 'Grip', 'C1', null, 'Continental (bevel 2)', 'Eastern (bevel 3)', 'Semi-Western (bevel 4)', 'Western (bevel 5)', 'Hawaiian (bevel 6)'),
    V('arm', 'Arm structure', 'C3', null, 'Straight arm', 'Bent arm — single bent', 'Bent arm — double bent'),
    V('ut-strings', 'Unit turn — strings angle', 'G2', 'unit_turn', 'Forward — strings toward incoming ball', 'Oblique — partially toward floor', 'Parallel sideways', 'Oblique upwards'),
    V('ut-hand', 'Unit turn — non-dominant hand', 'G2', 'unit_turn', 'Holding neck of racket', 'On strings', 'Not touching racket (Rune-style)'),
    DROP_STYLE(),
    LAG_SETUP(),
  ],
  two_handed_backhand: [
    V('lower-hand', 'Lower hand', 'C1', null, 'Continental (bevel 2)', 'Eastern backhand (bevel 1)', 'Between bevels'),
    V('upper-hand', 'Upper hand', 'C1', null, 'Eastern forehand (bevel 6)', 'Semi-Western (bevel 7)'),
    DROP_STYLE(),
    LAG_SETUP(),
  ],
  one_handed_backhand: [
    V('grip', 'Grip', 'C1', null, 'Continental (bevel 2)', 'In between', 'Eastern backhand (bevel 1)', 'Semi-Western (bevel 8)'),
    V('arm', 'Dominant arm', 'C3', null, 'Bent', 'Slightly bent', 'Straight'),
    DROP_STYLE(),
    LAG_SETUP(),
  ],
  serve: [
    V('grip', 'Grip choice', 'CS1', null, 'Continental (bevel 2) — most common, maximum pronation freedom', 'Bevel 1 / Chopper — viable alternative, suits some anatomies', 'Eastern forehand (bevel 3) — restricted pronation; note trade-offs and injury risk', 'Other / between bevels'),
    V('stance', 'Stance', 'S1', 'setup_stance', 'Platform — both feet stationary throughout', 'Pinpoint — back foot draws to front foot during takeback'),
    V('takeback', 'Takeback style', 'S2', 'initiation', 'Simple / pendulum (recommended starting point)', 'Loop (small circle above shoulder)', 'Full loop (behind back)'),
    V('toss-timing', 'Toss contact timing', 'CS3', null, 'At apex (ball stationary)', 'On the rise (ball ascending)', 'Descending (ball falling — demands excellent timing)'),
    V('toss-hold', 'Toss hold style', 'CS3', null, 'Palm-finger concave (most common)', 'Fingertips (Federer — high precision)', 'Full palm (functional but wrist can interfere)'),
    V('first-serve', '1st serve primary type', 'CS2', null, 'Flat (12–1 o\'clock)', 'Slice (2–3 o\'clock)', 'Kick-flat hybrid'),
    V('second-serve', '2nd serve type', 'CS2', null, 'Heavy kick (7–8 o\'clock)', 'Slice (lower risk)', 'Kick-slice combination'),
    V('recovery', 'Recovery pattern', 'S8', 'landing', 'Follow serve placement (wide → recover toward center)', 'Fixed center recovery', 'Serve and volley'),
  ],
  volley: [
    V('net-position', 'Preferred net position', undefined, null, 'Aggressive — close to net service line', 'Middle — between service line and net', 'Conservative — behind service line'),
    V('swing-volley', 'Swing volley contact', 'CV3', null, 'Power position start (full shoulder load)', 'Modified position (compressed)', 'Block/punch only (no swing)'),
  ],
};

const CHECKS: Record<StrokeKey, Checkpoint[]> = {
  forehand: GROUND_CHECKS,
  two_handed_backhand: GROUND_CHECKS,
  one_handed_backhand: GROUND_CHECKS,
  serve: SERVE_CHECKS,
  volley: VOLLEY_CHECKS,
};

export const STROKE_KEYS: StrokeKey[] = ['forehand', 'two_handed_backhand', 'one_handed_backhand', 'serve', 'volley'];
export const SCOPES: BlueprintScope[] = ['general', ...STROKE_KEYS];

export const variantsFor = (scope: BlueprintScope): VariantGroup[] => VARIANTS[scope];
export const checkpointsFor = (stroke: StrokeKey): Checkpoint[] => CHECKS[stroke];

/** Step ids of a stroke, in order (the eBook's eight steps; two for the volley). */
export function stepsFor(stroke: StrokeKey): { id: string; label: string }[] {
  return STROKE_PHASE_DEFINITIONS[stroke].map((d) => ({ id: d.id, label: d.label }));
}

// ── The player's data ──────────────────────────────────────────────────────

/** A chosen option of a variant group, or the coach's own words ("Other"). */
export type VariantChoice = { option: string } | { other: string };

export interface CheckResult {
  answer: string;
  note: string;
  /** YYYY-MM-DD */
  date: string;
  /** For execution checks: the option that was chosen when this was marked, so a later change of choice never rewrites it. */
  against?: string;
}

export interface PlayerBlueprint {
  v: typeof BLUEPRINT_VERSION;
  choices: Partial<Record<BlueprintScope, Record<string, VariantChoice>>>;
  checks: Partial<Record<StrokeKey, Record<string, CheckResult>>>;
}

export const EMPTY_BLUEPRINT: PlayerBlueprint = { v: BLUEPRINT_VERSION, choices: {}, checks: {} };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_NOTE = 1000;
export const MAX_OTHER = 200;

/** Prefix of the id of an execution check: `exec.<scope>.<variantId>`. */
const execId = (scope: BlueprintScope, variantId: string) => `exec.${scope}.${variantId}`;

/** The scopes whose variants a stroke carries: its own, plus the groundstroke-wide ones. */
export function scopesOf(stroke: StrokeKey): BlueprintScope[] {
  return stroke === 'serve' || stroke === 'volley' ? [stroke] : ['general', stroke];
}

/** What the player chose for `variantId` in `scope` (undefined = not chosen yet). */
export function choiceOf(bp: PlayerBlueprint, scope: BlueprintScope, variantId: string): VariantChoice | undefined {
  return bp.choices[scope]?.[variantId];
}

export function choiceLabel(scope: BlueprintScope, variantId: string, c: VariantChoice | undefined): string {
  if (!c) return '';
  if ('other' in c) return c.other;
  return VARIANTS[scope].find((g) => g.id === variantId)?.options.find((o) => o.id === c.option)?.label ?? '';
}

/**
 * The checks the technical sheet shows for a stroke: the eBook's Fundamentals Check, plus one
 * "executing the chosen variant correctly?" check for every variant the player has chosen.
 */
export interface SheetCheck {
  id: string;
  kind: 'fundamental' | 'execution';
  stepId: string | null;
  chapter?: string;
  text: string;
  answers: Answer[];
  /** Execution checks: the chosen option's id (or 'other'), for the snapshot stored with the mark. */
  against?: string;
}

export function sheetChecks(stroke: StrokeKey, bp: PlayerBlueprint): SheetCheck[] {
  const out: SheetCheck[] = CHECKS[stroke].map((c) => ({ id: c.id, kind: 'fundamental', stepId: c.stepId, chapter: c.chapter, text: c.text, answers: c.answers }));
  for (const scope of scopesOf(stroke)) {
    for (const g of VARIANTS[scope]) {
      const c = choiceOf(bp, scope, g.id);
      if (!c) continue;
      const label = choiceLabel(scope, g.id, c);
      out.push({
        id: execId(scope, g.id), kind: 'execution', stepId: g.stepId, chapter: g.chapter,
        text: `Executing the chosen ${g.label.toLowerCase()} correctly: ${label}?`,
        answers: EXECUTION_ANSWERS,
        against: 'other' in c ? 'other' : c.option,
      });
    }
  }
  return out;
}

/** The checks of one step, in sheet order; `null` = the ones that apply to the whole stroke. */
export function checksForStep(stroke: StrokeKey, bp: PlayerBlueprint, stepId: string | null): SheetCheck[] {
  return sheetChecks(stroke, bp).filter((c) => c.stepId === stepId);
}

/** Every answer a check accepts. */
const answerLabels = (c: { answers: Answer[] }) => c.answers.map((a) => a.label);

/** Mark a check (answer must be one the item accepts; an empty answer clears the mark). */
export function setCheck(bp: PlayerBlueprint, stroke: StrokeKey, checkId: string, answer: string, note: string, date: string): PlayerBlueprint {
  const check = sheetChecks(stroke, bp).find((c) => c.id === checkId);
  if (!check) return bp; // not a check of this stroke (or its choice is gone): nothing to mark
  const next = { ...(bp.checks[stroke] ?? {}) };
  if (!answer) {
    delete next[checkId];
  } else if (answerLabels(check).includes(answer) && DATE_RE.test(date)) {
    next[checkId] = { answer, note: note.trim().slice(0, MAX_NOTE), date, ...(check.against ? { against: check.against } : {}) };
  } else {
    return bp;
  }
  return { ...bp, checks: { ...bp.checks, [stroke]: next } };
}

/** Choose (or clear, with null) a variant option for the player. */
export function setChoice(bp: PlayerBlueprint, scope: BlueprintScope, variantId: string, choice: VariantChoice | null): PlayerBlueprint {
  const group = VARIANTS[scope].find((g) => g.id === variantId);
  if (!group) return bp;
  const next = { ...(bp.choices[scope] ?? {}) };
  if (choice === null) {
    delete next[variantId];
  } else if ('other' in choice) {
    const t = choice.other.trim().slice(0, MAX_OTHER);
    if (!t) delete next[variantId]; else next[variantId] = { other: t };
  } else if (group.options.some((o) => o.id === choice.option)) {
    next[variantId] = { option: choice.option };
  } else {
    return bp;
  }
  return { ...bp, choices: { ...bp.choices, [scope]: next } };
}

/** Clean unknown JSON (from the database or a request) into a valid PlayerBlueprint. */
export function sanitizeBlueprint(raw: unknown): PlayerBlueprint {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let bp: PlayerBlueprint = { v: BLUEPRINT_VERSION, choices: {}, checks: {} };
  const choices = (o.choices && typeof o.choices === 'object' ? o.choices : {}) as Record<string, unknown>;
  for (const scope of SCOPES) {
    const g = (choices[scope] && typeof choices[scope] === 'object' ? choices[scope] : {}) as Record<string, unknown>;
    for (const group of VARIANTS[scope]) {
      const c = g[group.id] as { option?: unknown; other?: unknown } | undefined;
      if (!c || typeof c !== 'object') continue;
      if (typeof c.option === 'string') bp = setChoice(bp, scope, group.id, { option: c.option });
      else if (typeof c.other === 'string') bp = setChoice(bp, scope, group.id, { other: c.other });
    }
  }
  const checks = (o.checks && typeof o.checks === 'object' ? o.checks : {}) as Record<string, unknown>;
  for (const stroke of STROKE_KEYS) {
    const m = (checks[stroke] && typeof checks[stroke] === 'object' ? checks[stroke] : {}) as Record<string, unknown>;
    for (const id of Object.keys(m)) {
      const r = m[id] as Partial<CheckResult> | null;
      if (!r || typeof r.answer !== 'string' || typeof r.date !== 'string') continue;
      const before = bp;
      bp = setCheck(bp, stroke, id, r.answer, typeof r.note === 'string' ? r.note : '', r.date);
      // An execution mark keeps the option it was made against, even when the choice has changed since.
      const kept = bp.checks[stroke]?.[id];
      if (kept && bp !== before && typeof r.against === 'string' && id.startsWith('exec.')) kept.against = r.against.slice(0, 60);
    }
  }
  return bp;
}

/** Marks that are faults (the book's "(error)" answers, a "Partly"/"No" execution …), for the summary. */
export function faults(stroke: StrokeKey, bp: PlayerBlueprint): { check: SheetCheck; result: CheckResult }[] {
  const marks = bp.checks[stroke] ?? {};
  const out: { check: SheetCheck; result: CheckResult }[] = [];
  for (const c of sheetChecks(stroke, bp)) {
    const r = marks[c.id];
    if (r && c.answers.find((a) => a.label === r.answer)?.fault) out.push({ check: c, result: r });
  }
  return out;
}

/** How many of a stroke's checks have been marked. */
export function progress(stroke: StrokeKey, bp: PlayerBlueprint): { done: number; total: number } {
  const all = sheetChecks(stroke, bp);
  const marks = bp.checks[stroke] ?? {};
  return { done: all.filter((c) => marks[c.id]).length, total: all.length };
}
