/**
 * Browser-side resumable upload to YouTube.
 *
 * The bytes go STRAIGHT from the page to Google. Nothing large crosses our
 * serverless functions, which is what makes this immune to the 4.5 MB Vercel
 * request-body limit that made every real recording fail with 413. The server's
 * only job is minting the session URL (app/api/youtube/upload-session), because
 * that is the step that needs the YouTube credential.
 *
 * Protocol (Google resumable upload):
 *   - PUT each chunk with `Content-Range: bytes <start>-<end>/<total>`
 *   - 308 Resume Incomplete  → more to send; the `Range` response header is the
 *     AUTHORITATIVE record of what Google actually stored, so the next offset is
 *     read from it rather than assumed
 *   - 200 / 201              → finished; the body is the video resource
 *   - 5xx or a network drop  → retry that chunk with backoff, after asking
 *     Google where it got to (`Content-Range: bytes *\/<total>`)
 *   - 4xx (other than 308)   → fatal; the session is dead, do not retry
 */

/**
 * Google requires every chunk except the last to be a multiple of 256 KiB.
 * 8 MiB keeps the request count low on a long recording without making a single
 * retry expensive on a poor connection.
 */
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES_PER_CHUNK = 5;

export interface ResumableUploadResult {
  ok: boolean;
  videoId?: string;
  url?: string;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask Google how much of the file it has. Returns the next byte offset to send,
 * or -1 when the upload is in fact already complete.
 */
async function queryUploadOffset(uploadUrl: string, total: number): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}` },
  });
  if (res.status === 200 || res.status === 201) return -1; // already done
  if (res.status === 308) {
    const range = res.headers.get('range');
    // No Range header means Google has stored nothing yet — start from zero.
    if (!range) return 0;
    const end = Number(range.split('-')[1]);
    return Number.isFinite(end) ? end + 1 : 0;
  }
  throw new Error(`Upload session is no longer valid (${res.status}).`);
}

/**
 * Uploads `blob` to an already-minted resumable session URL.
 * `onProgress` receives 0..1.
 */
export async function uploadToResumableSession(
  uploadUrl: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<ResumableUploadResult> {
  const total = blob.size;
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = blob.slice(offset, end);

    let attempt = 0;
    let sent = false;

    while (!sent) {
      try {
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
          body: chunk,
        });

        if (res.status === 200 || res.status === 201) {
          onProgress?.(1);
          const data = (await res.json().catch(() => ({}))) as { id?: string };
          if (!data.id) return { ok: false, error: 'YouTube accepted the upload but returned no video id.' };
          return { ok: true, videoId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
        }

        if (res.status === 308) {
          // Trust Google's Range over our own arithmetic: a chunk can be
          // partially stored, and assuming otherwise corrupts the upload.
          const range = res.headers.get('range');
          const confirmedEnd = range ? Number(range.split('-')[1]) : NaN;
          offset = Number.isFinite(confirmedEnd) ? confirmedEnd + 1 : end;
          sent = true;
          onProgress?.(offset / total);
          break;
        }

        // Server-side trouble is worth retrying; anything else is fatal.
        if (res.status >= 500) throw new Error(`YouTube returned ${res.status}`);
        const detail = await res.text().catch(() => '');
        return {
          ok: false,
          error: `YouTube rejected the upload (${res.status}). ${detail.slice(0, 200)}`.trim(),
        };
      } catch (e) {
        attempt += 1;
        if (attempt > MAX_RETRIES_PER_CHUNK) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : 'The upload failed after several retries.',
          };
        }
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 16_000));
        // Re-sync with Google before resending — it may have stored part of the
        // chunk that appeared to fail, and resending from the wrong offset is
        // exactly how a resumable upload ends up corrupt.
        try {
          const resumeAt = await queryUploadOffset(uploadUrl, total);
          if (resumeAt === -1) {
            // Completed on an attempt whose response we never saw.
            onProgress?.(1);
            return { ok: false, error: 'Upload finished but YouTube did not return the video id — check your channel.' };
          }
          offset = resumeAt;
        } catch (probeErr) {
          return {
            ok: false,
            error: probeErr instanceof Error ? probeErr.message : 'Lost the upload session.',
          };
        }
      }
    }
  }

  // Ran past the end without a 200/201 — the final chunk's response was the
  // completion signal and we should never get here.
  return { ok: false, error: 'Upload ended without confirmation from YouTube.' };
}
