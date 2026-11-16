import { NextResponse } from 'next/server';
import { resolveShare, notAllowed, type Db, type Share } from '@/lib/players/shareAccess';
import { linkUnderHourlyLimit } from '@/lib/players/shareBrake';
import { customIdsOf, validateMeal } from '@/lib/players/nutrition';
import { MEAL_BUCKET, MEAL_COLS, readMealRequest, removeMealPhoto, uploadMealPhoto } from '@/lib/players/mealPhotos';
import { isMissingTable } from '@/lib/db/missingTable';
import { isUuid } from '@/lib/players/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * The player logs a meal through the share link (no login). Server-side checks: a "can add" link
 * with the Meals permission, a valid meal, the hourly brake, `client_ref` against retries. The photo
 * (optional, multipart `file`) goes into the player's meals folder; a photo URL in the body is
 * ignored. The meal waits for the coach's review (status submitted).
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveShare(token, req.headers.get('x-share-email'));
  if ('fail' in r && r.fail) return r.fail;
  const { db, share } = r as { db: Db; share: Share };
  if (share.mode !== 'edit') return NextResponse.json({ error: 'This link is view-only.' }, { status: 403, headers: NO_STORE });
  if (!share.perms.add.meals) return notAllowed('meals');
  const m = await readMealRequest(req);
  if ('fail' in m) return m.fail;
  const { body, file } = m;

  const { data: plans, error: ple } = await db.from('player_nutrition_plans').select('targets').eq('player_id', share.player_id).limit(200);
  if (ple) return isMissingTable(ple) ? NextResponse.json({ error: 'Not available yet.' }, { status: 503, headers: NO_STORE }) : NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  const v = validateMeal({ ...body, photo_url: null }, new Date().toISOString().slice(0, 10), customIdsOf(plans ?? []), { photo: Boolean(file) });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });
  const client_ref = isUuid(body?.client_ref) ? body.client_ref : null;
  const existing = async () => (client_ref
    ? (await db.from('player_meal_logs').select(MEAL_COLS).eq('player_id', share.player_id).eq('client_ref', client_ref).maybeSingle()).data
    : null);
  const before = await existing();
  if (before) return NextResponse.json({ meal: before, duplicate: true }, { headers: NO_STORE });
  if (!(await linkUnderHourlyLimit(db, share))) {
    return NextResponse.json({ error: 'Too many additions in the last hour. Try again later.' }, { status: 429, headers: NO_STORE });
  }
  const bucket = db.storage.from(MEAL_BUCKET);
  const photo_url = file ? await uploadMealPhoto(bucket, share.coach_id, share.player_id, file) : null;
  if (file && !photo_url) return NextResponse.json({ error: 'Could not upload the photo' }, { status: 500, headers: NO_STORE });

  const { data, error } = await db.from('player_meal_logs').insert({
    coach_id: share.coach_id, player_id: share.player_id, ...v.value, photo_url,
    author: 'link', status: 'submitted', client_ref,
  }).select(MEAL_COLS).single();
  if (error) {
    if (photo_url) await removeMealPhoto(bucket, photo_url, share.coach_id, share.player_id);
    const dup = error.code === '23505' ? await existing() : null;
    if (dup) return NextResponse.json({ meal: dup, duplicate: true }, { headers: NO_STORE });
    return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ meal: data }, { headers: NO_STORE });
}
