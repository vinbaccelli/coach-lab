import LoginClient from './LoginClient';
import { pageMetadata } from '@/lib/seo/site';
import { safeRedirectPath } from '@/lib/billing/checkoutIntent';

// Always render at request time — this page reads the `redirect` query param
// and must never be served from a static prerender.
export const dynamic = 'force-dynamic';

// The auth gate sends every non-public URL here, so this page must never be indexed.
export const metadata = pageMetadata({
  title: 'Sign in – AngleMotion',
  description: 'Sign in to AngleMotion. New here? Sign in with Google and try every tool free for one hour.',
  path: '/login',
  noindex: true,
});

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 15 types searchParams as a Promise in PageProps.
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirect = safeRedirectPath(sp.redirect);
  return <LoginClient redirect={redirect} />;
}

