import { muted } from '@/components/players/ui';

/** Shown when a new section's database tables have not been created yet (its SQL is run once by the owner). */
export default function SetupNotice({ what }: { what: string }) {
  return (
    <div role="status" style={{ border: '1px dashed var(--cl-border)', borderRadius: 12, padding: 12, background: 'rgba(255,159,10,0.06)' }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{what} needs a one-time database update</div>
      <div style={{ ...muted, marginTop: 4 }}>
        The app is ready; the database tables for this section have not been created yet. Nothing else is affected.
        (Owner: run the SQL in supabase/migrations listed in docs/PLAYER_DATABASE.md.)
      </div>
    </div>
  );
}
