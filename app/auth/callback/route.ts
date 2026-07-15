import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirect') || '/';

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
    await supabase.auth.exchangeCodeForSession(code);
  }

  return response;
}
