import { notFound } from 'next/navigation';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';

/**
 * /admin/affiliates is for administrators only (lib/admin.ts): anyone else gets
 * a 404. Every API it calls checks the same thing again (adminInvoicesAccess in
 * lib/billing/invoicing/adminAccess.ts). Same pattern as /admin/invoices,
 * including failing open on a local dev server without Supabase configured.
 */
export const dynamic = 'force-dynamic';

export default async function AdminAffiliatesLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const session = await getRouteSession().catch(() => null);
    if (!session || !isAdmin(session.email)) notFound();
  }
  return <>{children}</>;
}
