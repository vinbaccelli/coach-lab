import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getEntitlement } from '@/lib/entitlements.server';
import { hasAppAccess } from '@/lib/entitlements';

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
    // /analysis and /academy need app access: a granting subscription (active,
    // trialing, or past_due while Stripe retries), the free hour, or an admin
    // account. The policy is lib/entitlements.ts; the inputs are read by
    // lib/entitlements.server.ts, which also starts the free hour on the first
    // gated visit. Fails OPEN on query errors so an infra hiccup never locks
    // paying coaches out.
    const gated = pathname.startsWith('/analysis') || pathname.startsWith('/academy');
    if (gated) {
      try {
        const ent = await getEntitlement(supabase, user, { startTrial: true });
        if (!hasAppAccess(ent)) {
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

