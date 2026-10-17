/**
 * Metrics → Generate video export: quality presets and the size estimate
 * (pure; the panel is components/metrics/MetricsExportPanel.tsx, the render is
 * lib/cropExport.ts exportEditedVideo).
 *
 * The estimate is the recorder's TARGET bitrate times the trimmed duration, so
 * it is approximate: MediaRecorder treats the bitrate as a target, not a cap.
 */

export type ExportQuality = '720p' | '1080p' | 'original';

/** Audio bitrate the export asks the recorder for (lib/cropExport.ts default). */
export const EXPORT_AUDIO_BPS = 128_000;

/** Video bitrate per preset tier (bits per second). */
export const TIER_VIDEO_BPS = {
  '720p': 4_000_000,
  '1080p': 8_000_000,
  above1080p: 16_000_000,
} as const;

export type ExportQualityOption = {
  id: ExportQuality;
  label: string;
  /** Output frame size (even numbers, as the encoder needs). */
  width: number;
  height: number;
  /** What to pass to exportEditedVideo as `maxHeight` (null = keep the source size). */
  maxHeight: number | null;
  videoBitsPerSecond: number;
  /** True when the preset would upscale the source. */
  disabled: boolean;
};

function even(n: number): number {
  const v = Math.max(0, Math.round(n));
  return v - (v % 2);
}

/**
 * The output size for a `maxHeight` cap: the source size (even) when it already
 * fits, else scaled to `maxHeight` with the aspect kept. lib/cropExport.ts uses
 * this same function, so the panel shows exactly what the render produces.
 */
export function scaledExportSize(width: number, height: number, maxHeight?: number | null): { width: number; height: number } {
  const w = even(width);
  const h = even(height);
  if (!maxHeight || !(maxHeight > 0) || h <= maxHeight || h < 2) return { width: w, height: h };
  const outH = Math.max(2, even(maxHeight));
  return { width: Math.max(2, even((w * outH) / h)), height: outH };
}

/** Video bitrate for the source's own size: the tier its short side falls in. */
export function originalVideoBps(width: number, height: number): number {
  const short = Math.min(width, height);
  if (short > 1080) return TIER_VIDEO_BPS.above1080p;
  if (short > 720) return TIER_VIDEO_BPS['1080p'];
  return TIER_VIDEO_BPS['720p'];
}

/**
 * The three presets for a source of `width`×`height`. "720p"/"1080p" name the
 * SHORT side, so a portrait phone clip (1080×1920) at 720p comes out 720×1280.
 * A preset larger than the source is disabled (never upscale).
 */
export function exportQualityOptions(width: number, height: number): ExportQualityOption[] {
  const short = Math.min(width, height);
  const tier = (id: '720p' | '1080p', target: number): ExportQualityOption => {
    // Cap the height so the short side lands on `target`.
    const maxHeight = height <= width ? target : Math.round((height * target) / width);
    const size = scaledExportSize(width, height, maxHeight);
    return { id, label: id, ...size, maxHeight, videoBitsPerSecond: TIER_VIDEO_BPS[id], disabled: !(short >= target) };
  };
  const original = scaledExportSize(width, height, null);
  return [
    tier('720p', 720),
    tier('1080p', 1080),
    { id: 'original', label: 'Original', ...original, maxHeight: null, videoBitsPerSecond: originalVideoBps(width, height), disabled: !(short > 0) },
  ];
}

/** Estimated file size in bytes: (video + audio bits/s) × duration ÷ 8. */
export function estimateExportBytes(durationSec: number, videoBitsPerSecond: number, audioBitsPerSecond: number = EXPORT_AUDIO_BPS): number {
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const v = Number.isFinite(videoBitsPerSecond) && videoBitsPerSecond > 0 ? videoBitsPerSecond : 0;
  const a = Number.isFinite(audioBitsPerSecond) && audioBitsPerSecond > 0 ? audioBitsPerSecond : 0;
  return Math.round(((v + a) * d) / 8);
}

/** Bytes as megabytes (10^6, as phones and macOS show file sizes), e.g. "12.3 MB". */
export function formatMegabytes(bytes: number): string {
  const mb = Math.max(0, bytes) / 1_000_000;
  if (mb > 0 && mb < 0.1) return '< 0.1 MB';
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
