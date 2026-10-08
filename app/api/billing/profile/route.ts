import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseItalianFields } from '@/lib/billing/invoicing/italianFields';

/**
 * The signed-in coach's invoice details (billing_profiles) for the Italian
 * fattura elettronica: Codice Fiscale, Partita IVA, Codice Destinatario, PEC.
 * GET reads their own row (RLS select-own). PUT validates every field
 * (lib/billing/invoicing/italianFields.ts) and writes through the service role
 * — the table has no client write policies, and billing_country is only ever
 * written by the Stripe webhook, never here.
 */
const FIELDS = 'billing_country, codice_fiscale, partita_iva, codice_destinatario, pec';

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await session.supabase.from('billing_profiles').select(FIELDS).eq('user_id', session.userId).maybeSingle();
  if (error) {
    // Table not migrated yet: no profile, never a failed page.
    return NextResponse.json({ profile: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ profile: data ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseItalianFields(body);
  if (!parsed.ok) return NextResponse.json({ error: 'Please check the highlighted fields.', fields: parsed.errors }, { status: 400 });

  const db = createSupabaseServiceClient();
  if (!db) return NextResponse.json({ error: 'Saving is not available right now.' }, { status: 503 });
  const { data, error } = await db
    .from('billing_profiles')
    .upsert({ user_id: session.userId, ...parsed.value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select(FIELDS)
    .single();
  if (error) {
    console.error('[billing/profile] save failed:', error.message);
    return NextResponse.json({ error: 'Your invoice details could not be saved. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}
