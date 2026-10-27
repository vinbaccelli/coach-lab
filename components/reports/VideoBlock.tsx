'use client';

import { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * An embedded YouTube video, with a plain "Watch on YouTube" link always under it.
 *
 * The app sends `Cross-Origin-Embedder-Policy: credentialless` on every page
 * (next.config.js), which can stop a cross-origin iframe from rendering. The
 * `credentialless` attribute opts this one iframe into loading without
 * credentials (Chromium); browsers that ignore the COEP header ignore it too.
 * A blocked frame does not reliably fire an error, so the link is not conditional:
 * it is the guaranteed way to the video.
 */
export default function VideoBlock({ url, videoId }: { url: string; videoId: string | null }) {
  const markCredentialless = useCallback((el: HTMLIFrameElement | null) => {
    if (el) el.setAttribute('credentialless', '');
  }, []);

  return (
    <div>
      {videoId ? (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
          <iframe
            ref={markCredentialless}
            src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1`}
            title="Video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, color: 'var(--cl-accent)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
      >
        <ExternalLink size={15} aria-hidden /> Watch on YouTube
      </a>
    </div>
  );
}
