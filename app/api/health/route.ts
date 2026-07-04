import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Production diagnostics — steps through the session-route init chain and
 * reports which step fails (used to debug serverless-only 500s). Returns env
 * PRESENCE booleans only, never values. Safe to keep: read-only, no secrets.
 */
export async function GET() {
  const report: Record<string, unknown> = {
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GOOGLE_OAUTH_CLIENT_ID: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    },
    steps: {} as Record<string, string>,
  };
  const steps = report.steps as Record<string, string>;

  try {
    const { cookies } = await import('next/headers');
    await cookies();
    steps.cookies = 'ok';
  } catch (e) {
    steps.cookies = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    const supabase = await createSupabaseServerClient();
    steps.supabaseClient = 'ok';
    try {
      const { data, error } = await supabase.auth.getSession();
      steps.getSession = error ? `FAIL: ${error.message}` : `ok (session: ${data.session ? 'yes' : 'none'})`;
    } catch (e) {
      steps.getSession = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
    }
  } catch (e) {
    steps.supabaseClient = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { getRouteSession } = await import('@/lib/auth/routeSession');
    const s = await getRouteSession();
    steps.getRouteSession = `ok (${s ? 'authed' : 'anonymous'})`;
  } catch (e) {
    steps.getRouteSession = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(report);
}
