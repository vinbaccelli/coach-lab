import LoginClient from './LoginClient';

// Always render at request time — this page reads the `redirect` query param
// and must never be served from a static prerender.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 15 types searchParams as a Promise in PageProps.
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirect = sp.redirect || '/';
  return <LoginClient redirect={redirect} />;
}

