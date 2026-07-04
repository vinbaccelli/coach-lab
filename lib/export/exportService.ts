/**
 * ExportService — the one export pipeline shared by Metrics and StroMotion.
 *
 *   Render (caller supplies blobs/data-urls)
 *     → upload video to the coach's YouTube (Unlisted)
 *     → upload report images to Supabase storage (signed URLs for Docs)
 *     → create the formatted Google Docs report (link auto-inserted)
 *
 * The coach never opens YouTube or copies links manually. All steps are
 * best-effort composable: video-only, doc-only, or the full chain.
 */
import { uploadDataUrl } from '@/lib/supabase/storage';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export interface ReportSectionInput {
  heading: string;
  /** PNG data URL (uploaded to storage automatically) or an already-public URL. */
  image?: string;
  lines?: string[];
  notes?: string;
}

/** Structured measurement stored with the player entry (drives Statistics). */
export interface ReportMeasurement {
  snapshot: string;
  label: string;
  value: number;
  unit: string;
  timeSec: number;
}

export interface ExportPipelineInput {
  title: string;
  /** Final rendered video. When present it is uploaded to YouTube (Unlisted). */
  videoBlob?: Blob | null;
  /** Report sections (per snapshot / per render). */
  sections: ReportSectionInput[];
  intro?: string;
  settingsLines?: string[];
  /** Attach the report to a player (files the Doc + updates the Timeline Doc). */
  playerId?: string | null;
  /** Structured measurements saved on the player entry for Statistics. */
  measurements?: ReportMeasurement[];
  /** Skip the Docs step (video-only export). */
  skipDoc?: boolean;
  onProgress?: (step: string) => void;
}

export interface ExportPipelineResult {
  ok: boolean;
  youtubeUrl?: string;
  docUrl?: string;
  error?: string;
}

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 365;

/** Upload one video blob to the signed-in coach's YouTube channel (Unlisted). */
export async function uploadVideoToYouTube(
  blob: Blob,
  title: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const form = new FormData();
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('video', new File([blob], `anglemotion-${Date.now()}.${ext}`, { type: blob.type || 'video/mp4' }));
  form.append('title', title);
  const res = await fetch('/api/youtube/upload', { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) return { ok: false, error: body.error ?? `YouTube upload failed (${res.status})` };
  return { ok: true, url: body.url };
}

/**
 * Store a report image and return a URL Docs can embed.
 *
 * Primary: the COACH'S OWN Google Drive (bring-your-own-cloud — zero storage
 * cost on our side). Fallback: Supabase storage signed URL, so exports still
 * work if Drive is temporarily unavailable.
 */
export async function dataUrlToSignedUrl(dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith('data:')) return dataUrl; // already a URL

  // 1. Coach's Drive.
  try {
    const res = await fetch('/api/google/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    if (res.ok) {
      const body = (await res.json()) as { url?: string };
      if (body.url) return body.url;
    }
  } catch { /* fall through to Supabase */ }

  // 2. Supabase fallback.
  const supabase = createSupabaseBrowserClient();
  const userRes = await supabase?.auth.getUser();
  const userId = userRes?.data?.user?.id;
  if (!supabase || !userId) return null;
  const path = await uploadDataUrl(
    'analysis-screenshots',
    `${userId}/report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
    dataUrl,
  );
  if (!path) return null;
  const { data: signed } = await supabase.storage
    .from('analysis-screenshots')
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  return signed?.signedUrl ?? null;
}

/** Create the formatted Google Docs report via /api/google/report. */
export async function createDocsReport(payload: {
  title: string;
  playerId?: string | null;
  youtubeUrl?: string;
  intro?: string;
  settingsLines?: string[];
  sections: Array<{ heading: string; imageUrl?: string; lines?: string[]; notes?: string }>;
  measurements?: ReportMeasurement[];
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  const res = await fetch('/api/google/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, playerId: payload.playerId ?? undefined }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) return { ok: false, error: body.error ?? `Docs export failed (${res.status})` };
  return { ok: true, url: body.url };
}

/** Full chain: video → YouTube → Docs report with the link auto-inserted. */
export async function runExportPipeline(input: ExportPipelineInput): Promise<ExportPipelineResult> {
  const progress = input.onProgress ?? (() => {});
  let youtubeUrl: string | undefined;

  if (input.videoBlob) {
    progress('Uploading video to YouTube (Unlisted)…');
    const yt = await uploadVideoToYouTube(input.videoBlob, input.title);
    if (!yt.ok) return { ok: false, error: yt.error };
    youtubeUrl = yt.url;
  }

  if (input.skipDoc) return { ok: true, youtubeUrl };

  progress('Preparing report images…');
  const sections: Array<{ heading: string; imageUrl?: string; lines?: string[]; notes?: string }> = [];
  for (const s of input.sections) {
    let imageUrl: string | undefined;
    if (s.image) {
      const url = await dataUrlToSignedUrl(s.image);
      if (url) imageUrl = url; // image upload failure degrades to text-only section
    }
    sections.push({ heading: s.heading, imageUrl, lines: s.lines, notes: s.notes });
  }

  progress('Creating Google Docs report…');
  const doc = await createDocsReport({
    title: input.title,
    playerId: input.playerId,
    youtubeUrl,
    intro: input.intro,
    settingsLines: input.settingsLines,
    sections,
    measurements: input.measurements,
  });
  if (!doc.ok) return { ok: false, youtubeUrl, error: doc.error };

  progress('Done');
  return { ok: true, youtubeUrl, docUrl: doc.url };
}
