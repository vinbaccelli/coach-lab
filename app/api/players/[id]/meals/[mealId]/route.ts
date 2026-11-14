import { NextResponse } from 'next/server';
import { coachSession, dbError, todayYmd } from '@/lib/players/routeKit';
import { customIdsOf, validateMeal } from '@/lib/players/nutrition';
import { MEAL_BUCKET, MEAL_COLS, readMealRequest, removeMealPhoto, uploadMealPhoto } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';

/**
 * Coach edits or reviews a meal.
 *  - Review: { status: 'approved' | 'needs_revision', review_note? }  (meals the player logged)
 *  - Edit:   the meal (JSON, or multipart with `meal` + `file` for a new photo), `remove_photo`,
 *            `expected_updated_at` (a stale copy gets 409 instead of overwriting).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; mealId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, mealId } = await ctx.params;
  const r = await readMealRequest(req);
  if ('fail' in r) return r.fail;
  const { body, file } = r;
  const { data: cur, error: ce } = await s.supabase.from('player_meal_logs').select('id,photo_url,updated_at').eq('id', mealId).eq('player_id', id).maybeSingle();
  if (ce) return dbError(ce);
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  const bucket = s.supabase.storage.from(MEAL_BUCKET);
  let patch: Record<string, unknown>;
  let uploaded: string | null = null;
  if (!file && (body?.status === 'approved' || body?.status === 'needs_revision')) {
    const note = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 1000) : '';
    if (body.status === 'needs_revision' && !note) return NextResponse.json({ error: 'Say what needs to change' }, { status: 400 });
    patch = { status: body.status, review_note: note || null, reviewed_at: now, updated_at: now };
  } else {
    const { data: plans, error: ple } = await s.supabase.from('player_nutrition_plans').select('targets').eq('player_id', id).limit(200);
    if (ple) return dbError(ple);
    const keep = !body?.remove_photo && Boolean(cur.photo_url);
    const v = validateMeal({ ...body, photo_url: null }, todayYmd(), customIdsOf(plans ?? []), { photo: Boolean(file) || keep });
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    if (file) {
      uploaded = await uploadMealPhoto(bucket, s.userId, id, file);
      if (!uploaded) return NextResponse.json({ error: 'Could not upload the photo' }, { status: 500 });
    }
    patch = { ...v.value, photo_url: uploaded ?? (keep ? cur.photo_url : null), updated_at: now };
  }
  let q = s.supabase.from('player_meal_logs').update(patch).eq('id', mealId).eq('player_id', id);
  if (typeof body?.expected_updated_at === 'string') q = q.eq('updated_at', body.expected_updated_at);
  const { data, error } = await q.select(MEAL_COLS);
  if (error || !data?.length) {
    if (uploaded) await removeMealPhoto(bucket, uploaded, s.userId, id);
    if (error) return dbError(error);
    return NextResponse.json({ error: 'This meal was changed somewhere else. Reload and try again.' }, { status: 409 });
  }
  // The photo this replaced or removed goes too (only when it is one of ours).
  if (cur.photo_url && data[0].photo_url !== cur.photo_url) await removeMealPhoto(bucket, cur.photo_url, s.userId, id);
  return NextResponse.json({ meal: data[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; mealId: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id, mealId } = await ctx.params;
  const { data, error } = await s.supabase.from('player_meal_logs').delete().eq('id', mealId).eq('player_id', id).select('id,photo_url');
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await removeMealPhoto(s.supabase.storage.from(MEAL_BUCKET), data[0].photo_url, s.userId, id);
  return NextResponse.json({ ok: true });
}
