/**
 * Helpers for uploading CoachLab assets to Supabase Storage.
 */
import { createSupabaseBrowserClient } from './browser';

/** Upload a data URL to Supabase Storage. Returns the public/signed path or null on failure. */
export async function uploadDataUrl(
  bucket: string,
  path: string,
  dataUrl: string,
): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;

  // Convert data URL to Blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: blob.type || 'image/png',
    upsert: true,
  });

  if (error) {
    console.error('Supabase Storage upload error:', error.message);
    return null;
  }

  return path;
}

/** Insert a row into analysis_screenshots and upload the image. Returns the record id or null. */
export async function saveAnalysisScreenshot(
  dataUrl: string,
  opts: { userId: string; playerId?: string; caption?: string },
): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;

  const filename = `${opts.userId}/${Date.now()}.png`;
  const uploaded = await uploadDataUrl('analysis-screenshots', filename, dataUrl);
  if (!uploaded) return null;

  const { data, error } = await supabase
    .from('analysis_screenshots')
    .insert({
      user_id: opts.userId,
      player_id: opts.playerId ?? null,
      image_path: uploaded,
      caption: opts.caption ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase insert error:', error.message);
    return null;
  }

  return data?.id ?? null;
}

/** Upload a frame capture for Frame Metrics and insert into frame_metrics_captures. */
export async function saveFrameMetricsCapture(
  sessionId: string,
  frameIndex: number,
  timeSec: number,
  label: string,
  dataUrl: string,
  notes: string,
  userId: string,
): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;

  const filename = `${userId}/${sessionId}/${frameIndex}-${Date.now()}.png`;
  const uploaded = await uploadDataUrl('frame-metrics-captures', filename, dataUrl);
  if (!uploaded) return null;

  const { data, error } = await supabase
    .from('frame_metrics_captures')
    .insert({
      session_id: sessionId,
      frame_index: frameIndex,
      time_sec: timeSec,
      label,
      image_path: uploaded,
      notes,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase insert error:', error.message);
    return null;
  }

  return data?.id ?? null;
}
