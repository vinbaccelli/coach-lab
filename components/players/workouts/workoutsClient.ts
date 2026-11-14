'use client';

import type { DoneItem, Exercise, ExerciseInput, PlannedItem, WorkoutInput } from '@/lib/players/workouts';
export type { DoneItem };
import { newRef } from '@/components/players/ui';

export interface PlannedWorkout { id: string; template_id: string | null; batch_id: string | null; title: string; notes: string; items: PlannedItem[]; scheduled_on: string; status: 'planned' | 'skipped'; updated_at: string }
export interface WorkoutLog {
  id: string; workout_id: string | null; performed_on: string; title: string; items: DoneItem[]; duration_min: number | null; rpe: number | null; notes: string;
  author: 'coach' | 'link'; status: 'submitted' | 'approved' | 'needs_revision'; review_note: string | null; updated_at: string;
}
export interface WorkoutTemplate { id: string; title: string; notes: string; items: PlannedItem[]; updated_at: string }
/** A log as the form sends it (the server validates it again). */
export type LogDraft = Record<string, unknown>;
export type AssignBody = { template_id?: string; title?: string; notes?: string; items?: PlannedItem[]; start: string; weekdays: number[]; weeks: number };

/**
 * How the Workouts section talks to the server. The coach (profile) plans, reviews and manages the
 * library and templates; the player (share link) only reads and logs. A missing function = the
 * control is not shown (and the server refuses it anyway).
 */
export interface WorkoutsClient {
  viewer: 'coach' | 'player';
  load(from: string, to: string): Promise<{ workouts: PlannedWorkout[]; logs: WorkoutLog[]; setupNeeded: boolean; canLog: boolean; toFix: WorkoutLog[] }>;
  saveLog?(draft: LogDraft, opts: { log?: WorkoutLog; workout?: PlannedWorkout }): Promise<void>;
  deleteLog?(log: WorkoutLog): Promise<void>;
  reviewLog?(log: WorkoutLog, status: 'approved' | 'needs_revision', note?: string): Promise<void>;
  library?(): Promise<Exercise[]>;
  saveExercise?(input: ExerciseInput): Promise<Exercise>;
  templates?(): Promise<WorkoutTemplate[]>;
  saveTemplate?(input: WorkoutInput, t?: WorkoutTemplate): Promise<void>;
  deleteTemplate?(t: WorkoutTemplate): Promise<void>;
  assign?(body: AssignBody): Promise<number>;
  updateWorkout?(w: PlannedWorkout, patch: Record<string, unknown>): Promise<void>;
  deleteWorkout?(w: PlannedWorkout, series: boolean): Promise<void>;
}

async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method, cache: 'no-store',
    headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.message ?? data.error ?? `Request failed (${res.status})`));
  return data as T;
}

type LoadResult = { workouts?: PlannedWorkout[]; logs?: WorkoutLog[]; setupNeeded?: boolean; available?: boolean; canLog?: boolean; toFix?: WorkoutLog[] };
let libraryCache: Promise<Exercise[]> | null = null;

export function coachWorkoutsClient(playerId: string, canEdit: boolean): WorkoutsClient {
  const base = `/api/players/${playerId}`;
  const client: WorkoutsClient = {
    viewer: 'coach',
    async load(from, to) {
      const d = await send<LoadResult>(`${base}/workouts?from=${from}&to=${to}`, 'GET');
      return { workouts: d.workouts ?? [], logs: d.logs ?? [], setupNeeded: Boolean(d.setupNeeded), canLog: canEdit && !d.setupNeeded, toFix: [] };
    },
  };
  if (!canEdit) return client;
  return {
    ...client,
    async saveLog(draft, { log, workout }) {
      if (log) await send(`${base}/workout-logs/${log.id}`, 'PATCH', { ...draft, expected_updated_at: log.updated_at });
      else await send(`${base}/workout-logs`, 'POST', { ...draft, workout_id: workout?.id ?? null, client_ref: newRef() });
    },
    async deleteLog(log) { await send(`${base}/workout-logs/${log.id}`, 'DELETE'); },
    async reviewLog(log, status, note) { await send(`${base}/workout-logs/${log.id}`, 'PATCH', { status, review_note: note }); },
    library() {
      libraryCache ??= send<{ exercises?: Exercise[] }>('/api/exercises', 'GET').then((d) => d.exercises ?? []).catch((e) => { libraryCache = null; throw e; });
      return libraryCache;
    },
    async saveExercise(input) {
      const d = await send<{ exercise: Exercise }>('/api/exercises', 'POST', input);
      libraryCache = null;
      return d.exercise;
    },
    async templates() { return (await send<{ templates?: WorkoutTemplate[] }>('/api/workout-templates', 'GET')).templates ?? []; },
    async saveTemplate(input, t) {
      if (t) await send(`/api/workout-templates/${t.id}`, 'PATCH', { ...input, expected_updated_at: t.updated_at });
      else await send('/api/workout-templates', 'POST', input);
    },
    async deleteTemplate(t) { await send(`/api/workout-templates/${t.id}`, 'DELETE'); },
    async assign(body) { return ((await send<{ workouts?: unknown[] }>(`${base}/workouts`, 'POST', body)).workouts ?? []).length; },
    async updateWorkout(w, patch) { await send(`${base}/workouts/${w.id}`, 'PATCH', patch); },
    async deleteWorkout(w, series) { await send(`${base}/workouts/${w.id}${series ? '?series=future' : ''}`, 'DELETE'); },
  };
}

export function playerWorkoutsClient(token: string, headers: () => Record<string, string>): WorkoutsClient {
  const base = `/api/share/${token}`;
  return {
    viewer: 'player',
    async load(from, to) {
      const d = await send<LoadResult>(`${base}/workouts?from=${from}&to=${to}`, 'GET', undefined, headers());
      return { workouts: d.workouts ?? [], logs: d.logs ?? [], setupNeeded: d.available === false, canLog: Boolean(d.canLog), toFix: d.toFix ?? [] };
    },
    async saveLog(draft, { log, workout }) {
      if (log) await send(`${base}/workout-logs/${log.id}`, 'PATCH', draft, headers());
      else await send(`${base}/workout-logs`, 'POST', { ...draft, workout_id: workout?.id ?? null, client_ref: newRef() }, headers());
    },
    async deleteLog(log) { await send(`${base}/workout-logs/${log.id}`, 'DELETE', undefined, headers()); },
  };
}
