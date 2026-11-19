import WorkspaceChrome from '@/components/WorkspaceChrome';
import GuidedTour from '@/components/GuidedTour';
import ControlPanelHome from '@/components/ControlPanelHome';
import LandingPage from '@/components/LandingPage';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLivePrices } from '@/lib/billing/livePrices';
import JsonLd from '@/components/blog/JsonLd';
import { absoluteUrl, SITE_NAME } from '@/lib/seo/site';

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

  // Prices only for the logged-out landing (cached; lib/billing/livePrices.ts).
  if (!signedIn) {
    return (
      <>
        <JsonLd
          data={[
            {
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: SITE_NAME,
              url: absoluteUrl('/'),
              logo: absoluteUrl('/logo-square-new.jpg'),
              founder: { '@type': 'Person', name: 'Vin Baccelli', url: absoluteUrl('/coach/vinbaccelli') },
            },
            { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: absoluteUrl('/') },
          ]}
        />
        <LandingPage prices={await getLivePrices()} />
      </>
    );
  }

  return (
    <WorkspaceChrome>
      <ControlPanelHome />
      <GuidedTour page="control-panel" />
    </WorkspaceChrome>
  );
}
