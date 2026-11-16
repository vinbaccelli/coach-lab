import { NextResponse } from 'next/server';
import { coachSession, dbError, isUuid, todayYmd } from '@/lib/players/routeKit';
import { customIdsOf, validateMeal } from '@/lib/players/nutrition';
import { MEAL_BUCKET, MEAL_COLS, mealPhotoPath, readMealRequest, removeMealPhoto, uploadMealPhoto } from '@/lib/players/mealPhotos';

export const runtime = 'nodejs';

/**
 * The coach logs a meal. JSON, or multipart with `meal` (JSON) and an optional `file` (photo).
 * `client_ref` (a UUID made by the page per submit) makes a retry return the saved meal.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await coachSession({ write: true });
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const r = await readMealRequest(req);
  if ('fail' in r) return r.fail;
  const { body, file } = r;
  const { data: player, error: pe } = await s.supabase.from('players').select('id').eq('id', id).maybeSingle();
  if (pe) return dbError(pe);
  if (!player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: plans, error: ple } = await s.supabase.from('player_nutrition_plans').select('targets').eq('player_id', id).limit(200);
  if (ple) return dbError(ple);

  const bucket = s.supabase.storage.from(MEAL_BUCKET);
  const keptUrl = mealPhotoPath(bucket, body?.photo_url, s.userId, id) ? (body?.photo_url as string) : null;
  const v = validateMeal(body, todayYmd(), customIdsOf(plans ?? []), { photo: Boolean(file || keptUrl) });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const client_ref = isUuid(body?.client_ref) ? body.client_ref : null;
  if (client_ref) {
    const { data: existing } = await s.supabase.from('player_meal_logs').select(MEAL_COLS).eq('player_id', id).eq('client_ref', client_ref).maybeSingle();
    if (existing) return NextResponse.json({ meal: existing, duplicate: true });
  }
  const photo_url = file ? await uploadMealPhoto(bucket, s.userId, id, file) : keptUrl;
  if (file && !photo_url) return NextResponse.json({ error: 'Could not upload the photo' }, { status: 500 });

  const { data, error } = await s.supabase.from('player_meal_logs')
    .insert({ coach_id: s.userId, player_id: id, ...v.value, photo_url, author: 'coach', status: 'approved', client_ref })
    .select(MEAL_COLS).single();
  if (error) {
    if (file) await removeMealPhoto(bucket, photo_url, s.userId, id);
    if (error.code === '23505' && client_ref) {
      const { data: existing } = await s.supabase.from('player_meal_logs').select(MEAL_COLS).eq('player_id', id).eq('client_ref', client_ref).maybeSingle();
      if (existing) return NextResponse.json({ meal: existing, duplicate: true });
    }
    return dbError(error);
  }
  return NextResponse.json({ meal: data });
}
