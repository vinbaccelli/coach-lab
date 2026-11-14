import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { customIdsOf, playerCanChangeMeal, validateMeal } from '@/lib/players/nutrition';
import { MEAL_BUCKET, MEAL_COLS, readMealRequest, removeMealPhoto, uploadMealPhoto } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const forbidden = () => NextResponse.json({ error: 'Only your meals waiting for review can be changed.' }, { status: 403, headers: NO_STORE });
const reviewed = () => NextResponse.json({ error: 'This meal was reviewed in the meantime. Reload the page.' }, { status: 409, headers: NO_STORE });

/**
 * The player's own meals (author = link) can be corrected or removed only until the coach approved
 * them. Coach meals and approved meals are the coach's history: not changeable through the link.
 */
async function ownPendingMeal(req: Request, token: string, mealId: string) {
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return { fail: r.fail };
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return { fail: NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE }) };
  if (!share.perms.add.meals) return { fail: notAllowed('meals') };
  const { data: meal } = await db.from('player_meal_logs').select('id,author,status,photo_url').eq('id', mealId).eq('player_id', share.player_id).maybeSingle();
  if (!meal) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  if (!playerCanChangeMeal(meal)) return { fail: forbidden() };
  return { db, share, meal };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string; mealId: string }> }) {
  const { token, mealId } = await ctx.params;
  const own = await ownPendingMeal(req, token, mealId);
  if ('fail' in own) return own.fail;
  const { db, share, meal } = own;
  const m = await readMealRequest(req);
  if ('fail' in m) return m.fail;
  const { body, file } = m;
  const { data: plans } = await db.from('player_nutrition_plans').select('targets').eq('player_id', share.player_id).limit(200);
  const keep = !body?.remove_photo && Boolean(meal.photo_url);
  const v = validateMeal({ ...body, photo_url: null }, new Date().toISOString().slice(0, 10), customIdsOf(plans ?? []), { photo: Boolean(file) || keep });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const bucket = db.storage.from(MEAL_BUCKET);
  const uploaded = file ? await uploadMealPhoto(bucket, share.coach_id, share.player_id, file) : null;
  if (file && !uploaded) return NextResponse.json({ error: 'Could not upload the photo' }, { status: 500, headers: NO_STORE });
  // A corrected meal goes back to the coach for review.
  const { data, error } = await db.from('player_meal_logs')
    .update({ ...v.value, photo_url: uploaded ?? (keep ? meal.photo_url : null), status: 'submitted', review_note: null, updated_at: new Date().toISOString() })
    .eq('id', mealId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved')
    .select(MEAL_COLS);
  if (error || !data?.length) {
    if (uploaded) await removeMealPhoto(bucket, uploaded, share.coach_id, share.player_id);
    return error ? NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE }) : reviewed();
  }
  if (meal.photo_url && data[0].photo_url !== meal.photo_url) await removeMealPhoto(bucket, meal.photo_url, share.coach_id, share.player_id);
  return NextResponse.json({ meal: data[0] }, { headers: NO_STORE });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string; mealId: string }> }) {
  const { token, mealId } = await ctx.params;
  const own = await ownPendingMeal(req, token, mealId);
  if ('fail' in own) return own.fail;
  const { db, share, meal } = own;
  const { data, error } = await db.from('player_meal_logs').delete()
    .eq('id', mealId).eq('player_id', share.player_id).eq('author', 'link').neq('status', 'approved').select('id');
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500, headers: NO_STORE });
  if (!data?.length) return reviewed();
  await removeMealPhoto(db.storage.from(MEAL_BUCKET), meal.photo_url, share.coach_id, share.player_id);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
