'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { TRUSTPILOT_PROFILE_URL } from '@/lib/trustpilot';
import {
  FIRST_USE_EVENT, isReviewPromptPath, parseReviewPromptState, reviewPromptKey, shouldShowAfterFirstUse, shouldShowReviewPrompt,
  type ReviewPromptState,
} from '@/lib/reviewPrompt';

/**
 * A small neutral card asking a signed-in user for a Trustpilot review: right after the first sign-in
 * and then once a month (lib/reviewPrompt.ts). A plain link: nothing is loaded from Trustpilot until
 * the user taps it. Same text and timing for every user; no incentive.
 */
export default function ReviewPrompt() {
  const pathname = usePathname() ?? '/';
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => { if (!cancelled) setUserId(data.user?.id ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const read = (uid: string): ReviewPromptState | null => {
    try { return parseReviewPromptState(localStorage.getItem(reviewPromptKey(uid))); } catch { return null; }
  };
  const write = (uid: string, state: ReviewPromptState) => {
    try { localStorage.setItem(reviewPromptKey(uid), JSON.stringify(state)); } catch { /* private mode */ }
  };

  // 1 — right at the start (first sign-in), and once a month after a "Not now".
  useEffect(() => {
    if (!userId || !isReviewPromptPath(pathname)) { setOpen(false); return; }
    if (!shouldShowReviewPrompt(read(userId), Date.now())) return;
    // A moment in, so the page has drawn first.
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [userId, pathname]);

  // 2 — once more after the first real use: the analysis page announces that a video was loaded.
  useEffect(() => {
    if (!userId) return;
    const onUse = () => {
      const st = read(userId);
      if (!shouldShowAfterFirstUse(st)) return;
      write(userId, { ...(st ?? {}), firstUseShown: true });
      setTimeout(() => setOpen(true), 4000);
    };
    window.addEventListener(FIRST_USE_EVENT, onUse);
    return () => window.removeEventListener(FIRST_USE_EVENT, onUse);
  }, [userId]);

  const save = (done: boolean) => {
    if (!userId) return;
    write(userId, { ...(read(userId) ?? {}), lastAt: Date.now(), ...(done ? { done: true } : {}) });
  };

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Review AngleMotion"
      style={{
        position: 'fixed', zIndex: 99990, left: 12, right: 12, margin: '0 auto', maxWidth: 420,
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        padding: '12px 14px', borderRadius: 14, background: '#fff', color: '#1D1D1F',
        border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15 }}>How is AngleMotion working for you?</div>
      <div style={{ fontSize: 13, color: '#555', marginTop: 4, lineHeight: 1.4 }}>
        A short, honest review on Trustpilot helps other coaches decide. You&rsquo;ll be asked to sign in to Trustpilot first.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <a
          href={TRUSTPILOT_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { save(true); setOpen(false); }}
          style={{ flex: 1, textAlign: 'center', padding: '9px 12px', borderRadius: 10, background: '#007AFF', color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
        >
          Write a review
        </a>
        <button
          type="button"
          onClick={() => { save(false); setOpen(false); }}
          style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.18)', background: '#fff', color: '#1D1D1F', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
