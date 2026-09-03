'use client';

import React from 'react';

/**
 * Safe rich text for coach-authored bios.
 *
 * THE PROBLEM
 * A coach's bio is a plain `<textarea>`, rendered as `{profile.bio}`. React
 * escapes that, so anything the coach types as markup — `<b>`, `<a href>`, even
 * a bare line break — shows up as literal characters or collapses to one
 * paragraph. That is the "bio doesn't render HTML" report.
 *
 * WHY NOT dangerouslySetInnerHTML + a sanitizer
 * A bio is user-generated content shown to the public, so rendering raw HTML is
 * an XSS surface. A sanitizer (DOMPurify et al.) can close it, but it adds a
 * dependency, has to be configured correctly, and one misconfiguration puts the
 * hole back. Note the current code is NOT vulnerable — precisely because it
 * escapes — so "make HTML work" must not trade a cosmetic bug for a security
 * one.
 *
 * WHAT THIS DOES INSTEAD
 * Parses a small formatting subset and returns REACT ELEMENTS. There is no
 * `dangerouslySetInnerHTML` anywhere in this file, so no string the coach types
 * can ever become markup — the worst case is text that does not format the way
 * they hoped. It is structurally immune rather than defensively filtered.
 *
 * Supported:
 *   blank line  → paragraph            single newline → line break
 *   **bold**    → <strong>             *italic*       → <em>
 *   [text](url) → link                 bare http(s):// or www. → link
 *   - item      → bullet list
 *
 * Links are rendered with an http/https allowlist, `rel="nofollow noopener
 * noreferrer"` and `target="_blank"`, so `javascript:`, `data:` and friends are
 * dropped rather than linked.
 */

const MAX_LINK_LEN = 2048;

/** Only ever produce an href we built ourselves from an allowlisted scheme. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_LINK_LEN) return null;
  const candidate = /^www\./i.test(url) ? `https://${url}` : url;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}
    >
      {children}
    </a>
  );
}

/** Inline pass: links first (so their text is not re-scanned), then bold, then italic. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // [label](url) | bare url | **bold** | *italic*
  const pattern =
    /\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)|((?:https?:\/\/|www\.)[^\s<>()]{2,2048})|\*\*([^*\n]{1,400})\*\*|\*([^*\n]{1,400})\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-i${i++}`;
    const [, label, labelUrl, bareUrl, bold, italic] = m;
    if (label !== undefined && labelUrl !== undefined) {
      const href = safeHref(labelUrl);
      // A rejected scheme degrades to plain text — never to a live link.
      out.push(href ? <Anchor key={key} href={href}>{label}</Anchor> : `${label} (${labelUrl})`);
    } else if (bareUrl !== undefined) {
      const href = safeHref(bareUrl);
      out.push(href ? <Anchor key={key} href={href}>{bareUrl}</Anchor> : bareUrl);
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{bold}</strong>);
    } else if (italic !== undefined) {
      out.push(<em key={key}>{italic}</em>);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render a coach bio as safe formatted React. Never returns raw HTML. */
export function CoachRichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);

  return (
    <div style={style}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length === 0) return null;

        // A block whose every line starts with "- " becomes a list.
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={bi} style={{ margin: '0 0 10px', paddingLeft: 20, textAlign: 'left' }}>
              {lines.map((l, li) => (
                <li key={li} style={{ marginBottom: 4 }}>
                  {renderInline(l.replace(/^\s*[-•]\s+/, ''), `b${bi}-l${li}`)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} style={{ margin: bi === blocks.length - 1 ? 0 : '0 0 10px' }}>
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 ? <br /> : null}
                {renderInline(l, `b${bi}-l${li}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
