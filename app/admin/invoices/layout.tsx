import { notFound } from 'next/navigation';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';

/**
 * /admin/invoices is for administrators only (lib/admin.ts): anyone else gets
 * a 404, so the page doesn't even reveal it exists. Every API it calls checks
 * the same thing again (lib/billing/invoicing/adminAccess.ts) — the data never
 * depends on this page check alone.
 *
 * A local dev server without Supabase configured has no sessions at all; like
 * middleware.ts it fails open there so the UI can be checked, while the APIs
 * still answer 401.
 */
export const dynamic = 'force-dynamic';

export default async function AdminInvoicesLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const session = await getRouteSession().catch(() => null);
    if (!session || !isAdmin(session.email)) notFound();
  }
  return <>{children}</>;
}
