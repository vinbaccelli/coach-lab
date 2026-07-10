import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAdmin } from '@/lib/admin';

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
    pathname.startsWith('/coach/')
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
    // /academy   → Pro or Academy only (Light is analysis-with-metrics).
    // Admins bypass. Fails OPEN on query errors so an infra hiccup never locks
    // paying coaches out. `tier` defaults to 'pro' for pre-tier rows.
    const gated = pathname.startsWith('/analysis') || pathname.startsWith('/academy');
    if (gated && !isAdmin(user.email)) {
      try {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('status, tier')
          .eq('user_id', user.id)
          .maybeSingle<{ status: string; tier: string | null }>();
        const active = sub?.status === 'active' || sub?.status === 'trialing';
        // Only 'light' is blocked from the academy; unknown/missing tier is
        // treated as allowed (fail open) so a missing column never locks anyone out.
        const academyOk = sub?.tier !== 'light';
        const allowed = active && (!pathname.startsWith('/academy') || academyOk);
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

