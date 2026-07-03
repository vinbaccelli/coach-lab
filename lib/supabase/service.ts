import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — SERVER ONLY (bypasses RLS).
 *
 * Required by the Stripe webhook, which runs with no user session: the anon
 * client would be blocked by RLS. Returns null when SUPABASE_SERVICE_ROLE_KEY
 * is not configured so callers can degrade gracefully.
 */
export function createSupabaseServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
