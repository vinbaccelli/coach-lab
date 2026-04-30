import LoginClient from './LoginClient';

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { redirect?: string };
}) {
  const redirect = searchParams?.redirect || '/dashboard';
  return <LoginClient redirect={redirect} />;
}

