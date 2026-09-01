'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ENABLE_GOOGLE_EXPORTS, GOOGLE_EXPORT_SCOPES } from '@/lib/featureFlags';
import { LayoutGrid, LogIn, LogOut } from 'lucide-react';

type Props = {
  children: React.ReactNode;
  /** Shown in the header when set (e.g. page name) */
  pageLabel?: string;
};

export default function WorkspaceChrome({ children, pageLabel }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router, supabase]);

  const signIn = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(window.location.pathname)}`,
        // Sensitive scopes only when Google exports are enabled (post
        // verification) — requesting them from an unverified app shows every
        // user a scary warning screen. Keep in sync with LoginClient.tsx / useAuth.ts.
        ...(ENABLE_GOOGLE_EXPORTS
          ? {
              scopes: GOOGLE_EXPORT_SCOPES,
              queryParams: { access_type: 'offline', prompt: 'consent' },
            }
          : {}),
      },
    });
    if (error) console.error('Sign in error:', error.message);
  }, [supabase]);

  return (
    <div
      style={{
        /*
          MOBILE-BROWSER VIEWPORT — 100dvh ONLY, deliberately no 100vh floor.
        
          `minHeight: '100vh'` used to sit here as a fallback, and on iPhone
          Safari it silently broke the bottom of every page. On iOS, 100vh is the
          LARGE viewport (the height the page would have if the toolbar were
          hidden) while 100dvh is the height actually visible right now; with the
          toolbar showing, 100vh is the taller of the two, and min-height beats
          height. So this column was laid out ~60–90px taller than the screen,
          `body { overflow: hidden }` (app/globals.css) clipped the excess with
          nothing able to scroll it, and the bottom of <main> — the scroll
          container itself — sat underneath Safari's tab bar. Scrolling to the end
          of a long page still left its last button unreachable behind the browser
          chrome. This is the manual match recorder's "Save & Export to Google
          Doc" bug, and it applied to every page using this chrome.
        
          100dvh alone tracks the visible viewport as the toolbar shows and hides,
          which is what an overflow:hidden app shell needs. It matches what
          app/analysis/layout.tsx and the body rule already do.
        */
        height: '100dvh',
        overflow: 'hidden',
        background: 'var(--cl-bg-primary)',
        color: 'var(--cl-text-primary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px 14px',
          padding: '12px 16px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          borderBottom: '1px solid var(--cl-border)',
          background: 'var(--cl-bg-panel)',
          zIndex: 50,
        }}
      >
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: 15,
            color: 'var(--cl-text-primary)',
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--cl-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LayoutGrid size={18} color="#fff" />
          </span>
          AngleMotion
        </Link>

        {pageLabel ? (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--cl-text-secondary)',
              borderLeft: '1px solid var(--cl-border)',
              paddingLeft: 14,
            }}
          >
            {pageLabel}
          </span>
        ) : null}

        <span style={{ flex: 1, minWidth: 8 }} />

        {supabase ? (
          email ? (
            <>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--cl-text-secondary)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  maxWidth: 'min(100%, 220px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={email}
              >
                {email}
              </span>
              <Link
                href="/pricing"
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--cl-accent)', textDecoration: 'none', padding: '0 4px' }}
              >
                Pricing
              </Link>
              <button
                type="button"
                onClick={signOut}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 10, border: '1px solid var(--cl-border)', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              <LogIn size={15} /> Sign in with Google
            </button>
          )
        ) : null}
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom:
            'calc(var(--anglemotion-install-banner-height, 0px) + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {children}
      </main>
    </div>
  );
}
