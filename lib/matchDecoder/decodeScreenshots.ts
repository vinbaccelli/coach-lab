'use client';

import { classifyFromText } from '@/lib/matchDecoder/classify';
import { recognizeFullFrame } from '@/lib/matchDecoder/ocr';
import { resetTrace } from '@/lib/matchDecoder/debugTrace';
import { PlayerSlotRegistry, extractPlayerStats } from '@/lib/matchDecoder/extractPlayerStats';
import { extractTimeline } from '@/lib/matchDecoder/extractTimeline';
import { annotateServers, resolveTimelinePlayers, stitchTimeline } from '@/lib/matchDecoder/stitchTimeline';
import type {
  ClassifiedScreenshot,
  MatchDecodeResult,
  PlayerStatBlock,
  TimelineScreenshotResult,
} from '@/lib/matchDecoder/types';

/**
 * Decoder entry point: classify every uploaded screenshot, extract a
 * PlayerStatBlock from each `player_stats` screen (Phase 1) and the games and
 * points from each `timeline` screen (Phase 2), then stitch the timeline
 * captures into one ordered match.
 *
 * WHY SERVER ATTRIBUTION HAPPENS AFTER THE LOOP
 * A game header names only ONE player — the game's winner — so working out who
 * SERVED a break game requires knowing the opponent's name, which may only
 * appear on a later capture. Resolving names per screenshot as they arrive would
 * make attribution depend on upload order. So every capture is read first, the
 * player set is resolved once across all of them, and only then are servers
 * assigned. Same screenshots, any order, same result.
 *
 * `placement_map` screens are classified but not extracted — that is Phase 3.
 */
export async function decodeScreenshotsPhase1(
  files: File[],
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<MatchDecodeResult> {
  resetTrace(); // TEMP-DEBUG-MATCHDECODER
  const images = await Promise.all(files.map((f) => createImageBitmap(f)));
  try {
    const classified: ClassifiedScreenshot[] = [];
    const playerStats: PlayerStatBlock[] = [];
    const timeline: TimelineScreenshotResult[] = [];
    const registry = new PlayerSlotRegistry();

    for (let i = 0; i < images.length; i++) {
      onProgress?.(i, images.length, `Classifying ${files[i].name}…`);
      // ONE full-frame pass per screenshot, shared: it both decides the screen
      // type and provides the positioned tokens that locate each section title.
      const frame = await recognizeFullFrame(images[i], i);
      const c = classifyFromText(frame.rawText, i);
      classified.push(c);

      if (c.type === 'player_stats') {
        onProgress?.(i, images.length, `Reading stats — ${files[i].name}…`);
        playerStats.push(await extractPlayerStats(images[i], i, registry, c, frame.tokens));
      } else if (c.type === 'timeline') {
        onProgress?.(i, images.length, `Reading timeline — ${files[i].name}…`);
        timeline.push(await extractTimeline(images[i], i, frame.tokens));
      }
    }

    onProgress?.(images.length, images.length, 'Stitching timeline…');
    const resolution = resolveTimelinePlayers(timeline);
    annotateServers(timeline, resolution);
    const stitchedTimeline = stitchTimeline(timeline, resolution);

    onProgress?.(images.length, images.length, 'Done');
    return { classified, playerStats, timeline, stitchedTimeline };
  } finally {
    images.forEach((img) => { try { img.close(); } catch { /* already released */ } });
  }
}
