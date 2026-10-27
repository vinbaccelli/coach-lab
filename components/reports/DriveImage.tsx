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
 * hot-linked image, so a failed load retries once through Drive's image host and
 * then degrades to a plain "Open image" link instead of a broken box.
 */
export default function DriveImage({ url, alt }: { url: string; alt: string }) {
  const id = driveFileId(url);
  const sources = id ? [url, `https://lh3.googleusercontent.com/d/${id}=w1600`] : [url];
  const [attempt, setAttempt] = useState(0);

  if (attempt >= sources.length) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '18px 14px', borderRadius: 12, background: 'var(--cl-bg-secondary)', color: 'var(--cl-accent)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
        Image didn’t load here — open image ↗
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', borderRadius: 12, overflow: 'hidden', background: 'var(--cl-bg-secondary)' }}>
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
