/** Admin email addresses with manager access */
export const ADMIN_EMAILS = [
  'vinbaccelli@gmail.com',
  'viniciusbaccelli@gmail.com',
];

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
