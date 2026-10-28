/**
 * Allowlist sanitizer for the chart SVG stored with a saved decoder report.
 *
 * The in-app report draws those strings with `dangerouslySetInnerHTML`
 * (components/decoder/MatchReportView.tsx). They were written by the coach's own
 * browser, but they live in the database and a report may one day be shared, so
 * they are treated as untrusted at the moment they are drawn.
 *
 * ALLOWLIST, NOT A FILTER. The markup is tokenised and REBUILT: only the elements
 * and attributes the chart generator (lib/matchAnalysis/svgCharts.ts) emits survive,
 * every attribute value must match a strict per-attribute pattern, and text is
 * re-escaped. Everything else is dropped, with its subtree:
 *   - no `script`, `foreignObject`, `style`, `use`, `image`, `a`, `animate*`, `set`
 *   - no event attributes (`on*`), no `style` attribute, no `class`/`id`
 *   - no references at all: no `href` / `xlink:href`, no `url(...)` (not even `#local`),
 *     no `data:` or `javascript:` anywhere, because no attribute value may contain them
 *   - comments, CDATA, doctype and processing instructions are removed
 * Malformed or truncated markup fails closed: the unparsed rest is dropped, and
 * input without a root `<svg>` returns null.
 *
 * Pure string code (no DOM), so it runs identically in the browser and in tests.
 */

/** Allowed elements, lower-case name -> the name written out. */
const ELEMENTS: Record<string, string> = {
  svg: 'svg',
  g: 'g',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
  line: 'line',
  polyline: 'polyline',
  polygon: 'polygon',
  path: 'path',
  text: 'text',
  tspan: 'tspan',
  title: 'title',
  desc: 'desc',
};

/** Elements whose content is text. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);

const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|pt|em|%)?$/i;
const NUMBER_LIST = /^[-+0-9.eE\s,]+$/;
const PAINT = /^(?:none|currentColor|#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([-0-9.,\s%]+\))$/i;
const FONT_FAMILY = /^[A-Za-z0-9 ,_-]+$/;
const TRANSFORM = /^(?:(?:rotate|translate|scale|skewX|skewY)\([-0-9.,\s]+\)\s*)+$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

const test = (re: RegExp) => (v: string) => re.test(v.trim());
const oneOf = (...values: string[]) => (v: string) => values.includes(v.trim());

/** Allowed attributes (lower-case) -> [name written out, value check]. */
const ATTRIBUTES: Record<string, [string, (v: string) => boolean]> = {
  x: ['x', test(LENGTH)],
  y: ['y', test(LENGTH)],
  x1: ['x1', test(LENGTH)],
  y1: ['y1', test(LENGTH)],
  x2: ['x2', test(LENGTH)],
  y2: ['y2', test(LENGTH)],
  cx: ['cx', test(LENGTH)],
  cy: ['cy', test(LENGTH)],
  r: ['r', test(LENGTH)],
  rx: ['rx', test(LENGTH)],
  ry: ['ry', test(LENGTH)],
  dx: ['dx', test(LENGTH)],
  dy: ['dy', test(LENGTH)],
  width: ['width', test(LENGTH)],
  height: ['height', test(LENGTH)],
  points: ['points', test(NUMBER_LIST)],
  d: ['d', test(PATH_DATA)],
  viewbox: ['viewBox', test(NUMBER_LIST)],
  preserveaspectratio: ['preserveAspectRatio', test(/^[A-Za-z0-9 ]+$/)],
  fill: ['fill', test(PAINT)],
  stroke: ['stroke', test(PAINT)],
  'stroke-width': ['stroke-width', test(LENGTH)],
  'stroke-dasharray': ['stroke-dasharray', test(NUMBER_LIST)],
  'stroke-linecap': ['stroke-linecap', oneOf('butt', 'round', 'square')],
  'stroke-linejoin': ['stroke-linejoin', oneOf('miter', 'round', 'bevel')],
  opacity: ['opacity', test(NUM)],
  'fill-opacity': ['fill-opacity', test(NUM)],
  'stroke-opacity': ['stroke-opacity', test(NUM)],
  transform: ['transform', test(TRANSFORM)],
  'font-family': ['font-family', test(FONT_FAMILY)],
  'font-size': ['font-size', test(LENGTH)],
  'font-weight': ['font-weight', test(/^(?:normal|bold|[1-9]00)$/)],
  'text-anchor': ['text-anchor', oneOf('start', 'middle', 'end')],
  'dominant-baseline': ['dominant-baseline', oneOf('auto', 'middle', 'central', 'hanging', 'alphabetic')],
  'letter-spacing': ['letter-spacing', test(LENGTH)],
  role: ['role', oneOf('img', 'presentation', 'graphics-document')],
  'aria-label': ['aria-label', (v) => v.length <= 200],
  'aria-hidden': ['aria-hidden', oneOf('true', 'false')],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_INPUT = 400_000;
const MAX_ELEMENTS = 5_000;
const MAX_DEPTH = 40;

const ENTITY = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos);/y;

/** Text and attribute values are written out with a fixed escaping, never copied raw. */
function escapeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '&') {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(s);
      if (m) {
        out += m[0];
        i += m[0].length - 1;
      } else out += '&amp;';
    } else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch.charCodeAt(0) < 0x20 && ch !== '\n' && ch !== '\t') out += '';
    else out += ch;
  }
  return out;
}

const NAME_START = /[A-Za-z]/;
const NAME_CHAR = /[A-Za-z0-9:_-]/;

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Array<[string, string]>;
  end: number;
}

/** Parse the tag starting at `<` (index i). Null when it is not well formed. */
function readTag(src: string, i: number): Tag | null {
  let p = i + 1;
  let closing = false;
  if (src[p] === '/') {
    closing = true;
    p++;
  }
  if (!NAME_START.test(src[p] ?? '')) return null;
  let name = '';
  while (p < src.length && NAME_CHAR.test(src[p])) name += src[p++];
  const attrs: Array<[string, string]> = [];
  for (;;) {
    while (p < src.length && /\s/.test(src[p])) p++;
    if (p >= src.length) return null;
    if (src[p] === '>') return { name, closing, selfClosing: false, attrs, end: p + 1 };
    if (src[p] === '/' && src[p + 1] === '>') return { name, closing, selfClosing: true, attrs, end: p + 2 };
    if (src[p] === '/') {
      p++;
      continue;
    }
    let an = '';
    while (p < src.length && !/[\s=>/]/.test(src[p])) an += src[p++];
    if (!an) return null;
    while (p < src.length && /\s/.test(src[p])) p++;
    let value = '';
    if (src[p] === '=') {
      p++;
      while (p < src.length && /\s/.test(src[p])) p++;
      const q = src[p];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, p + 1);
        if (close === -1) return null;
        value = src.slice(p + 1, close);
        p = close + 1;
      } else {
        while (p < src.length && !/[\s>]/.test(src[p])) value += src[p++];
      }
    }
    attrs.push([an, value]);
  }
}

/**
 * Returns clean SVG markup, or null when the input has no usable root `<svg>`.
 * Never throws.
 */
export function sanitizeSvg(input: unknown): string | null {
  try {
    if (typeof input !== 'string' || input.length === 0 || input.length > MAX_INPUT) return null;
    const src = input;
    let out = '';
    const stack: string[] = [];
    let skipDepth = 0; // > 0 while inside a dropped element
    let elements = 0;
    let sawRoot = false;
    let i = 0;

    while (i < src.length) {
      const lt = src.indexOf('<', i);
      const textEnd = lt === -1 ? src.length : lt;
      if (textEnd > i) {
        // Text survives only directly inside a text element.
        if (!skipDepth && stack.length && TEXT_ELEMENTS.has(stack[stack.length - 1])) out += escapeText(src.slice(i, textEnd));
        i = textEnd;
      }
      if (lt === -1) break;

      // Comments, CDATA, doctype, processing instructions: dropped.
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        if (e === -1) break;
        i = e + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const e = src.indexOf(']]>', i + 9);
        if (e === -1) break;
        i = e + 3;
        continue;
      }
      if (src[i + 1] === '!' || src[i + 1] === '?') {
        const e = src.indexOf('>', i + 2);
        if (e === -1) break;
        i = e + 1;
        continue;
      }

      const tag = readTag(src, i);
      if (!tag) break; // malformed: fail closed, drop the rest
      i = tag.end;
      const lname = tag.name.toLowerCase();

      if (skipDepth) {
        if (tag.closing) skipDepth--;
        else if (!tag.selfClosing) skipDepth++;
        continue;
      }

      if (tag.closing) {
        // Only closes the element currently open; anything else is ignored.
        if (stack.length && stack[stack.length - 1] === lname) {
          stack.pop();
          out += `</${ELEMENTS[lname]}>`;
        }
        continue;
      }

      const allowed = ELEMENTS[lname];
      // A second <svg> (nested or after the root) is not allowed either.
      if (!allowed || (lname === 'svg' && (sawRoot || stack.length)) || (!sawRoot && lname !== 'svg')) {
        if (!tag.selfClosing) skipDepth = 1;
        continue;
      }
      if (++elements > MAX_ELEMENTS || stack.length >= MAX_DEPTH) return null;

      let attrs = '';
      const seen = new Set<string>();
      for (const [rawName, rawValue] of tag.attrs) {
        const key = rawName.toLowerCase();
        if (seen.has(key)) continue;
        if (key === 'xmlns') {
          if (lname === 'svg' && rawValue.trim() === SVG_NS) {
            attrs += ` xmlns="${SVG_NS}"`;
            seen.add(key);
          }
          continue;
        }
        const spec = ATTRIBUTES[key];
        if (!spec) continue; // not on the list (this drops on*, style, href, id, class …)
        // Entities could hide characters from the patterns; none are expected in values.
        if (rawValue.includes('&') && key !== 'aria-label') continue;
        if (!spec[1](rawValue)) continue;
        seen.add(key);
        attrs += ` ${spec[0]}="${escapeText(rawValue.trim())}"`;
      }

      if (lname === 'svg') sawRoot = true;
      if (tag.selfClosing) {
        out += `<${allowed}${attrs}/>`;
      } else {
        out += `<${allowed}${attrs}>`;
        stack.push(lname);
      }
    }

    if (!sawRoot) return null;
    while (stack.length) out += `</${ELEMENTS[stack.pop()!]}>`;
    return out;
  } catch {
    return null;
  }
}
