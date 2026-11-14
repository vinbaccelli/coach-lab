'use client';

/** The sections of a player profile. One scrollable row of tabs; the choice is kept in the URL (?tab=). */
export const PROFILE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'technical', label: 'Technical' },
  { id: 'progress', label: 'Progress' },
  { id: 'biometrics', label: 'Biometrics' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'timeline', label: 'Timeline' },
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number]['id'];

export const isProfileTab = (v: string | null | undefined): v is ProfileTab => PROFILE_TABS.some((t) => t.id === v);

export default function ProfileTabs({ value, onChange, badges = {} }: { value: ProfileTab; onChange: (t: ProfileTab) => void; badges?: Partial<Record<ProfileTab, number>> }) {
  return (
    <nav aria-label="Player sections" style={{ position: 'sticky', top: 0, zIndex: 15, margin: '0 0 16px', padding: '8px 0', background: 'var(--cl-bg-primary, #f2f2f7)' }}>
      <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', padding: 3, borderRadius: 12, background: 'rgba(118,118,128,0.12)' }}>
        {PROFILE_TABS.map((t) => {
          const active = t.id === value;
          const n = badges[t.id] ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              style={{
                flex: '1 0 auto', padding: '7px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: active ? 700 : 500,
                background: active ? 'var(--cl-bg-panel, #fff)' : 'transparent',
                color: 'var(--cl-text-primary)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {t.label}
              {n ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#a05a00' }}>{n}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
