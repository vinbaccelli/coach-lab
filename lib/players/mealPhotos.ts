import { NextResponse } from 'next/server';

/**
 * Meal requests and meal photos (server only, shared by the coach and share-link routes).
 *
 * A meal is sent as JSON, or as multipart with a `meal` JSON field and an optional `file` (the
 * photo, shrunk by the page). The photo goes into the player's meals folder of the public
 * `player-assets` bucket ({coach_id}/{player_id}/meals/<uuid>.<ext>, the same folder rule as the
 * other player pictures). A photo URL that is not one of ours is never stored, and a replaced or
 * deleted meal also removes its photo.
 */
export const MEAL_BUCKET = 'player-assets';
const MAX_BYTES = 3 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The part of a storage bucket API these helpers use (user-scoped or service client). */
export type Bucket = {
  upload: (path: string, body: Blob, opts: { contentType: string }) => Promise<{ error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<unknown>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

export async function readMealRequest(req: Request): Promise<{ body: Record<string, unknown> | null; file: File | null } | { fail: Response }> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.startsWith('multipart/form-data')) {
    return { body: (await req.json().catch(() => null)) as Record<string, unknown> | null, file: null };
  }
  const form = await req.formData().catch(() => null);
  if (!form) return { fail: NextResponse.json({ error: 'Could not read the form' }, { status: 400 }) };
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(String(form.get('meal') ?? 'null')) as unknown;
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const f = form.get('file');
  if (f === null) return { body, file: null };
  if (!(f instanceof File) || !EXT[f.type]) return { fail: NextResponse.json({ error: 'Choose a JPEG, PNG or WebP picture' }, { status: 400 }) };
  if (f.size > MAX_BYTES) return { fail: NextResponse.json({ error: 'Picture is too large' }, { status: 413 }) };
  return { body, file: f };
}

const folder = (coachId: string, playerId: string) => `${coachId}/${playerId}/meals/`;

/** Upload a meal photo; its public URL, or null when the upload failed. */
export async function uploadMealPhoto(bucket: Bucket, coachId: string, playerId: string, file: File): Promise<string | null> {
  const path = `${folder(coachId, playerId)}${crypto.randomUUID()}.${EXT[file.type] ?? 'jpg'}`;
  const up = await bucket.upload(path, file, { contentType: file.type });
  if (up.error) return null;
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** The storage path of one of this player's meal photos, or null when the URL is not one of ours. */
export function mealPhotoPath(bucket: Bucket, url: unknown, coachId: string, playerId: string): string | null {
  if (typeof url !== 'string') return null;
  const prefix = bucket.getPublicUrl(`${folder(coachId, playerId)}x`).data.publicUrl.slice(0, -1);
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name) ? `${folder(coachId, playerId)}${name}` : null;
}

export async function removeMealPhoto(bucket: Bucket, url: unknown, coachId: string, playerId: string): Promise<void> {
  const path = mealPhotoPath(bucket, url, coachId, playerId);
  if (path) await bucket.remove([path]).catch(() => undefined);
}

/** Columns a meal is returned with. */
export const MEAL_COLS = 'id,eaten_on,eaten_at,category,description,calories,protein_g,carbs_g,fat_g,extras,photo_url,note,author,status,review_note,created_at,updated_at';
export const PLAN_COLS = 'id,player_id,title,starts_on,ends_on,status,targets,meals,notes,previous_id,created_at,updated_at';
