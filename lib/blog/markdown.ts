/**
 * A small, safe Markdown subset for blog posts. It produces a data tree (no
 * HTML strings), so nothing in a post can inject markup: the React renderer
 * (components/blog/Markdown.tsx) builds elements from this tree.
 *
 * Supported: headings (# to ####; the page already has an H1, so # and ## both
 * become H2), paragraphs, bullet and numbered lists, blockquotes, horizontal
 * rules, fenced code, and inline **bold**, *italic*, `code`, [links](url) and
 * ![images](url). Anything else stays plain text. Known limit: triple-star
 * emphasis (***x***) is not supported and renders as bold with stray asterisks; write **bold** and *italic* separately.
 * Link URLs may contain one level of parentheses.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'img'; src: string; alt: string };

export type Block =
  | { t: 'h'; level: 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'code'; lang: string; v: string };

/** Link and image targets we allow; anything else renders as plain text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  if (/^https:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  return null;
}

const PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => Inline | null }[] = [
  {
    re: /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/,
    make: (m) => {
      const src = safeHref(m[2]);
      return src ? { t: 'img', src, alt: m[1] } : { t: 'text', v: m[1] };
    },
  },
  {
    re: /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/,
    make: (m) => {
      const href = safeHref(m[2]);
      return href ? { t: 'link', href, c: parseInline(m[1]) } : { t: 'text', v: m[1] };
    },
  },
  { re: /`([^`]+)`/, make: (m) => ({ t: 'code', v: m[1] }) },
  { re: /\*\*([^*]+)\*\*/, make: (m) => ({ t: 'strong', c: parseInline(m[1]) }) },
  { re: /(?<![*\w])\*([^*\s][^*]*)\*(?!\*)/, make: (m) => ({ t: 'em', c: parseInline(m[1]) }) },
  { re: /(?<![\w_])_([^_\s][^_]*)_(?![\w_])/, make: (m) => ({ t: 'em', c: parseInline(m[1]) }) },
];

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest) {
    let best: { index: number; len: number; node: Inline } | null = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        const node = p.make(m);
        if (node) best = { index: m.index, len: m[0].length, node };
      }
    }
    if (!best) {
      out.push({ t: 'text', v: rest });
      break;
    }
    if (best.index > 0) out.push({ t: 'text', v: rest.slice(0, best.index) });
    out.push(best.node);
    rest = rest.slice(best.index + best.len);
  }
  return out;
}

const isBlank = (l: string) => l.trim() === '';

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      blocks.push({ t: 'code', lang: fence[1], v: body.join('\n') });
      continue;
    }

    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(4, Math.max(2, h[1].length)) as 2 | 3 | 4;
      blocks.push({ t: 'h', level, c: parseInline(h[2]) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) inner.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', c: parseMarkdown(inner.join('\n')) });
      continue;
    }

    const bullet = /^\s{0,3}[-*+]\s+(.*)$/;
    const numbered = /^\s{0,3}\d+[.)]\s+(.*)$/;
    const listKind = bullet.test(line) ? 'ul' : numbered.test(line) ? 'ol' : null;
    if (listKind) {
      const re = listKind === 'ul' ? bullet : numbered;
      const items: Inline[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && re.test(lines[i])) {
        let text = re.exec(lines[i])![1];
        i++;
        // Indented continuation lines belong to the same item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) text += ` ${lines[i++].trim()}`;
        items.push(parseInline(text));
      }
      blocks.push({ t: listKind, items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Plain text of a block list, for word counts and excerpts. */
export function plainText(blocks: Block[]): string {
  const inline = (n: Inline[]): string =>
    n.map((x) => ('v' in x ? x.v : x.t === 'img' ? x.alt : inline(x.c))).join('');
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'h':
        case 'p':
          return inline(b.c);
        case 'ul':
        case 'ol':
          return b.items.map(inline).join(' ');
        case 'quote':
          return plainText(b.c);
        case 'code':
          return b.v;
        default:
          return '';
      }
    })
    .join(' ');
}
