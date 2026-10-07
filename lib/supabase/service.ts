import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * What kind of Supabase key a value is, judged from its format only — never
 * logged or returned as the value itself.
 *
 *  - 'secret'           new-format secret key (`sb_secret_…`): service role, bypasses RLS
 *  - 'jwt:service_role' legacy service_role JWT: bypasses RLS
 *  - 'publishable'      new-format publishable key (`sb_publishable_…`): runs as ANON
 *  - 'jwt:anon'         legacy anon JWT: runs as ANON
 *  - 'jwt:<role>'       any other legacy JWT role
 *  - 'unknown'          not a format we recognise
 *  - 'missing'          unset or empty
 *
 * Why this exists: a publishable/anon key in the service-role slot does not fail
 * at startup. Every server write then runs as anon and is refused by RLS
 * ("new row violates row-level security policy"), and reads silently come back
 * empty — which is how YouTube Connect broke in production (2026-10-07).
 */
export type SupabaseKeyKind =
  | 'secret'
  | 'publishable'
  | 'jwt:service_role'
  | 'jwt:anon'
  | `jwt:${string}`
  | 'unknown'
  | 'missing';

export function supabaseKeyKind(value: string | undefined): SupabaseKeyKind {
  const key = value?.trim();
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length === 3 && key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown };
      return `jwt:${typeof payload.role === 'string' ? payload.role : 'none'}`;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

/**
 * Env var names accepted for the server's admin key, in order. The first one
 * holding a service-role key wins.
 *
 * SUPABASE_SERVICE_ROLE_KEY is the name this project has always used (see
 * .env.example). SUPABASE_SECRET_KEY is accepted too, because that is the name
 * the new-format `sb_secret_…` keys are commonly stored under — a deployment that
 * added the new key under that name should not need the old name as well.
 */
export const SERVICE_KEY_ENV_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'] as const;

const isServiceKind = (k: SupabaseKeyKind) => k === 'secret' || k === 'jwt:service_role';

let reported = false;

/**
 * Service-role Supabase client — SERVER ONLY (bypasses RLS).
 *
 * Required by the Stripe webhook and the YouTube connection store, which write
 * with no user session or to tables no user may touch. Returns null — with a
 * loud, specific error — when no accepted env var holds a service-role key. It
 * NEVER builds a client from a publishable/anon key: that client would look
 * configured and then fail every write on RLS (or read nothing) far from here.
 */
export function createSupabaseServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.error('[supabase/service] NEXT_PUBLIC_SUPABASE_URL is not set — server writes are disabled.');
    return null;
  }

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = SERVICE_KEY_ENV_NAMES.find((n) => isServiceKind(supabaseKeyKind(process.env[n])));
  if (service) return createClient(url, process.env[service]!.trim(), opts);

  // An unrecognised format is passed through rather than refused (Supabase may
  // introduce new key formats), but said out loud once.
  const unknown = SERVICE_KEY_ENV_NAMES.find((n) => supabaseKeyKind(process.env[n]) === 'unknown');
  if (unknown) {
    if (!reported) {
      reported = true;
      console.error(
        `[supabase/service] ${unknown} is set but is not a recognised Supabase key format ` +
          '(expected sb_secret_… or a service_role JWT). Using it anyway; if server writes fail ' +
          'with "row-level security", this key is the cause.',
      );
    }
    return createClient(url, process.env[unknown]!.trim(), opts);
  }

  const found = SERVICE_KEY_ENV_NAMES.map((n) => `${n}=${supabaseKeyKind(process.env[n])}`).join(', ');
  console.error(
    `[supabase/service] NO SERVICE-ROLE KEY — server writes are disabled (${found}). ` +
      'Set SUPABASE_SERVICE_ROLE_KEY to the project\'s SECRET key (sb_secret_…, Supabase → ' +
      'Project Settings → API Keys) in Vercel → Environment Variables → Production, then redeploy. ' +
      'A publishable (sb_publishable_…) or anon key there makes every server write fail on RLS.',
  );
  return null;
}
