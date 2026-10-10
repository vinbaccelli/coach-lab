import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import { settingsFromRow, settingsPatchFromForm, settingsProblems, DEFAULT_SETTINGS_ROW } from '@/lib/billing/invoicing/settings';

/**
 * Admin: Vin's fiscal data and invoicing rules (D9), the single
 * invoice_settings row. GET returns it (SQL defaults when never saved) and
 * what is still missing; PUT saves the form. Admin-only; service role.
 */
export async function GET() {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  try {
    const { row, settings } = await loadInvoiceSettings(access.db);
    return NextResponse.json(
      { settings: { ...DEFAULT_SETTINGS_ROW, ...(row ?? {}) }, problems: settingsProblems(settings) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read settings' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const session = await getRouteSession();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch = settingsPatchFromForm(body);

  const { data, error } = await access.db
    .from('invoice_settings')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString(), updated_by: session?.email ?? null }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: `Could not save: ${error.message}` }, { status: 500 });
  return NextResponse.json({ settings: data, problems: settingsProblems(settingsFromRow(data)) });
}
