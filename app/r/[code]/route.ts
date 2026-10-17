import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { referralRedirect } from '@/lib/affiliates.server';

/**
 * An affiliate link, /r/<code>. Records a click and sets the am_ref cookie for
 * an ACTIVE affiliate, then always redirects to the home page — whatever
 * happens. The logic (and its tests) is referralRedirect in
 * lib/affiliates.server.ts.
 */
export function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return referralRedirect(req, ctx.params, createSupabaseServiceClient);
}
