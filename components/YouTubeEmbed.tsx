'use client';

import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

function loadYouTubeIframeAPI(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-yt-iframe-api="1"]') as HTMLScriptElement | null;
    if (existing) {
      const t = setInterval(() => {
        if (window.YT?.Player) { clearInterval(t); resolve(window.YT); }
      }, 50);
      setTimeout(() => { clearInterval(t); reject(new Error('YT API load timeout')); }, 10_000);
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.dataset.ytIframeApi = '1';
    tag.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    document.head.appendChild(tag);
  });

  return ytApiPromise;
}

export default function YouTubeEmbed({
  videoId,
  onPlayer,
}: {
  videoId: string;
  onPlayer: (player: any | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const mount = async () => {
      try {
        const YT = await loadYouTubeIframeAPI();
        if (cancelled) return;
        if (!hostRef.current) return;

        // Clean up any previous player instance on this host.
        try { playerRef.current?.destroy?.(); } catch {}
        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          playerVars: {
            playsinline: 1,
            controls: 0,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              onPlayer(playerRef.current);
            },
          },
        });
      } catch (err) {
        console.warn('[YouTubeEmbed] Failed to init player:', err);
        onPlayer(null);
      }
    };

    mount();

    return () => {
      cancelled = true;
      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;
      onPlayer(null);
    };
  }, [videoId, onPlayer]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}

