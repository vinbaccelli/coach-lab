/**
 * Download the AI model files WITH a byte counter, so a cold start (a new address, a cleared cache, a phone on
 * mobile data) shows "Downloading AI model… 12 / 41 MB (29 %)" instead of an unexplained wait.
 *
 * The files are fetched through the normal HTTP cache, so when the library later loads the same URL it is served
 * from cache (a conditional request at most) — nothing is downloaded twice. Warm starts finish in milliseconds and
 * the caller shows nothing for them.
 */
export interface PrefetchProgress {
  loaded: number;   // bytes read so far, all files
  total: number;    // bytes expected (sum of the Content-Length that were known)
  pct: number;      // 0–99 while downloading, 100 only when everything finished
  file: string;     // file being read
}

const MB = 1024 * 1024;
export const toMB = (bytes: number) => Math.round((bytes / MB) * 10) / 10;

/** "12.3 / 41.0 MB (30 %)" */
export function formatProgress(p: Pick<PrefetchProgress, 'loaded' | 'total' | 'pct'>): string {
  return p.total > 0 ? `${toMB(p.loaded)} / ${toMB(p.total)} MB (${p.pct}%)` : `${toMB(p.loaded)} MB`;
}

export async function prefetchWithProgress(
  urls: readonly string[],
  onProgress: (p: PrefetchProgress) => void,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  // Expected sizes first (cheap HEAD requests, in parallel); an unknown size just leaves the total smaller.
  const sizes = await Promise.all(urls.map(async (u) => {
    try {
      const r = await f(u, { method: 'HEAD', signal: opts.signal });
      const n = Number(r.headers.get('content-length'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }));
  // A percentage is only honest when EVERY file's size is known; otherwise show megabytes only.
  const allKnown = sizes.every((n) => n > 0);
  let total = allKnown ? sizes.reduce((a, b) => a + b, 0) : 0;
  let loaded = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (opts.signal?.aborted) return;
    const res = await f(url, { signal: opts.signal });
    if (!res.ok) { if (allKnown) total -= sizes[i]; continue; } // never block on a prefetch (the library's own load reports real errors) and don't count bytes that will never arrive
    const reader = res.body?.getReader();
    if (!reader) { const buf = await res.arrayBuffer(); loaded += buf.byteLength; onProgress({ loaded, total, pct: pct(loaded, total), file: url }); continue; }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value?.byteLength ?? 0;
      onProgress({ loaded, total, pct: pct(loaded, total), file: url });
    }
  }
  onProgress({ loaded, total: Math.max(total, loaded), pct: 100, file: '' });
}

/** Compressed files can read more decoded bytes than their Content-Length: never show 100 % early. */
function pct(loaded: number, total: number): number {
  return total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
}

/** First number in "…… 37% …" → 0–100, else null (drives the thin progress bar in the status toast). */
export function percentFromStatus(text: string | null | undefined): number | null {
  const m = /(\d{1,3})\s?%/.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}
