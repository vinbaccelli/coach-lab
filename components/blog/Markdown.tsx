import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Block, Inline } from '@/lib/blog/markdown';

/** Renders the safe Markdown tree (lib/blog/markdown.ts) as React elements. No raw HTML is ever injected. */
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'strong':
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'img':
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={i} src={n.src} alt={n.alt} loading="lazy" />;
      case 'link':
        return n.href.startsWith('/') || n.href.startsWith('#') ? (
          <Link key={i} href={n.href}>{renderInline(n.c)}</Link>
        ) : (
          <a key={i} href={n.href} rel="noopener noreferrer">{renderInline(n.c)}</a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
      return <Tag key={i}>{renderInline(b.c)}</Tag>;
    }
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'ul':
      return <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
    case 'ol':
      return <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
    case 'quote':
      return <blockquote key={i}>{b.c.map(renderBlock)}</blockquote>;
    case 'hr':
      return <hr key={i} />;
    case 'code':
      return <pre key={i}><code>{b.v}</code></pre>;
  }
}

export default function Markdown({ blocks }: { blocks: Block[] }) {
  return <div className="blog-prose">{blocks.map(renderBlock)}</div>;
}
