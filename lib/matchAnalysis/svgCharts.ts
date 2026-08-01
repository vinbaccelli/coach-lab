/**
 * Hand-rolled SVG charts — minimalist, and built to survive the trip into a
 * Google Doc.
 *
 * WHY SVG STRINGS RATHER THAN REACT COMPONENTS
 * The same chart has to appear in two places: on the report page, and as a PNG
 * inside a Google Doc. Building them as strings means both paths render the
 * SAME bytes — the page injects the markup, the exporter rasterises it. A React
 * component would need a parallel serialisation path, and the two would drift.
 *
 * WHY NO CHART LIBRARY
 * recharts is not a dependency of this project, and its responsive containers
 * measure the DOM to lay out — which yields nothing useful when rasterising
 * off-screen. These charts carry explicit geometry, so they rasterise
 * deterministically.
 *
 * DOCS-SAFE BY CONSTRUCTION
 *  - Every colour, font and size is a PRESENTATION ATTRIBUTE, never a CSS class:
 *    a serialised SVG carries no stylesheet with it, so anything left to CSS
 *    would render unstyled in the PNG.
 *  - An explicit white background rect, because a transparent PNG on a Doc's
 *    white page loses every dark label.
 *  - Fixed viewBox and absolute width/height, so rasterisation needs no layout.
 *
 * PALETTE: restrained on purpose. The subject side is near-black, the opponent
 * mid-grey, and multi-slice charts use a single grey ramp. It reads as one
 * system, prints legibly in mono, and never depends on hue to carry meaning.
 */

export const INK = '#1A1A1A';
export const MUTED = '#8A8A8F';
export const GRID = '#ECECEC';
/** Subject side. */
export const PRIMARY = '#1A1A1A';
/** Opposing side. */
export const SECONDARY = '#C8C8CE';
/** Multi-slice ramp — dark to light, no hue dependence. */
export const RAMP = ['#1A1A1A', '#55555A', '#8A8A8F', '#B6B6BC', '#DCDCE1'];

const FONT = 'Helvetica, Arial, sans-serif';
const WIDTH = 640;

/**
 * Escape a string for SVG text, and force it to pure ASCII.
 *
 * The XML escapes are the obvious part — an unescaped "&" in "Vin & Marco" breaks
 * the document.
 *
 * The NUMERIC CHARACTER REFERENCES are the part that was caught by rendering
 * these charts rather than reasoning about them. A serialised SVG carries no
 * encoding declaration, so when it is rasterised through a Blob → Image → canvas
 * the bytes can be re-read as Latin-1: an en dash renders as "â€“", and a player
 * named "José" or a side labelled "对手" turns to garbage in the PNG that lands
 * in the Google Doc. Emitting every non-ASCII code point as `&#N;` makes the
 * markup encoding-independent, so typography and non-Latin names both survive.
 * `codePointAt` (not `charCodeAt`) so characters outside the BMP stay intact.
 */
export function esc(s: string): string {
  const xml = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  let out = '';
  for (const ch of xml) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 0x20 && code <= 0x7e ? ch : `&#${code};`;
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format a value for a label: no trailing ".0", one decimal otherwise. */
export function fmtNum(n: number, decimals = 1): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(decimals);
}

function open(height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}" font-family="${FONT}">` +
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="#FFFFFF"/>`
  );
}

/**
 * Chart title: medium weight and letter-spaced rather than bold.
 *
 * Bold titles on every chart make a document shout; a lighter, spaced title reads
 * as a caption and lets the numbers carry the emphasis — which is the whole point
 * of a minimalist report.
 */
function title(text: string, y = 22): string {
  return (
    `<text x="0" y="${y}" font-size="13" font-weight="600" letter-spacing="0.2" ` +
    `fill="${INK}">${esc(text)}</text>`
  );
}

export interface BarItem {
  label: string;
  value: number;
}

/**
 * Horizontal bars — the workhorse for "counts by stroke".
 *
 * Horizontal rather than vertical because the categories are words
 * ("Backhand", "Forehand Volley") and horizontal bars give them room to sit
 * left-aligned and readable without rotated labels.
 */
export function hBarChart(opts: {
  title: string;
  items: BarItem[];
  unit?: string;
  color?: string;
}): string {
  const { items, unit = '', color = PRIMARY } = opts;
  const labelW = 150;
  const rowH = 30;
  const top = 44;
  const chartW = WIDTH - labelW - 60;
  const height = top + Math.max(1, items.length) * rowH + 12;
  const max = Math.max(1, ...items.map((i) => i.value));

  let s = open(height) + title(opts.title);
  if (!items.length) {
    s += `<text x="0" y="${top + 16}" font-size="12" fill="${MUTED}">No data</text></svg>`;
    return s;
  }
  items.forEach((item, i) => {
    const y = top + i * rowH;
    const w = Math.max(1, round((item.value / max) * chartW));
    s += `<text x="0" y="${y + 14}" font-size="12" fill="${MUTED}">${esc(item.label)}</text>`;
    s += `<rect x="${labelW}" y="${y + 4}" width="${w}" height="11" rx="5.5" fill="${color}"/>`;
    s += `<text x="${labelW + w + 8}" y="${y + 14}" font-size="12" font-weight="700" fill="${INK}">${esc(
      fmtNum(item.value) + unit,
    )}</text>`;
  });
  return s + '</svg>';
}

export interface CompareGroup {
  label: string;
  a: number | null;
  b: number | null;
}

/**
 * Two sides, same measures, side by side.
 *
 * `null` renders as an explicit "n/a" tick rather than a zero-length bar — a
 * missing measurement must not look like a measured zero.
 */
export function compareBarChart(opts: {
  title: string;
  groups: CompareGroup[];
  aLabel: string;
  bLabel: string;
  unit?: string;
}): string {
  const { groups, aLabel, bLabel, unit = '' } = opts;
  const labelW = 150;
  const groupH = 44;
  const top = 66;
  const chartW = WIDTH - labelW - 70;
  const height = top + Math.max(1, groups.length) * groupH + 8;
  const values = groups.flatMap((g) => [g.a, g.b]).filter((v): v is number => v !== null);
  const max = Math.max(1, ...values);

  let s = open(height) + title(opts.title);
  // Legend
  s += `<rect x="0" y="34" width="10" height="10" rx="2" fill="${PRIMARY}"/>`;
  s += `<text x="16" y="43" font-size="11" fill="${MUTED}">${esc(aLabel)}</text>`;
  const bx = 26 + aLabel.length * 6;
  s += `<rect x="${bx}" y="34" width="10" height="10" rx="2" fill="${SECONDARY}"/>`;
  s += `<text x="${bx + 16}" y="43" font-size="11" fill="${MUTED}">${esc(bLabel)}</text>`;

  groups.forEach((g, i) => {
    const y = top + i * groupH;
    s += `<text x="0" y="${y + 14}" font-size="12" fill="${MUTED}">${esc(g.label)}</text>`;
    ([[g.a, PRIMARY, 0], [g.b, SECONDARY, 17]] as Array<[number | null, string, number]>).forEach(
      ([value, color, dy]) => {
        if (value === null) {
          s += `<text x="${labelW}" y="${y + dy + 12}" font-size="11" fill="${GRID === color ? MUTED : MUTED}">n/a</text>`;
          return;
        }
        const w = Math.max(1, round((value / max) * chartW));
        s += `<rect x="${labelW}" y="${y + dy}" width="${w}" height="10" rx="5" fill="${color}"/>`;
        s += `<text x="${labelW + w + 8}" y="${y + dy + 11}" font-size="11" font-weight="700" fill="${INK}">${esc(
          fmtNum(value) + unit,
        )}</text>`;
      },
    );
  });
  return s + '</svg>';
}

/**
 * Diverging bars around a zero axis — for the Winner–Error Differential, where
 * the sign is the whole point and a plain bar chart would hide it.
 */
export function divergingBarChart(opts: { title: string; items: BarItem[] }): string {
  const { items } = opts;
  const labelW = 150;
  const rowH = 34;
  const top = 48;
  const chartW = WIDTH - labelW - 60;
  const mid = labelW + chartW / 2;
  const height = top + Math.max(1, items.length) * rowH + 12;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));

  let s = open(height) + title(opts.title);
  s += `<line x1="${mid}" y1="${top - 6}" x2="${mid}" y2="${height - 10}" stroke="${GRID}" stroke-width="1"/>`;
  items.forEach((item, i) => {
    const y = top + i * rowH;
    const w = Math.max(1, round((Math.abs(item.value) / max) * (chartW / 2 - 30)));
    const x = item.value >= 0 ? mid : mid - w;
    s += `<text x="0" y="${y + 15}" font-size="12" fill="${MUTED}">${esc(item.label)}</text>`;
    s += `<rect x="${x}" y="${y + 5}" width="${w}" height="11" rx="5.5" fill="${item.value >= 0 ? PRIMARY : SECONDARY}"/>`;
    const tx = item.value >= 0 ? x + w + 8 : x - 8;
    const anchor = item.value >= 0 ? 'start' : 'end';
    s += `<text x="${tx}" y="${y + 15}" font-size="12" font-weight="700" fill="${INK}" text-anchor="${anchor}">${esc(
      (item.value > 0 ? '+' : '') + fmtNum(item.value),
    )}</text>`;
  });
  return s + '</svg>';
}

/**
 * Donut for the distribution legends.
 *
 * Percentages come straight from SwingVision's own legend, so the slices are NOT
 * renormalised to 360° — if the extracted values don't sum to 100, the donut
 * shows the gap rather than stretching the slices to hide an incomplete read.
 */
export function donutChart(opts: { title: string; slices: BarItem[] }): string {
  const { slices } = opts;
  const size = 168;
  const cx = 96;
  const cy = 60 + size / 2;
  const rOuter = size / 2;
  const rInner = rOuter * 0.58;
  const height = 60 + size + 24;
  const total = slices.reduce((s, x) => s + x.value, 0);

  let s = open(height) + title(opts.title);
  if (!slices.length) {
    s += `<text x="0" y="80" font-size="12" fill="${MUTED}">No data</text></svg>`;
    return s;
  }

  // Track ring: the full circle, so an incomplete sum reads as an obvious gap.
  s +=
    `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" ` +
    `stroke="${GRID}" stroke-width="${rOuter - rInner}"/>`;

  let angle = -90;
  slices.forEach((slice, i) => {
    const sweep = (Math.min(slice.value, 100) / 100) * 360;
    if (sweep <= 0) return;
    const rMid = (rOuter + rInner) / 2;
    const circ = 2 * Math.PI * rMid;
    const dash = (sweep / 360) * circ;
    s +=
      `<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${RAMP[i % RAMP.length]}" ` +
      `stroke-width="${rOuter - rInner}" stroke-dasharray="${round(dash)} ${round(circ - dash)}" ` +
      `transform="rotate(${round(angle)} ${cx} ${cy})"/>`;
    angle += sweep;
  });

  if (Math.abs(total - 100) > 1) {
    s += `<text x="${cx}" y="${cy + 4}" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(
      `${fmtNum(total)}% read`,
    )}</text>`;
  }

  // Legend to the right.
  const lx = cx + rOuter + 40;
  slices.forEach((slice, i) => {
    const ly = 70 + i * 24;
    s += `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${RAMP[i % RAMP.length]}"/>`;
    s += `<text x="${lx + 18}" y="${ly}" font-size="12" fill="${MUTED}">${esc(slice.label)}</text>`;
    s += `<text x="${WIDTH - 8}" y="${ly}" font-size="12" font-weight="700" fill="${INK}" text-anchor="end">${esc(
      `${fmtNum(slice.value)}%`,
    )}</text>`;
  });
  return s + '</svg>';
}

/**
 * A row of index tiles — the headline numbers of section 1.
 *
 * Each tile carries its FORMULA under the value. That is deliberate: the
 * Winner–Error Differential is not Aggressive Margin, and printing the formula
 * on the chart itself means the distinction travels with the number into
 * whatever document it ends up in.
 */
export function statTiles(opts: {
  title: string;
  tiles: Array<{ label: string; value: string; formula?: string }>;
}): string {
  const { tiles } = opts;
  const perRow = 3;
  const tileW = (WIDTH - (perRow - 1) * 12) / perRow;
  const tileH = 78;
  const rows = Math.ceil(Math.max(1, tiles.length) / perRow);
  const top = 40;
  const height = top + rows * (tileH + 12);

  let s = open(height) + title(opts.title);
  tiles.forEach((tile, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = col * (tileW + 12);
    const y = top + row * (tileH + 12);
    s += `<rect x="${x}" y="${y}" width="${round(tileW)}" height="${tileH}" rx="10" fill="none" stroke="${GRID}"/>`;
    s += `<text x="${x + 14}" y="${y + 21}" font-size="10.5" fill="${MUTED}">${esc(tile.label)}</text>`;
    s += `<text x="${x + 14}" y="${y + 47}" font-size="25" font-weight="600" letter-spacing="-0.5" fill="${INK}">${esc(tile.value)}</text>`;
    if (tile.formula) {
      s += `<text x="${x + 14}" y="${y + 65}" font-size="8.5" fill="#B6B6BC">${esc(tile.formula)}</text>`;
    }
  });
  return s + '</svg>';
}
