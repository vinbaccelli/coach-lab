'use client';

import { type OcrToken, parseNumber, parsePercent, recognizeBand, recognizeRegion } from '@/lib/matchDecoder/ocr';
import {
  DISTRIBUTION_SPECS,
  HEADER_REGION,
  STAT_SECTIONS,
} from '@/lib/matchDecoder/regionMaps';
import { recordSectionTrace } from '@/lib/matchDecoder/debugTrace';
import type {
  ClassifiedScreenshot,
  DistributionLabelSpec,
  DistributionSpec,
  Extracted,
  FieldSpec,
  PlayerStatBlock,
  SectionSpec,
  StatPlayerSlot,
} from '@/lib/matchDecoder/types';

/**
 * Assigns a stable 'A' | 'B' to each distinct player name seen across a whole
 * decode session (one match has many stats screenshots — one per player, and
 * SwingVision doesn't guarantee which name appears first). First distinct name
 * encountered becomes 'A', the second becomes 'B'. "Everyone's Shots" is never
 * mapped through this — it is combined data, not one player's, and forcing it
 * onto a letter would misattribute it.
 */
export class PlayerSlotRegistry {
  private readonly nameToSlot = new Map<string, StatPlayerSlot>();

  resolve(nameRaw: string | null): StatPlayerSlot {
    if (!nameRaw) return 'A'; // no readable name at all — best-effort, flagged via low confidence upstream
    if (/everyone/i.test(nameRaw)) return 'both';
    const key = nameRaw.trim().toLowerCase();
    const existing = this.nameToSlot.get(key);
    if (existing) return existing;
    const slot: StatPlayerSlot = this.nameToSlot.size === 0 ? 'A' : 'B';
    this.nameToSlot.set(key, slot);
    return slot;
  }
}

const COLUMN_SPLIT_X = 0.45;
/** How far a candidate token's Y may sit from its field's expected Y and still count — a fraction of full image height, roughly half a row's spacing. */
const ROW_TOLERANCE_Y = 0.03;

/**
 * Where this section's title actually sits, located from the FULL-FRAME token
 * pass — anywhere in the image, not inside a pre-guessed window.
 *
 * This is the fix for the synthetic-passes/real-fails gap. Real captures are
 * scrolled, so a section's absolute y varies per screenshot; searching a fixed
 * band found nothing, anchoring never fired, and every field fell back to a
 * position with no text at it.
 */
export function anchorTitleY(
  section: { titleAliases: RegExp[]; fallbackTitleY: number },
  tokens: OcrToken[],
): { y: number; matched: boolean; source: OcrToken | null } {
  for (const re of section.titleAliases) {
    const hit = tokens.find((t) => re.test(t.text.trim()));
    if (hit) return { y: hit.yFrac, matched: true, source: hit };
  }
  return { y: section.fallbackTitleY, matched: false, source: null };
}

/** Parse a token per the field's expected kind. Percent fields fall back to a bare
 *  number when tesseract split "80%" into separate "80" and "%" tokens — the
 *  field's POSITION already confirms what it is, unlike the earlier tight-crop
 *  design where the literal '%' glyph was the only disambiguator available. */
function parseForKind(rawText: string, kind: FieldSpec['kind']): number | null {
  if (kind === 'percent') return parsePercent(rawText) ?? parseNumber(rawText);
  return parseNumber(rawText);
}

/** Pick the field's value: the closest in-column, in-tolerance token that actually parses. */
export function pickField(
  tokens: OcrToken[],
  anchorY: number,
  field: FieldSpec,
  screenshotIndex: number,
): Extracted<number> | undefined {
  const targetY = anchorY + field.relativeY;
  const inColumn = (t: OcrToken) => (field.column === 'left' ? t.xFrac < COLUMN_SPLIT_X : t.xFrac >= COLUMN_SPLIT_X);

  let best: { token: OcrToken; value: number; dist: number } | null = null;
  for (const t of tokens) {
    if (!inColumn(t)) continue;
    const dist = Math.abs(t.yFrac - targetY);
    if (dist > ROW_TOLERANCE_Y) continue;
    const value = parseForKind(t.text, field.kind);
    if (value === null) continue;
    if (!best || dist < best.dist) best = { token: t, value, dist };
  }
  if (!best) return undefined;
  return {
    value: best.value,
    source: { screenshotIndex, rawText: best.token.text, confidence: best.token.confidence },
  };
}

/** Whole-word test for a section title in a page's full-frame OCR text. */
export function pageHasSectionTitle(pageText: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(pageText);
}

/**
 * Extract one section's fields from one OCR pass over its band.
 *
 * FABRICATION GATE — two independent checks, both required.
 *
 * 1. PAGE CHECK: the section's title must appear as a WHOLE WORD in the
 *    screenshot's own full-frame OCR text. This gate previously compared
 *    against classify.ts's marker regex SOURCES, which are deliberately loose
 *    for classification (`Serves?`) — and `Serves?` matches the "Serve" inside
 *    a "First Serve" donut label. On the Groundstrokes screenshot that let the
 *    Serves section through, where it anchored onto the donut and reported two
 *    slice percentages as serve percentages: a fabricated value with no real
 *    section behind it. A `\bServes\b` test on the page text cannot match
 *    "First Serve", so that screenshot is now correctly refused.
 *
 * 2. BAND CHECK: within the band, the title must match as an EXACT TOKEN
 *    (regionMaps' `/^Serves$/i`, not `/Serves?/i`) before its position is
 *    trusted as the anchor.
 *
 * Only when both pass may `fallbackTitleY` stand in for a title the band read
 * missed — the fallback is a rescue for a misread title on a page that
 * demonstrably HAS the section, never a licence to search a page that doesn't.
 */
async function extractSection(
  image: ImageBitmap,
  screenshotIndex: number,
  section: SectionSpec,
  pageText: string,
  frameTokens: OcrToken[],
): Promise<Record<string, Extracted<number>> | undefined> {
  if (!pageHasSectionTitle(pageText, section.title)) return undefined;

  // Locate the title across the WHOLE frame first.
  const anchor = anchorTitleY(section, frameTokens);
  const bandY = Math.max(0, anchor.y - section.bandAbove);
  const bandH = Math.min(1 - bandY, section.bandAbove + section.bandBelow);
  const rect = { x: 0, y: bandY, w: 1, h: bandH };

  // Re-OCR that band at 2x — the calibrated strategy, now aimed at where the
  // section really is rather than where it was assumed to be.
  const band = await recognizeBand(image, rect, screenshotIndex);

  // Pick from band tokens; fall back to the full-frame tokens for any field the
  // band missed, so a marginal band read can't lose a value the frame already saw.
  const out: Record<string, Extracted<number>> = {};
  let any = false;
  for (const field of section.fields) {
    const picked =
      pickField(band.tokens, anchor.y, field, screenshotIndex) ??
      pickField(frameTokens, anchor.y, field, screenshotIndex);
    if (picked) {
      out[field.key] = picked;
      any = true;
    }
  }

  // TEMP-DEBUG-MATCHDECODER — the per-section trace asked for: crop rect in
  // pixels, whether the title anchored and where, how many tokens the band
  // produced, and which fields resolved. Surfaced on the dev page too, so it
  // can be captured in a screenshot rather than needing a console.
  recordSectionTrace({
    screenshotIndex,
    section: section.title,
    titleFound: anchor.matched,
    anchorY: +anchor.y.toFixed(3),
    bandPx: `${Math.round(rect.y * image.height)}..${Math.round((rect.y + rect.h) * image.height)}`,
    bandTokenCount: band.tokens.length,
    frameTokenCount: frameTokens.length,
    picked: Object.keys(out),
  });

  return any ? out : undefined;
}

/** How far a label may sit from its percentage and still be paired, as a fraction of image WIDTH. */
const MAX_PAIR_DISTANCE_X = 0.3;

interface PercentCandidate {
  value: number;
  token: OcrToken;
  rawText: string;
}

/**
 * Every token in a band that represents a percentage.
 *
 * Two forms, because tesseract splits inconsistently on the donut legends:
 * a single token carrying both digits and sign ("61,2%", "(50.5%)"), or a bare
 * number whose "%" landed in its own adjacent token. The second form is merged
 * only when a literal "%" token really does sit beside it — the percent sign is
 * still read off the screen, never assumed, so this widens what can be MATCHED
 * without widening what can be INVENTED.
 */
function percentCandidates(tokens: OcrToken[], imgW: number, imgH: number): PercentCandidate[] {
  const out: PercentCandidate[] = [];
  const isBarePercentSign = (t: OcrToken) => /^[%]$/.test(t.text.trim());

  for (const t of tokens) {
    const direct = parsePercent(t.text);
    if (direct !== null) {
      out.push({ value: direct, token: t, rawText: t.text });
      continue;
    }
    const bare = parseNumber(t.text);
    if (bare === null) continue;
    // Only if the digits stand alone — "66 km/h" must not become "66%".
    if (!/^[-(]?\d+(?:[.,]\d+)?[)]?$/.test(t.text.trim())) continue;
    const sign = tokens.find(
      (o) =>
        isBarePercentSign(o) &&
        Math.hypot((o.xFrac - t.xFrac) * imgW, (o.yFrac - t.yFrac) * imgH) < 0.06 * imgW,
    );
    if (sign) out.push({ value: bare, token: t, rawText: `${t.text}${sign.text}` });
  }
  return out;
}

/**
 * Pair each legend label with its percentage, by proximity.
 *
 * The donut legends have no row/column grid to exploit — slices sit wherever
 * they fall around the circle, and the value can come before the label
 * ("2,9% Second Serve") or after it. So each label token is matched to the
 * nearest percentage token, measured in PIXELS (fractions are converted using
 * the real image dimensions — on a 946×2048 screen a 0.01 step in y is twice
 * the distance of 0.01 in x, so comparing raw fractions would systematically
 * prefer the wrong neighbour).
 *
 * Assignment is greedy over globally-sorted distances, so each label and each
 * percentage is used at most once and the closest pairs win — a label whose own
 * value is missing cannot steal the neighbouring slice's.
 *
 * FABRICATION GATE: intrinsic. A slice is emitted only when its label word was
 * literally found AND a percentage was literally found near it. There is no
 * positional fallback, so running this band against a screenshot that has no
 * donut on it simply yields nothing.
 */
export function pairLabelsWithPercents(
  spec: DistributionSpec,
  tokens: OcrToken[],
  imgW: number,
  imgH: number,
  screenshotIndex: number,
): Array<{ label: Extracted<string>; percent: Extracted<number> }> {
  const labelHits = spec.labels
    .map((l) => {
      const token = tokens.find((t) => l.anchor.test(t.text.trim()));
      return token ? { spec: l, token } : null;
    })
    .filter((x): x is { spec: DistributionLabelSpec; token: OcrToken } => x !== null);

  const percents = percentCandidates(tokens, imgW, imgH);
  if (!labelHits.length || !percents.length) return [];

  const pairs: Array<{ li: number; pi: number; dist: number }> = [];
  labelHits.forEach((lh, li) => {
    percents.forEach((p, pi) => {
      const dist = Math.hypot((p.token.xFrac - lh.token.xFrac) * imgW, (p.token.yFrac - lh.token.yFrac) * imgH);
      if (dist <= MAX_PAIR_DISTANCE_X * imgW) pairs.push({ li, pi, dist });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);

  const usedLabel = new Set<number>();
  const usedPercent = new Set<number>();
  const out: Array<{ label: Extracted<string>; percent: Extracted<number> }> = [];
  for (const { li, pi } of pairs) {
    if (usedLabel.has(li) || usedPercent.has(pi)) continue;
    usedLabel.add(li);
    usedPercent.add(pi);
    const lh = labelHits[li];
    const p = percents[pi];
    out.push({
      label: {
        value: lh.spec.display,
        source: { screenshotIndex, rawText: lh.token.text, confidence: lh.token.confidence },
      },
      percent: {
        value: p.value,
        source: { screenshotIndex, rawText: p.rawText, confidence: p.token.confidence },
      },
    });
  }
  // Stable, legend-declaration order rather than distance order.
  const order = new Map(spec.labels.map((l, i) => [l.display, i]));
  out.sort((a, b) => (order.get(a.label.value) ?? 0) - (order.get(b.label.value) ?? 0));
  return out;
}

async function extractDistribution(
  image: ImageBitmap,
  screenshotIndex: number,
  spec: DistributionSpec,
  frameTokens: OcrToken[],
): Promise<Array<{ label: Extracted<string>; percent: Extracted<number> }>> {
  const anchor = anchorTitleY(spec, frameTokens);
  // No heading found anywhere ⇒ this donut is not on this screenshot. Refuse
  // rather than scanning an absolute window, which on the Groundstrokes screen
  // would pair that section's own "Forehand" row label into the legend.
  if (!anchor.matched) return [];
  const bandY = Math.max(0, anchor.y - spec.bandAbove);
  const bandH = Math.min(1 - bandY, spec.bandAbove + spec.bandBelow);
  const band = await recognizeBand(image, { x: 0, y: bandY, w: 1, h: bandH }, screenshotIndex);
  const pairs = pairLabelsWithPercents(spec, band.tokens, image.width, image.height, screenshotIndex);
  recordSectionTrace({
    screenshotIndex,
    section: spec.title,
    titleFound: anchor.matched,
    anchorY: +anchor.y.toFixed(3),
    bandPx: `${Math.round(bandY * image.height)}..${Math.round((bandY + bandH) * image.height)}`,
    bandTokenCount: band.tokens.length,
    frameTokenCount: frameTokens.length,
    picked: pairs.map((pr) => pr.label.value),
  });
  return pairs;
}

export async function extractPlayerStats(
  image: ImageBitmap,
  screenshotIndex: number,
  registry: PlayerSlotRegistry,
  classification?: ClassifiedScreenshot,
  frameTokens: OcrToken[] = [],
): Promise<PlayerStatBlock> {
  const pageText = classification?.rawText ?? '';

  const nameRead = await recognizeRegion(image, HEADER_REGION, screenshotIndex);
  const playerNameRaw: Extracted<string> | undefined = nameRead.rawText
    ? { value: nameRead.rawText, source: nameRead }
    : undefined;
  const player = registry.resolve(playerNameRaw?.value ?? null);

  const [overall, serves, returnsRaw, groundstrokesRaw] = await Promise.all(
    STAT_SECTIONS.map((s) => extractSection(image, screenshotIndex, s, pageText, frameTokens)),
  );

  const [shotDistribution, spinDistribution] = await Promise.all(
    DISTRIBUTION_SPECS.map((spec) => extractDistribution(image, screenshotIndex, spec, frameTokens)),
  );

  return {
    screenshotIndex,
    player,
    playerNameRaw,
    overall: overall as PlayerStatBlock['overall'],
    serves: serves as PlayerStatBlock['serves'],
    returns: returnsRaw
      ? {
          percentInAd: returnsRaw.percentInAd,
          percentInDeuce: returnsRaw.percentInDeuce,
          avgSpeedAd: returnsRaw.avgSpeedAd,
          avgSpeedDeuce: returnsRaw.avgSpeedDeuce,
        }
      : undefined,
    groundstrokes: groundstrokesRaw as PlayerStatBlock['groundstrokes'],
    shotDistribution,
    spinDistribution,
  };
}
