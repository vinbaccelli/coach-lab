'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { LayoutGrid, LogOut } from 'lucide-react';

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

  return (
    <div
      style={{
        height: '100dvh',
        minHeight: '100vh',
        overflow: 'hidden',
        background: '#0b0b0c',
        color: '#fff',
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
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(15, 15, 18, 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: 50,
        }}
      >
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 800,
            fontSize: 15,
            color: '#fff',
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#35679A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LayoutGrid size={18} color="#fff" />
          </span>
          CoachLab
        </Link>

        {pageLabel ? (
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.55)',
              borderLeft: '1px solid rgba(255,255,255,0.15)',
              paddingLeft: 14,
            }}
          >
            {pageLabel}
          </span>
        ) : null}

        <span style={{ flex: 1, minWidth: 8 }} />

        {supabase ? (
          <>
            <span
              style={{
                fontSize: 12,
                opacity: 0.75,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                maxWidth: 'min(100%, 220px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={email ?? ''}
            >
              {email ?? '…'}
            </span>

            <button
              type="button"
              onClick={signOut}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 40,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Configure Supabase env vars to enable login.
          </span>
        )}
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom:
            'calc(var(--coachlab-install-banner-height, 0px) + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {children}
      </main>
    </div>
  );
}
