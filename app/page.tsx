import WorkspaceChrome from '@/components/WorkspaceChrome';
import ControlPanelHome from '@/components/ControlPanelHome';
import LandingPage from '@/components/LandingPage';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Root route: public marketing landing for logged-out visitors, the coach
 * dashboard for signed-in users. (Middleware lets `/` through publicly; the
 * auth check happens here.)
 */
export default async function HomePage() {
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    signedIn = !!data.user;
  } catch {
    signedIn = false;
  }

  if (!signedIn) return <LandingPage />;

  return (
    <WorkspaceChrome>
      <ControlPanelHome />
    </WorkspaceChrome>
  );
}
