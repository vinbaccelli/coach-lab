'use client';

import type { MealLog, NutritionPlan, NutritionPlanInput } from '@/lib/players/nutrition';
import { newRef } from '@/components/players/ui';

/**
 * How the Nutrition section talks to the server. The coach (profile) and the player (share link)
 * use different routes and rights; the section only sees what its viewer may do (a missing
 * function = the control is not shown, and the server refuses it anyway).
 */
export interface NutritionClient {
  viewer: 'coach' | 'player';
  /** `toFix`: the player's meals the coach sent back, whatever their date (player only). */
  load(from: string, to: string): Promise<{ plans: NutritionPlan[]; meals: MealLog[]; setupNeeded: boolean; canLog: boolean; toFix?: MealLog[] }>;
  savePlan?(input: NutritionPlanInput, opts: { plan?: NutritionPlan; replaces?: NutritionPlan }): Promise<void>;
  setPlanStatus?(plan: NutritionPlan, status: NutritionPlan['status']): Promise<void>;
  deletePlan?(plan: NutritionPlan): Promise<void>;
  saveMeal?(draft: Record<string, unknown>, opts: { meal?: MealLog; photo?: Blob | null; removePhoto?: boolean }): Promise<void>;
  deleteMeal?(meal: MealLog): Promise<void>;
  reviewMeal?(meal: MealLog, status: 'approved' | 'needs_revision', note?: string): Promise<void>;
  approveMeals?(ids: string[]): Promise<void>;
}

async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, cache: 'no-store', headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { ...headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.message ?? data.error ?? `Request failed (${res.status})`));
  return data as T;
}

/** A meal as JSON, or multipart (`meal` + `file`) when a new photo comes with it. */
function mealBody(fields: Record<string, unknown>, photo: Blob | null | undefined): unknown {
  if (!photo) return fields;
  const f = new FormData();
  f.append('meal', JSON.stringify(fields));
  f.append('file', new File([photo], 'meal.jpg', { type: 'image/jpeg' }));
  return f;
}

type LoadResult = { plans?: NutritionPlan[]; meals?: MealLog[]; setupNeeded?: boolean; available?: boolean; canLog?: boolean; toFix?: MealLog[] };

export function coachNutritionClient(playerId: string, canEdit: boolean): NutritionClient {
  const base = `/api/players/${playerId}`;
  const client: NutritionClient = {
    viewer: 'coach',
    async load(from, to) {
      const d = await send<LoadResult>(`${base}/nutrition?from=${from}&to=${to}`, 'GET');
      return { plans: d.plans ?? [], meals: d.meals ?? [], setupNeeded: Boolean(d.setupNeeded), canLog: canEdit && !d.setupNeeded };
    },
  };
  if (!canEdit) return client;
  return {
    ...client,
    async savePlan(input, { plan, replaces }) {
      if (plan) await send(`${base}/nutrition/plans/${plan.id}`, 'PATCH', { ...input, expected_updated_at: plan.updated_at });
      else await send(`${base}/nutrition/plans`, 'POST', replaces ? { ...input, replaces: replaces.id, expected_updated_at: replaces.updated_at } : input);
    },
    async setPlanStatus(plan, status) { await send(`${base}/nutrition/plans/${plan.id}`, 'PATCH', { status }); },
    async deletePlan(plan) { await send(`${base}/nutrition/plans/${plan.id}`, 'DELETE'); },
    async saveMeal(draft, { meal, photo, removePhoto }) {
      if (meal) await send(`${base}/meals/${meal.id}`, 'PATCH', mealBody({ ...draft, remove_photo: Boolean(removePhoto), expected_updated_at: meal.updated_at }, photo));
      else await send(`${base}/meals`, 'POST', mealBody({ ...draft, client_ref: newRef() }, photo));
    },
    async deleteMeal(meal) { await send(`${base}/meals/${meal.id}`, 'DELETE'); },
    async reviewMeal(meal, status, note) { await send(`${base}/meals/${meal.id}`, 'PATCH', { status, review_note: note }); },
    async approveMeals(ids) { await send(`${base}/meals/approve`, 'POST', { ids }); },
  };
}

export function playerNutritionClient(token: string, headers: () => Record<string, string>): NutritionClient {
  const base = `/api/share/${token}`;
  return {
    viewer: 'player',
    async load(from, to) {
      const d = await send<LoadResult>(`${base}/nutrition?from=${from}&to=${to}`, 'GET', undefined, headers());
      return { plans: d.plans ?? [], meals: d.meals ?? [], setupNeeded: d.available === false, canLog: Boolean(d.canLog), toFix: d.toFix ?? [] };
    },
    async saveMeal(draft, { meal, photo, removePhoto }) {
      if (meal) await send(`${base}/meals/${meal.id}`, 'PATCH', mealBody({ ...draft, remove_photo: Boolean(removePhoto) }, photo), headers());
      else await send(`${base}/meals`, 'POST', mealBody({ ...draft, client_ref: newRef() }, photo), headers());
    },
    async deleteMeal(meal) { await send(`${base}/meals/${meal.id}`, 'DELETE', undefined, headers()); },
  };
}
