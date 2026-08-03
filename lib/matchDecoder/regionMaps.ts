import type { CropRectFraction, DistributionSpec, SectionSpec } from '@/lib/matchDecoder/types';

/**
 * Section layout for the SwingVision per-player stats screens.
 *
 * STRATEGY: SECTION-BAND + TITLE-ANCHORED POSITIONAL PICKING — not tight
 * per-field crops. Verified against real screenshots: isolating one number in
 * its own tight crop misreads it ("80%"→"SO%", "72%"→"TOY,"); reading a whole
 * section band (title + its value rows together) reads at 92–96% confidence,
 * because tesseract's language model has the surrounding text to disambiguate
 * a glyph against. So each section is ONE crop + ONE recognize() call, and the
 * individual values are picked out of that band's word list by position:
 * LEFT column is x<0.45 of the full image width, RIGHT is x≥0.45, and each
 * field sits `relativeY` below wherever the section's own TITLE token landed.
 *
 * TITLE ALIASES ARE EXACT-TOKEN (^...$), NOT SUBSTRING. A loose /Serves?/i
 * anchor latched onto the word "Serve" inside the "First Serve" donut label on
 * the Groundstrokes screenshot, anchored the Serves section to the donut, and
 * reported two slice percentages as serve percentages. Requiring the whole
 * token to BE the section title removes that entire failure mode.
 *
 * TITLE-ANCHORED, WITH NO ABSOLUTE SEARCH WINDOW AT ALL. Sections used to be
 * looked for inside a fixed y-fraction band. That only holds if every capture
 * frames the section identically — and real captures do NOT: the coach shoots
 * the stats screen at several SCROLL OFFSETS, so "Serves" lands at a different
 * height in each. The fixed window missed it, the in-band title search never
 * fired, everything fell back to an absolute position with nothing at it, and
 * every field came back "none" on real screenshots while synthetic ones (drawn
 * at exactly the assumed fractions) passed.
 *
 * Now the title is located anywhere in the frame from the full-frame token pass,
 * and the value band is derived from wherever it actually was. `fallbackTitleY`
 * survives only for the narrow case where the title is in the page TEXT but its
 * token could not be positioned.
 *
 * CALIBRATION STATUS — all four sections now measured from real screenshots:
 *   Overall, Serves    — measured (946×2048 Arthur screen)
 *   Returns            — measured; CONFIRMS the row grid extrapolated earlier
 *                        (0.043 / 0.111 below title) was correct, and that the
 *                        info box puts its title near y≈0.828
 *   Groundstrokes      — measured, on its own SEPARATE (scrolled) screenshot
 * The row grid is consistent across every section: row 1 sits ~0.043–0.045
 * below the title, row 2 ~0.111–0.113 below.
 *
 * TWO SCREENSHOTS, NOT ONE: Overall/Serves/Returns live on the first screen;
 * Groundstrokes + both donut legends live on a second, scrolled screen. Each
 * section's fabrication gate (see extractPlayerStats.extractSection) keeps a
 * section from being read off a screenshot it isn't on.
 */

export const HEADER_REGION: CropRectFraction = { x: 0.02, y: 0.235, w: 0.96, h: 0.04 };

export const OVERALL_SECTION: SectionSpec = {
  title: 'Overall',
  titleAliases: [/^Overall$/i],
  bandAbove: 0.03,
  bandBelow: 0.17,
  fallbackTitleY: 0.298,
  fields: [
    { key: 'shotsInPercent', label: 'Shots in %', column: 'left', relativeY: 0.044, kind: 'percent' },
    { key: 'shotsPerHour', label: 'Shots/hr', column: 'right', relativeY: 0.044, kind: 'number' },
    { key: 'longestRally', label: 'Longest rally', column: 'left', relativeY: 0.112, kind: 'number' },
    { key: 'ralliesOver5', label: 'Rallies > 5', column: 'right', relativeY: 0.112, kind: 'percent' },
  ],
};

export const SERVES_SECTION: SectionSpec = {
  title: 'Serves',
  titleAliases: [/^Serves$/i],
  bandAbove: 0.03,
  bandBelow: 0.17,
  fallbackTitleY: 0.521,
  fields: [
    { key: 'percentInAd', label: '% in (Ad)', column: 'left', relativeY: 0.043, kind: 'percent' },
    { key: 'percentInDeuce', label: '% in (Deuce)', column: 'right', relativeY: 0.043, kind: 'percent' },
    { key: 'avgSpeedAd', label: 'Avg speed (Ad)', column: 'left', relativeY: 0.111, kind: 'number' },
    { key: 'avgSpeedDeuce', label: 'Avg speed (Deuce)', column: 'right', relativeY: 0.111, kind: 'number' },
  ],
};

/**
 * MEASURED: title lands at y≈0.828 (pushed there by the variable-height info
 * box above it — exactly why this is title-anchored), rows at y≈0.871 and
 * y≈0.939, i.e. the same 0.043 / 0.111 grid as Overall and Serves. Search band
 * spans 0.78–0.98 so the title is still found if the info box changes height.
 */
export const RETURNS_SECTION: SectionSpec = {
  title: 'Returns',
  titleAliases: [/^Returns$/i],
  bandAbove: 0.03,
  bandBelow: 0.17,
  fallbackTitleY: 0.828,
  fields: [
    { key: 'percentInAd', label: '% in (Ad)', column: 'left', relativeY: 0.043, kind: 'percent' },
    { key: 'percentInDeuce', label: '% in (Deuce)', column: 'right', relativeY: 0.043, kind: 'percent' },
    { key: 'avgSpeedAd', label: 'Avg speed (Ad)', column: 'left', relativeY: 0.111, kind: 'number' },
    { key: 'avgSpeedDeuce', label: 'Avg speed (Deuce)', column: 'right', relativeY: 0.111, kind: 'number' },
  ],
};

/**
 * MEASURED on the second (scrolled) screenshot: title at y≈0.292, rows at
 * y≈0.337 and y≈0.405 — the same grid again, at 0.045 / 0.113.
 */
export const GROUNDSTROKES_SECTION: SectionSpec = {
  title: 'Groundstrokes',
  titleAliases: [/^Groundstrokes$/i],
  bandAbove: 0.03,
  bandBelow: 0.17,
  fallbackTitleY: 0.292,
  fields: [
    { key: 'forehandPercentIn', label: 'Forehands in %', column: 'left', relativeY: 0.045, kind: 'percent' },
    { key: 'backhandPercentIn', label: 'Backhands in %', column: 'right', relativeY: 0.045, kind: 'percent' },
    { key: 'forehandAvgSpeed', label: 'Avg FH speed', column: 'left', relativeY: 0.113, kind: 'number' },
    { key: 'backhandAvgSpeed', label: 'Avg BH speed', column: 'right', relativeY: 0.113, kind: 'number' },
  ],
};

export const STAT_SECTIONS: SectionSpec[] = [OVERALL_SECTION, SERVES_SECTION, RETURNS_SECTION, GROUNDSTROKES_SECTION];

/**
 * MEASURED donut legend, y≈0.55–0.72 on the Groundstrokes screenshot. The
 * percentages are NOT in a column grid — they sit around the donut wherever
 * each slice falls, and the value can precede the label ("2,9% Second Serve").
 * The donut's centre also carries a total ("103 Shots") which is deliberately
 * not a percentage, so it can never be mistaken for one.
 *
 * The band is derived from wherever the "Distribution" heading is found, not
 * from an absolute window, so a scrolled capture still resolves it.
 */
export const SHOT_DISTRIBUTION_SPEC: DistributionSpec = {
  key: 'shotDistribution',
  title: 'Shot Distribution',
  // Anchors on "Distribution" alone: it is the one word unique to this heading
  // and survives OCR splitting "Shot Distribution" into two tokens.
  titleAliases: [/^distribution$/i],
  bandAbove: 0.04,
  bandBelow: 0.22,
  fallbackTitleY: 0.545,
  labels: [
    { display: 'First Serve', anchor: /^first$/i },
    { display: 'Second Serve', anchor: /^second$/i },
    { display: 'Forehand', anchor: /^forehands?$/i },
    { display: 'Backhand', anchor: /^backhands?$/i },
    { display: 'Volley', anchor: /^volleys?$/i },
  ],
};

/**
 * MEASURED bottom row, y≈0.95: "(50.5%) Flat", "(37.9%) Topspin",
 * "(11.7%) Slice" — percentages wrapped in parentheses, value before label.
 * Band derived from the located "Spin" heading.
 */
export const SPIN_DISTRIBUTION_SPEC: DistributionSpec = {
  key: 'spinDistribution',
  title: 'Shot Spin Distribution',
  // "Spin" distinguishes this heading from the plain Shot Distribution one.
  titleAliases: [/^spin$/i],
  bandAbove: 0.04,
  bandBelow: 0.10,
  fallbackTitleY: 0.915,
  labels: [
    { display: 'Flat', anchor: /^flat$/i },
    { display: 'Topspin', anchor: /^topspins?$/i },
    { display: 'Slice', anchor: /^slices?$/i },
  ],
};

export const DISTRIBUTION_SPECS: DistributionSpec[] = [SHOT_DISTRIBUTION_SPEC, SPIN_DISTRIBUTION_SPEC];
