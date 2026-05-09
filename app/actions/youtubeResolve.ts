'use server';

import { normalizeYoutubeUrlInput, resolveYoutubeWatchUrl } from '@/lib/youtubeResolve';

/**
 * Used from the Analysis client instead of `fetch('/api/youtube/resolve')`.
 * Avoids browser `fetch` quirks under strict embedder policies (COEP) while doing the same work on Node.
 */
export async function resolveYoutubeForAnalysis(rawUrl: string) {
  const normalized = normalizeYoutubeUrlInput(rawUrl);
  return resolveYoutubeWatchUrl(normalized);
}
