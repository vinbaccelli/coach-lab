/**
 * Media Layer — dual-source video identity, decoupled from analysis state.
 *
 * A MediaAsset represents one uploaded video with two possible sources:
 *   - localUrl  : ephemeral blob URL for instant playback during upload
 *   - remoteUrl : persistent Supabase URL (survives reload)
 *
 * Snapshots reference a MediaAsset by `mediaId` only — they never store blob
 * URLs, local URLs, or upload state. Playback always resolves the best
 * available source via `getVideoSource`.
 *
 * Scope: in-session correctness. Cross-session reload restore is P0-1
 * (snapshot persistence), which will read `remoteUrl` to rehydrate.
 */

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export type MediaAssetStatus = 'uploading' | 'ready' | 'failed';

export interface MediaAsset {
  id: string;
  localUrl: string | null;   // blob URL — instant playback, never persisted
  remoteUrl: string | null;  // Supabase signed URL — persistent
  status: MediaAssetStatus;
  metadata?: {
    duration?: number;
    fps?: number;
    size?: number;
  };
}

const VIDEO_BUCKET = 'player-videos';
let mediaCounter = 0;

/** Create an in-progress MediaAsset from a freshly selected file. */
export function makeMediaAsset(localUrl: string, size?: number): MediaAsset {
  mediaCounter += 1;
  return {
    id: `media-${Date.now()}-${mediaCounter}`,
    localUrl,
    remoteUrl: null,
    status: 'uploading',
    metadata: size != null ? { size } : undefined,
  };
}

/**
 * Playback resolution rule: always prefer the persistent remote source, fall
 * back to the local blob during upload, else null. Never blocks playback.
 */
export function getVideoSource(asset: MediaAsset | null): string | null {
  if (!asset) return null;
  return asset.remoteUrl ?? asset.localUrl ?? null;
}

/**
 * Upload the video file to Supabase Storage in the background and return a
 * persistent signed URL. Caller updates the MediaAsset to `ready` on success
 * or `failed` on error (keeping localUrl as the fallback).
 *
 * Requires a `player-videos` storage bucket.
 */
export async function uploadMediaAsset(
  file: File,
  userId: string,
): Promise<{ ok: true; remoteUrl: string } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  const ext = file.name.split('.').pop() || 'mp4';
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(path, file, { contentType: file.type || 'video/mp4', upsert: true });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: signed, error: signErr } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed?.signedUrl) return { ok: false, error: signErr?.message || 'Failed to sign URL' };

  return { ok: true, remoteUrl: signed.signedUrl };
}
