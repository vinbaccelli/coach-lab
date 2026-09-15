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
import { ENABLE_GOOGLE_EXPORTS } from '@/lib/featureFlags';
import { uploadToResumableSession } from '@/lib/export/youtubeResumableUpload';

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
  /**
   * The upload failed only because this coach has no YouTube grant — never
   * connected, or revoked it since. Distinct from `error` on purpose: this is
   * the one failure the coach can fix in two clicks, so the UI offers the
   * connect popup instead of showing them a message they can do nothing with.
   */
  needsConnect?: boolean;
}

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 365;

/**
 * Upload one video blob to the signed-in coach's YouTube channel (Unlisted).
 *
 * Two steps, and the big one does not involve our servers: ask
 * /api/youtube/upload-session for a resumable session URL (that route holds the
 * YouTube credential), then PUT the bytes straight to Google in chunks.
 *
 * The old path POSTed the whole blob to /api/youtube/upload, which Vercel
 * rejected with 413 for anything over 4.5 MB — i.e. every recording longer than
 * a few seconds. Nothing large crosses a lambda now, so there is no size
 * ceiling to hit and no 300s function timeout to race.
 */
export async function uploadVideoToYouTube(
  blob: Blob,
  title: string,
  onProgress?: (fraction: number) => void,
): Promise<{ ok: boolean; url?: string; error?: string; needsConnect?: boolean }> {
  const mimeType = blob.type || 'video/mp4';

  const sessionRes = await fetch('/api/youtube/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, sizeBytes: blob.size, mimeType }),
  });

  // Never assume JSON: an infrastructure-level rejection (413, 502, a proxy
  // error page) has an HTML body, and calling res.json() on it throws — which
  // is how the 413 previously surfaced as an unrelated parse error instead of
  // something the coach could read.
  const sessionBody = (await sessionRes.json().catch(() => ({}))) as {
    uploadUrl?: string;
    error?: string;
    needsConnect?: boolean;
  };

  if (!sessionRes.ok || !sessionBody.uploadUrl) {
    return {
      ok: false,
      error: sessionBody.error ?? `Could not start the YouTube upload (${sessionRes.status}).`,
      needsConnect: sessionBody.needsConnect === true,
    };
  }

  const result = await uploadToResumableSession(sessionBody.uploadUrl, blob, onProgress);
  if (!result.ok || !result.url) {
    return { ok: false, error: result.error ?? 'YouTube upload failed.' };
  }
  return { ok: true, url: result.url };
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

  // 1. Coach's Drive (only when the export scopes are enabled).
  if (ENABLE_GOOGLE_EXPORTS) {
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
  }

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

  let youtubeError: string | undefined;
  let youtubeNeedsConnect = false;

  if (input.videoBlob) {
    progress('Uploading video to YouTube (Unlisted)…');
    const yt = await uploadVideoToYouTube(input.videoBlob, input.title, (f) =>
      progress(`Uploading video to YouTube (Unlisted)… ${Math.round(f * 100)}%`),
    );
    if (yt.ok) {
      youtubeUrl = yt.url;
    } else {
      // A FAILED VIDEO UPLOAD NO LONGER KILLS THE REPORT.
      //
      // This used to `return` here, so one failing YouTube upload silently took
      // the Google Docs export down with it — the coach lost the whole written
      // report because of an unrelated video problem, and the error they saw
      // talked only about YouTube. The report is the more valuable half and it
      // does not depend on the video: carry the failure forward and still write
      // the Doc, just without a video link in it.
      youtubeError = yt.error;
      youtubeNeedsConnect = yt.needsConnect === true;
      progress('Video upload failed — continuing with the report…');
    }
  }

  // Video-only export: there is no report to fall back on, so the upload
  // failure IS the result.
  if (input.skipDoc) {
    if (youtubeError) return { ok: false, error: youtubeError, needsConnect: youtubeNeedsConnect };
    return { ok: true, youtubeUrl };
  }

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
  if (!doc.ok) {
    // Both halves failed — lead with the Doc error (the report is what the
    // coach came for) but do not hide the video failure behind it.
    const error = youtubeError ? `${doc.error} (the video upload also failed: ${youtubeError})` : doc.error;
    return { ok: false, youtubeUrl, error, needsConnect: youtubeNeedsConnect };
  }

  progress('Done');
  // ok:true with an `error` set is deliberate — the Doc exists and the coach
  // should be given its link, but they must still be told the video is missing
  // from it rather than discovering that later.
  return {
    ok: true,
    youtubeUrl,
    docUrl: doc.url,
    error: youtubeError ? `Report created, but the video upload failed: ${youtubeError}` : undefined,
    needsConnect: youtubeNeedsConnect || undefined,
  };
}
