import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { safeRedirectPath } from '@/lib/billing/checkoutIntent';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { attributeReferral } from '@/lib/affiliates.server';
import { REF_COOKIE } from '@/lib/affiliates';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Same-origin paths only: `new URL('//evil.com', origin)` or an absolute URL
  // would otherwise send a freshly signed-in visitor to another site.
  const redirectTo = safeRedirectPath(searchParams.get('redirect'));

  // Bind Set-Cookie to THIS response object. In Next 15 route handlers, cookies
  // written to the `next/headers` store are not reliably attached to a
  // separately-constructed NextResponse.redirect — so the session cookie was
  // being dropped on the first hop to `/`, whose server-side getUser() then
  // rendered the logged-out landing page. That is the "first sign-in attempt
  // bounces to landing, second works" bug. Writing onto the returned response
  // mirrors the working pattern in middleware.ts (res.cookies.set).
  const response = NextResponse.redirect(new URL(redirectTo, origin));

  if (code) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anon, {
      cookies: {
        // Read incoming cookies (incl. the PKCE code verifier) from the request.
        getAll() {
          return cookieStore.getAll();
        },
        // Write the freshly-minted session cookies onto the redirect response.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const exchanged = await supabase.auth.exchangeCodeForSession(code);

    // Affiliate attribution (lib/affiliates.server.ts): the am_ref cookie set by
    // /r/<code> makes this coach that affiliate's referral, first link wins.
    // Best effort — it must NEVER break sign-in.
    try {
      const ref = cookieStore.get(REF_COOKIE)?.value;
      const userId = exchanged?.data?.user?.id;
      if (ref && userId) await attributeReferral(createSupabaseServiceClient(), userId, ref);
    } catch (e) {
      console.warn('[affiliates] signup attribution skipped:', e instanceof Error ? e.message : e);
    }
  }

  return response;
}
