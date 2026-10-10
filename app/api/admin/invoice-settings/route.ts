import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import {
  pendingRules, settingsFromRow, settingsPatchFromForm, settingsProblems, unsupportedChars, DEFAULT_SETTINGS_ROW,
  type InvoiceSettings, type InvoiceSettingsRow,
} from '@/lib/billing/invoicing/settings';

/** The row as the form edits it: structured rules normalised, plus what is missing / pending. */
function view(row: Partial<InvoiceSettingsRow> | null, settings: InvoiceSettings) {
  return {
    settings: {
      ...DEFAULT_SETTINGS_ROW,
      ...(row ?? {}),
      tax_rules: settings.taxRules,
      wording_status: settings.wordingStatus,
      stamp_duty_rules: settings.stampDuty.rules,
      foreign_private_id_status: settings.foreignPrivateIdStatus,
    },
    problems: settingsProblems(settings),
    pending: pendingRules(settings),
    wordingUnsupportedChars: unsupportedChars(settings.wording),
  };
}

/**
 * Admin: Vin's fiscal data and invoicing rules (D9), the single
 * invoice_settings row. GET returns it (SQL defaults when never saved), what
 * is still missing, and every rule awaiting the commercialista; PUT saves the
 * form (the wording exactly as typed). Admin-only; service role. Never in
 * Vercel env vars.
 */
export async function GET() {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  try {
    const { row, settings } = await loadInvoiceSettings(access.db);
    return NextResponse.json(view(row, settings), { headers: { 'Cache-Control': 'no-store' } });
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
  return NextResponse.json(view(data as Partial<InvoiceSettingsRow>, settingsFromRow(data)));
}
