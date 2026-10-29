'use client';

import { useState } from 'react';

/** Pull the Drive file id out of the URL forms upload-image and Drive itself produce. */
export function driveFileId(url: string): string | null {
  const m = /[?&]id=([\w-]{10,})/.exec(url) ?? /\/file\/d\/([\w-]{10,})/.exec(url) ?? /googleusercontent\.com\/d\/([\w-]{10,})/.exec(url);
  return m ? m[1] : null;
}

/**
 * A report screenshot. Stored URLs are Drive `uc?export=view` links (or public
 * Supabase URLs when the Drive upload fell back). Drive can throttle or refuse a
 * hot-linked image, so a failed load tries, in order:
 *   1. the stored URL,
 *   2. the same file through Drive's image host (lh3.googleusercontent.com),
 *   3. the entry's Supabase `player-assets` copy, when it has one,
 * and then settles on a small "Image unavailable" tile with an "open image" link.
 */
export default function DriveImage({ url, alt, fallbackUrl }: { url: string; alt: string; fallbackUrl?: string }) {
  const id = driveFileId(url);
  const sources = [url, ...(id ? [`https://lh3.googleusercontent.com/d/${id}=w1600`] : []), ...(fallbackUrl ? [fallbackUrl] : [])];
  const [attempt, setAttempt] = useState(0);

  if (attempt >= sources.length) {
    return (
      <div
        role="img"
        aria-label={`${alt} — unavailable`}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 120, padding: '18px 14px', borderRadius: 12, background: 'var(--cl-bg-secondary)', textAlign: 'center' }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cl-text-secondary)' }}>Image unavailable</span>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--cl-accent)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Open image ↗
        </a>
      </div>
    );
  }

  return (
    <a href={sources[attempt]} target="_blank" rel="noopener noreferrer" style={{ display: 'block', borderRadius: 12, overflow: 'hidden', background: 'var(--cl-bg-secondary)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={attempt}
        src={sources[attempt]}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((n) => n + 1)}
        style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto' }}
      />
    </a>
  );
}
