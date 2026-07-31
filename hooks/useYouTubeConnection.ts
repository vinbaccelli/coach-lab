'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Whether this coach has authorized YouTube uploads, and how to get them there.
 *
 * YouTube is a SEPARATE Google grant from sign-in — Google refuses to issue
 * `youtube.upload` alongside `drive.file`, so the Docs/Drive export keeps the
 * session's token and YouTube has its own, stored server-side. Consequently
 * "signed in" tells you nothing about "can upload"; only /api/youtube/status does.
 *
 * WHY A POPUP AND NOT A REDIRECT
 * The analysis session lives entirely in memory (ADR-012 — no cloud persistence
 * in V1). Navigating the tab to Google's consent screen would throw away the
 * coach's Motion Layer draft, annotations and unsaved frames on the way out. The
 * popup keeps the workspace alive and reports back by postMessage.
 */

export interface YouTubeConnection {
  connected: boolean;
  /** True while the initial status check is in flight (avoids a UI flash). */
  loading: boolean;
  /** True while a consent popup is open. */
  connecting: boolean;
  channelTitle: string | null;
  error: string | null;
  /** Opens the consent popup; resolves true once the grant is stored. */
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
}

interface StatusBody {
  connected?: boolean;
  channelTitle?: string | null;
  error?: string;
}

/** Matches the payload posted by app/api/youtube/connect/callback. */
interface ConnectMessage {
  type?: string;
  ok?: boolean;
  error?: string;
}

const POPUP_W = 520;
const POPUP_H = 640;

export function useYouTubeConnection(enabled = true): YouTubeConnection {
  const [connected, setConnected] = useState(false);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against setting state after unmount (the popup outlives fast navigations). */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!enabled) { setLoading(false); return false; }
    try {
      const res = await fetch('/api/youtube/status', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as StatusBody;
      const isConnected = res.ok && body.connected === true;
      if (aliveRef.current) {
        setConnected(isConnected);
        setChannelTitle(body.channelTitle ?? null);
      }
      return isConnected;
    } catch {
      if (aliveRef.current) setConnected(false);
      return false;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    setError(null);
    setConnecting(true);

    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_W) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_H) / 2));
    const popup = window.open(
      '/api/youtube/connect',
      'anglemotion-youtube-connect',
      `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top},noopener=no`,
    );

    if (!popup) {
      setConnecting(false);
      setError('Your browser blocked the pop-up. Allow pop-ups for this site, then try again.');
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const finish = (ok: boolean, message?: string) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearInterval(pollId);
        if (aliveRef.current) {
          setConnecting(false);
          if (message) setError(message);
        }
        resolve(ok);
      };

      const onMessage = async (ev: MessageEvent) => {
        // Same-origin only: the callback posts with our origin as targetOrigin,
        // so anything else is not ours and must be ignored.
        if (ev.origin !== window.location.origin) return;
        const data = ev.data as ConnectMessage | null;
        if (!data || data.type !== 'youtube-connect') return;

        if (data.ok) {
          // Trust the server, not the message: re-read status so `connected`
          // reflects a row that actually exists.
          const ok = await refresh();
          finish(ok, ok ? undefined : 'Connected, but the status check failed. Try again.');
        } else {
          finish(false, data.error || 'Could not connect YouTube.');
        }
      };

      window.addEventListener('message', onMessage);

      // The coach may close the popup without finishing, in which case no
      // message ever arrives. Poll for that so the UI never hangs on "Connecting…".
      const pollId = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(pollId);
        // A success message can land in the same tick the window closes; give it
        // a beat before declaring cancellation.
        window.setTimeout(() => {
          if (settled) return;
          void refresh().then((ok) =>
            finish(ok, ok ? undefined : 'Connection window was closed before finishing.'),
          );
        }, 400);
      }, 500);
    });
  }, [enabled, refresh]);

  const disconnect = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/youtube/disconnect', { method: 'POST' });
      if (!res.ok) return false;
      if (aliveRef.current) {
        setConnected(false);
        setChannelTitle(null);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  return { connected, loading, connecting, channelTitle, error, connect, disconnect, refresh };
}
