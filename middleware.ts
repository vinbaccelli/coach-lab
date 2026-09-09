import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAdmin } from '@/lib/admin';

/** Free self-serve trial length: one hour per account (see start_trial() SQL). */
const TRIAL_MS = 60 * 60 * 1000;

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Skip static/assets and auth endpoints. Any path with a file extension is
  // a public asset (images, wasm, models, manifest…) — auth-gating those
  // redirects them to /login and silently breaks workers and logged-out pages.
  const { pathname } = req.nextUrl;
  if (
    pathname === '/' ||           // public marketing landing (auth-checked in the page)
    /\.[a-zA-Z0-9]+$/.test(pathname) ||
    pathname.startsWith('/tfjs-wasm') ||
    pathname.startsWith('/models') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/coaches') ||
    pathname.startsWith('/coach/') ||
    // Dev-only rebuild harnesses under /dev/ (mask-editor Phase 1 verification).
    // NODE_ENV is inlined at build time, so in a production build this term is a
    // constant `false` and /dev/* is auth-gated exactly like any other route.
    (process.env.NODE_ENV !== 'production' && pathname.startsWith('/dev/'))
  ) {
    return res;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Fail-open if env isn't configured yet (prevents 500s on Vercel).
  if (!supabaseUrl || !supabaseAnonKey) return res;

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    // ── Subscription gate ───────────────────────────────────────────────────
    // /analysis  → any active tier (Light / Pro / Academy).
    // /academy   → any active tier as well, as of 2026-09-09.
    //
    // The Academy used to be Pro-and-above: `academyOk = sub?.tier !== 'light'`.
    // Founding pricing moved AngleMotion Academy into Light's feature list
    // (lib/plans.ts), so that exclusion would have made /pricing promise a
    // feature the app denied — see docs/KNOWN_ISSUES.md 008. Entitlement was
    // widened rather than the claim narrowed, on Vin's decision.
    //
    // Admins bypass. Fails OPEN on query errors so an infra hiccup never locks
    // paying coaches out.
    const gated = pathname.startsWith('/analysis') || pathname.startsWith('/academy');
    if (gated && !isAdmin(user.email)) {
      try {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('status, tier')
          .eq('user_id', user.id)
          .maybeSingle<{ status: string; tier: string | null }>();
        // Both gated routes now need the same thing: an active subscription.
        // No per-tier carve-out remains, so there is nothing tier-specific to
        // check here.
        const active = sub?.status === 'active' || sub?.status === 'trialing';
        let allowed = active;

        // No active subscription → fall back to the free 1-hour trial (one per
        // account, full access to every tool). start_trial() stamps
        // started_at=now() on the first call and is idempotent after, so this
        // one round-trip both starts and reads the trial clock.
        if (!allowed) {
          const { data: startedAt } = await supabase.rpc('start_trial');
          if (startedAt && Date.now() - new Date(startedAt as string).getTime() < TRIAL_MS) {
            allowed = true;
          }
        }

        if (!allowed) {
          const url = req.nextUrl.clone();
          url.pathname = '/pricing';
          url.searchParams.set('required', '1');
          return NextResponse.redirect(url);
        }
      } catch {
        // Fail open.
      }
    }
  } catch {
    // Never hard-fail the request from middleware.
    return res;
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Protect everything except:
     * - /login
     * - /auth/callback
     * - /api/*
     * - /_next/*
     */
    '/((?!login|auth/callback|api|_next|favicon.ico).*)',
  ],
};

