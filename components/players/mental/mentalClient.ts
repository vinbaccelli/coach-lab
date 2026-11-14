'use client';

import type { Answers, QKind, Question, QuestionnaireInput, Recurrence } from '@/lib/players/mental';
import { newRef } from '@/components/players/ui';

export interface PlayerQuestionnaire { id: string; template_id: string | null; kind: QKind; title: string; description: string; questions: Question[]; due_on: string | null; status: 'open' | 'closed'; created_at: string }
export interface QResponse { id: string; questionnaire_id: string; answered_on: string; answers: Answers; author: 'coach' | 'link'; status: 'submitted' | 'approved' | 'needs_revision'; review_note: string | null; created_at: string; updated_at: string }
export interface QTemplate { id: string; coach_id: string | null; slug: string | null; kind: QKind; title: string; description: string; questions: Question[] }
export interface Assignment { id: string; title: string; description: string; due_on: string | null; recurrence: Recurrence; questionnaire_id: string | null; series_id: string | null; status: 'open' | 'done' | 'cancelled'; done_at: string | null; done_by: 'coach' | 'link' | null }

async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { method, cache: 'no-store', headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.message ?? data.error ?? `Request failed (${res.status})`));
  return data as T;
}

/** Questionnaires and assessments of one player; what each viewer may do (missing = not shown, and refused by the server). */
export interface MentalClient {
  viewer: 'coach' | 'player';
  load(): Promise<{ questionnaires: PlayerQuestionnaire[]; responses: QResponse[]; setupNeeded: boolean; canAnswer: boolean; canSee: boolean }>;
  templates?(): Promise<QTemplate[]>;
  saveTemplate?(input: QuestionnaireInput, t?: QTemplate): Promise<void>;
  deleteTemplate?(t: QTemplate): Promise<void>;
  send?(body: { template_id: string; due_on: string | null; add_to_todo: boolean }): Promise<PlayerQuestionnaire>;
  setStatus?(q: PlayerQuestionnaire, status: 'open' | 'closed'): Promise<void>;
  remove?(q: PlayerQuestionnaire): Promise<void>;
  answer?(q: PlayerQuestionnaire, answers: Answers, previous?: QResponse): Promise<void>;
  withdraw?(r: QResponse): Promise<void>;
  review?(r: QResponse, status: 'approved' | 'needs_revision', note?: string): Promise<void>;
}

export function coachMentalClient(playerId: string, canEdit: boolean): MentalClient {
  const base = `/api/players/${playerId}`;
  const client: MentalClient = {
    viewer: 'coach',
    async load() {
      const d = await send<{ questionnaires?: PlayerQuestionnaire[]; responses?: QResponse[]; setupNeeded?: boolean }>(`${base}/mental`, 'GET');
      return { questionnaires: d.questionnaires ?? [], responses: d.responses ?? [], setupNeeded: Boolean(d.setupNeeded), canAnswer: canEdit, canSee: true };
    },
  };
  if (!canEdit) return client;
  return {
    ...client,
    async templates() { return (await send<{ templates?: QTemplate[] }>('/api/questionnaire-templates', 'GET')).templates ?? []; },
    async saveTemplate(input, t) {
      if (t) await send(`/api/questionnaire-templates/${t.id}`, 'PATCH', input);
      else await send('/api/questionnaire-templates', 'POST', input);
    },
    async deleteTemplate(t) { await send(`/api/questionnaire-templates/${t.id}`, 'DELETE'); },
    async send(body) { return (await send<{ questionnaire: PlayerQuestionnaire }>(`${base}/questionnaires`, 'POST', body)).questionnaire; },
    async setStatus(q, status) { await send(`${base}/questionnaires/${q.id}`, 'PATCH', { status }); },
    async remove(q) { await send(`${base}/questionnaires/${q.id}`, 'DELETE'); },
    async answer(q, answers) { await send(`${base}/questionnaire-responses`, 'POST', { questionnaire_id: q.id, answers, client_ref: newRef() }); },
    async withdraw(r) { await send(`${base}/questionnaire-responses/${r.id}`, 'DELETE'); },
    async review(r, status, note) { await send(`${base}/questionnaire-responses/${r.id}`, 'PATCH', { status, review_note: note }); },
  };
}

export function playerMentalClient(token: string, headers: () => Record<string, string>): MentalClient {
  const base = `/api/share/${token}`;
  return {
    viewer: 'player',
    async load() {
      const d = await send<{ questionnaires?: PlayerQuestionnaire[]; responses?: QResponse[]; available?: boolean; canAnswer?: boolean; canSee?: boolean }>(`${base}/mental`, 'GET', undefined, headers());
      return { questionnaires: d.questionnaires ?? [], responses: d.responses ?? [], setupNeeded: d.available === false, canAnswer: Boolean(d.canAnswer), canSee: Boolean(d.canSee) };
    },
    async answer(q, answers, previous) {
      if (previous) await send(`${base}/questionnaire-responses/${previous.id}`, 'PATCH', { answers }, headers());
      else await send(`${base}/questionnaire-responses`, 'POST', { questionnaire_id: q.id, answers, client_ref: newRef() }, headers());
    },
    async withdraw(r) { await send(`${base}/questionnaire-responses/${r.id}`, 'DELETE', undefined, headers()); },
  };
}

/** The player's to-do. */
export interface TodoClient {
  viewer: 'coach' | 'player';
  load(): Promise<{ assignments: Assignment[]; setupNeeded: boolean; canComplete: boolean }>;
  create?(input: { title: string; description: string; due_on: string | null; recurrence: Recurrence }): Promise<void>;
  setStatus?(a: Assignment, status: 'open' | 'done' | 'cancelled'): Promise<void>;
  remove?(a: Assignment): Promise<void>;
  complete?(a: Assignment): Promise<void>;
}

export function coachTodoClient(playerId: string, canEdit: boolean): TodoClient {
  const base = `/api/players/${playerId}/assignments`;
  const client: TodoClient = {
    viewer: 'coach',
    async load() {
      const d = await send<{ assignments?: Assignment[]; setupNeeded?: boolean }>(base, 'GET');
      return { assignments: d.assignments ?? [], setupNeeded: Boolean(d.setupNeeded), canComplete: canEdit };
    },
  };
  if (!canEdit) return client;
  return {
    ...client,
    async create(input) { await send(base, 'POST', input); },
    async setStatus(a, status) { await send(`${base}/${a.id}`, 'PATCH', { status }); },
    async remove(a) { await send(`${base}/${a.id}`, 'DELETE'); },
  };
}

export function playerTodoClient(token: string, headers: () => Record<string, string>): TodoClient {
  return {
    viewer: 'player',
    async load() {
      const d = await send<{ assignments?: Assignment[]; available?: boolean; canComplete?: boolean }>(`/api/share/${token}/todo`, 'GET', undefined, headers());
      return { assignments: d.assignments ?? [], setupNeeded: d.available === false, canComplete: Boolean(d.canComplete) };
    },
    async complete(a) { await send(`/api/share/${token}/todo/${a.id}`, 'POST', {}, headers()); },
  };
}
