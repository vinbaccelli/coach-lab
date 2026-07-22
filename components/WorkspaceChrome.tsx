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
        height: '100dvh',
        minHeight: '100vh',
        overflow: 'hidden',
        background: '#F5F5F7',
        color: '#1D1D1F',
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
          borderBottom: '1px solid #D1D1D6',
          background: '#FFFFFF',
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
            color: '#1D1D1F',
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#007AFF',
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
              color: '#6E6E73',
              borderLeft: '1px solid #D1D1D6',
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
                  color: '#6E6E73',
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
                style={{ fontSize: 12, fontWeight: 600, color: '#007AFF', textDecoration: 'none', padding: '0 4px' }}
              >
                Pricing
              </Link>
              <button
                type="button"
                onClick={signOut}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #D1D1D6', background: '#FFFFFF', color: '#1D1D1F', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 10, border: '1px solid #D1D1D6', background: '#007AFF', color: '#FFFFFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
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
