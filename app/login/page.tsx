import LoginClient from './LoginClient';

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 15 types searchParams as a Promise in PageProps.
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirect = sp.redirect || '/dashboard';
  return <LoginClient redirect={redirect} />;
}

