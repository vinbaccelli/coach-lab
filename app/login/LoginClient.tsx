'use client';

/**
 * Sign-in surface. Part of the landing surface, not the app chrome: it carries
 * the marketing page's visual world (white ground, one blue accent, the ruled
 * spine and tabular date stamps) and always offers a way back to `/`.
 * See .impeccable/surfaces/components-landingpage-tsx.md.
 *
 * Auth behaviour is deliberately unchanged — Google OAuth, the `redirect`
 * param, the loading and error states all work exactly as before.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ENABLE_GOOGLE_EXPORTS, GOOGLE_EXPORT_SCOPES } from '@/lib/featureFlags';

/** What a new account actually gets. Mirrors DEMO in lib/plans.ts. */
const FIRST_ENTRIES = [
  { date: 'DAY 1', t: 'One free hour of every tool', b: 'No card, no booking. Bring a video you already have.' },
  { date: 'DAY 1', t: 'Your first analysed frame', b: '13+ joint angles read automatically — and editable by hand.' },
  { date: 'ONGOING', t: 'A file that keeps growing', b: 'Every session lands in the player’s technical and match documents.' },
];

export default function LoginClient({ redirect }: { redirect: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const signIn = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase env vars are missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
          // Sensitive scopes only when Google exports are enabled (post
          // verification) — an unverified app requesting them shows every user
          // a warning screen. Keep in sync with hooks/useAuth.ts.
          ...(ENABLE_GOOGLE_EXPORTS
            ? {
                scopes: GOOGLE_EXPORT_SCOPES,
                // Refresh tokens so exports keep working past the 1h expiry.
                queryParams: { access_type: 'offline', prompt: 'consent' },
              }
            : {}),
        },
      });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message ?? 'Login failed');
      setLoading(false);
    }
  }, [redirect, supabase]);

  return (
    <div className="lg-root">
      <style>{CSS}</style>

      <header className="lg-bar">
        <Link href="/" className="lg-wordmark" aria-label="AngleMotion home">
          <img src="/logo-square-new.jpg" alt="" width={26} height={26} />
          <span>Angle<span style={{ color: 'var(--cl-accent)' }}>Motion</span></span>
        </Link>
        <Link href="/" className="lg-back">
          <ArrowLeft size={16} aria-hidden="true" /> Back to the site
        </Link>
      </header>

      <main className="lg-main">
        {/* The sign-in step reads as the first entry of the visitor's own
            timeline rather than a modal dropped over the marketing page. */}
        <section className="lg-panel">
          <h1 className="lg-h1">Start your first file.</h1>
          <p className="lg-lede">
            Sign in with Google and every tool is open for one hour — no card, no booking.
          </p>

          <button type="button" onClick={signIn} disabled={loading || !supabase} className="lg-btn">
            {!supabase ? 'Missing Supabase config' : loading ? 'Opening Google…' : 'Continue with Google'}
          </button>

          {err && <p className="lg-err" role="alert">{err}</p>}

          <p className="lg-fine">
            By continuing you agree to store your videos as Unlisted in your YouTube account when
            importing from URLs.
          </p>

          <div className="lg-links">
            <Link href="/pricing">See pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </section>

        <aside className="lg-aside" aria-label="What happens next">
          <div className="lg-rail" aria-hidden="true" />
          <ol className="lg-entries">
            {FIRST_ENTRIES.map((e) => (
              <li key={e.t} className="lg-entry">
                <span className="lg-date">{e.date}</span>
                <h2 className="lg-t">{e.t}</h2>
                <p className="lg-b">{e.b}</p>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

const CSS = `
.lg-root {
  min-height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--cl-bg-panel);
  color: var(--cl-text-primary);
  font-family: var(--cl-font);
  -webkit-font-smoothing: antialiased;
}
.lg-root ::selection { background: var(--cl-accent); color: var(--cl-text-on-fill); }
.lg-root :focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 3px; border-radius: 8px; }

.lg-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px clamp(20px, 5vw, 56px);
  border-bottom: 1px solid var(--cl-border-subtle);
}
.lg-wordmark {
  display: inline-flex; align-items: center; gap: 9px;
  font-size: 17px; font-weight: 800; letter-spacing: -0.03em;
  color: inherit; text-decoration: none;
}
.lg-wordmark img { border-radius: var(--cl-radius-sm); display: block; }
.lg-back {
  display: inline-flex; align-items: center; gap: 7px; min-height: 44px;
  font-size: 15px; font-weight: 600; color: var(--cl-text-secondary); text-decoration: none;
}
.lg-back:hover { color: var(--cl-text-primary); }

.lg-main {
  flex: 1; display: grid; align-items: center;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
  gap: clamp(32px, 7vw, 96px);
  max-width: 1080px; width: 100%; margin: 0 auto;
  padding: clamp(40px, 8vw, 96px) clamp(20px, 5vw, 56px);
}
@media (max-width: 820px) {
  .lg-main { grid-template-columns: 1fr; align-items: start; gap: 44px; }
}

.lg-h1 {
  margin: 0 0 16px;
  font-size: clamp(34px, 6vw, 60px); line-height: 1.02;
  letter-spacing: -0.042em; font-weight: 800; text-wrap: balance;
}
.lg-lede { margin: 0 0 30px; max-width: 44ch; font-size: 17px; line-height: 1.55; color: var(--cl-text-secondary); }
.lg-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; max-width: 380px; min-height: 52px; padding: 0 26px;
  border: none; border-radius: 999px; cursor: pointer;
  background: var(--cl-accent); color: var(--cl-text-on-fill);
  font-family: inherit; font-size: 17px; font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 22px rgba(0,122,255,.18);
  transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s cubic-bezier(.16,1,.3,1);
}
.lg-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,.07), 0 14px 30px rgba(0,122,255,.24); }
.lg-btn:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
.lg-err { margin: 14px 0 0; max-width: 44ch; font-size: 15px; line-height: 1.5; color: var(--cl-destructive-text); }
.lg-fine { margin: 18px 0 0; max-width: 46ch; font-size: 13px; line-height: 1.5; color: var(--cl-text-secondary); }
.lg-links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 26px; }
.lg-links a {
  display: inline-flex; align-items: center; min-height: 44px;
  font-size: 15px; font-weight: 500; color: var(--cl-text-secondary); text-decoration: none;
}
.lg-links a:hover { color: var(--cl-text-primary); }

.lg-aside { position: relative; padding-left: 26px; }
.lg-rail { position: absolute; left: 0; top: 6px; bottom: 6px; width: 1px; background: var(--cl-border); }
.lg-rail::before {
  content: ''; position: absolute; left: -1px; top: 0; width: 3px; height: 34%;
  background: var(--cl-accent); border-radius: 999px;
}
.lg-entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 30px; }
.lg-date {
  display: block; margin-bottom: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums; color: var(--cl-text-secondary);
}
.lg-t { margin: 0 0 6px; font-size: 17px; font-weight: 650; letter-spacing: -0.02em; }
.lg-b { margin: 0; max-width: 42ch; font-size: 15px; line-height: 1.55; color: var(--cl-text-secondary); }
`;
