/**
 * Is this Supabase/PostgREST error "the table (or function) does not exist yet"?
 *
 * New player-database modules ship their SQL as a migration the owner runs once. Until then
 * their routes answer `{ setupNeeded: true }` instead of failing, so a deploy that is ahead of
 * the database never breaks the parts of the app that already work.
 */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the (table|function)|relation .* does not exist/i.test(error.message ?? '');
}

export const SETUP_NEEDED = { setupNeeded: true } as const;
