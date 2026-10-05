import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { getEntitlement } from '@/lib/entitlements.server';
import { canDownloadEbook } from '@/lib/entitlements';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { EBOOK_TITLE } from '@/lib/plans';

/**
 * The Spin Mechanics ebook — a bonus of YEARLY Pro and Academy subscriptions.
 *
 * The PDF lives in the PRIVATE Supabase Storage bucket "ebooks" (object
 * "spin-mechanics.pdf", uploaded by Vin in the dashboard — never committed to
 * the repo). Clients have no access to that bucket; this route signs a
 * short-lived URL with the service role for entitled coaches only.
 *
 * GET  → { eligible, available } (signs and discards a URL to prove the file
 *        exists, so /billing never shows a link that would break).
 * POST → { url } fresh 2-minute signed URL, or { available: false }.
 */

const BUCKET = 'ebooks';
const OBJECT = 'spin-mechanics.pdf';
const EXPIRES_SECONDS = 120;

type SignResult = { url: string; reason?: undefined } | { url: null; reason: string };

async function signEbook(): Promise<SignResult> {
  const db = createSupabaseServiceClient();
  if (!db) return { url: null, reason: 'service client not configured' };
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(OBJECT, EXPIRES_SECONDS, { download: `${EBOOK_TITLE.replace(/\s+/g, '-')}.pdf` });
  if (error || !data?.signedUrl) return { url: null, reason: error?.message ?? 'no signed url' };
  return { url: data.signedUrl };
}

async function eligibility() {
  const session = await getRouteSession();
  if (!session) return { session: null, eligible: false };
  const ent = await getEntitlement(session.supabase, { id: session.userId, email: session.email }, { startTrial: false });
  return { session, eligible: canDownloadEbook(ent) };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const { session, eligible } = await eligibility();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!eligible) return NextResponse.json({ eligible: false, available: false }, { headers: NO_STORE });
    const signed = await signEbook();
    if (!signed.url) console.warn('[ebook] not available:', signed.reason);
    return NextResponse.json({ eligible: true, available: !!signed.url }, { headers: NO_STORE });
  } catch (e) {
    console.error('[ebook] check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ eligible: false, available: false }, { headers: NO_STORE });
  }
}

export async function POST() {
  try {
    const { session, eligible } = await eligibility();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!eligible) {
      return NextResponse.json(
        { error: 'plan_required', message: `${EBOOK_TITLE} comes with yearly Pro and Academy plans.` },
        { status: 403 },
      );
    }
    const signed = await signEbook();
    if (!signed.url) {
      console.warn('[ebook] not available:', signed.reason);
      return NextResponse.json({ available: false }, { headers: NO_STORE });
    }
    return NextResponse.json({ available: true, url: signed.url }, { headers: NO_STORE });
  } catch (e) {
    console.error('[ebook] sign failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ available: false }, { headers: NO_STORE });
  }
}
