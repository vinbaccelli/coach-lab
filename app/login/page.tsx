'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const sp = useSearchParams();
  const redirect = sp.get('redirect') || '/dashboard';
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const signIn = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
          // We want refresh tokens so YouTube upload can work long-term.
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message ?? 'Login failed');
      setLoading(false);
    }
  }, [redirect, supabase]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0b0b0c' }}>
      <div style={{
        width: 'min(520px, 100%)',
        padding: 20,
        borderRadius: 18,
        background: 'rgba(15, 15, 18, 0.75)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        backdropFilter: 'blur(12px)',
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Coach Lab</h1>
        <p style={{ margin: '8px 0 16px', opacity: 0.85, fontSize: 13, lineHeight: 1.5 }}>
          Sign in to access your analysis workspace and player database.
        </p>

        <button
          onClick={signIn}
          disabled={loading}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.14)',
            background: loading ? 'rgba(255,255,255,0.08)' : '#35679A',
            color: '#fff',
            fontWeight: 800,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Opening Google…' : 'Continue with Google'}
        </button>

        {err && (
          <p style={{ marginTop: 12, fontSize: 12, color: '#FF3B30' }}>
            {err}
          </p>
        )}

        <p style={{ marginTop: 14, fontSize: 11, opacity: 0.65 }}>
          By continuing you agree to store your videos as Unlisted in your YouTube account when importing from URLs.
        </p>
      </div>
    </div>
  );
}

