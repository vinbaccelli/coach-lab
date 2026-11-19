'use client';


/** The sections of a player profile. One scrollable row of tabs; the choice is kept in the URL (?tab=). */
export const PROFILE_TABS = [
  // First on purpose (architect, 2026-11-17): it is what the coach and the client use most, with the add controls
  // (comment, picture, YouTube, link). The profile opens on it.
  { id: 'timeline', label: 'Timeline' },
  { id: 'overview', label: 'Overview' },
  { id: 'technical', label: 'Technical' },
  // The definition of each stroke (the eBook) and this player's chosen variants; the Technical tab checks against it.
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'progress', label: 'Progress' },
  { id: 'biometrics', label: 'Biometrics' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'nutrition', label: 'Nutrition' },
] as const;
/** The tab a profile opens on. */
export const DEFAULT_PROFILE_TAB = 'timeline' as const;
export type ProfileTab = (typeof PROFILE_TABS)[number]['id'];

/** The tabs to show: all of them, or only these (the client's link shows what that link may see). Order is always the profile's. */
export const visibleTabs = (only?: readonly ProfileTab[]) => (only ? PROFILE_TABS.filter((t) => only.includes(t.id)) : PROFILE_TABS);

export const isProfileTab = (v: string | null | undefined): v is ProfileTab => PROFILE_TABS.some((t) => t.id === v);

/**
 * On a phone the row scrolls sideways: bring the open tab into view, so you can always see where you are
 * (opening Progress, Biometrics, Fitness, Nutrition or Blueprint used to leave the open tab off the right edge).
 * A callback ref, not an effect, so this file imports nothing from React and its pure exports (PROFILE_TABS …)
 * stay importable by the tests. It only moves the row when the open tab is not already fully visible.
 */
function scrollOpenTabIntoView(list: HTMLDivElement | null) {
  const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!list || !tab) return;
  const t = tab.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  if (t.left >= l.left && t.right <= l.right) return;
  const left = list.scrollLeft + (t.left - l.left) - (l.width - t.width) / 2;
  list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
}

export default function ProfileTabs({ value, onChange, badges = {}, only }: { value: ProfileTab; onChange: (t: ProfileTab) => void; badges?: Partial<Record<ProfileTab, number>>; only?: readonly ProfileTab[] }) {
  return (
    <nav aria-label="Player sections" style={{ position: 'sticky', top: 0, zIndex: 15, margin: '0 0 16px', padding: '8px 0', background: 'var(--cl-bg-primary, #f2f2f7)' }}>
      <div ref={scrollOpenTabIntoView} role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', padding: 3, borderRadius: 12, background: 'rgba(118,118,128,0.12)' }}>
        {visibleTabs(only).map((t) => {
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
