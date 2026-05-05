import { redirect } from 'next/navigation';

/** @deprecated Use `/` — Control Panel home */
export default function DashboardRedirectPage() {
  redirect('/');
}
