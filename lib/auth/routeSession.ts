import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function getRouteSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const providerToken =
    (session as { provider_token?: string }).provider_token ??
    (session as { provider_refresh_token?: string }).provider_refresh_token;
  return {
    userId: session.user.id,
    email: session.user.email,
    supabase,
    /** Google OAuth access token — required for YouTube / Docs APIs when present */
    googleAccessToken: typeof providerToken === 'string' ? providerToken : null,
  };
}
