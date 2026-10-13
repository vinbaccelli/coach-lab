/**
 * The guided tours' on/off switch (pure; the hook is lib/useToursEnabled.ts).
 *
 * While TOURS_ENABLED_FOR_ALL is false the tours are completely hidden: the
 * engine (components/GuidedTour.tsx) is not mounted, so there is no welcome
 * card, no auto-start, no resumed tour, no floating ? and no tour pictures
 * requested; the ? in the /analysis zoom cluster is not rendered either.
 *
 * A tester turns them on by opening any page with `?tours=1`. That stays on
 * for the rest of the browser-tab session (sessionStorage — no cookie), across
 * client-side and full navigations; `?tours=0` turns it off again.
 *
 * Launch: set TOURS_ENABLED_FOR_ALL to true. Nothing else changes — every
 * screen then shows the tours for everyone, whatever the URL says.
 */
export const TOURS_ENABLED_FOR_ALL = false;

export const TOURS_URL_PARAM = 'tours';
/** sessionStorage key holding this tab's `?tours=1` opt-in. */
export const SS_TOURS_OPT_IN = 'anglemotion-tours-opt-in';

/**
 * Whether the tours are on, and what to do with the per-session opt-in.
 * `search` is `location.search`; `optedIn` is whether this session already
 * opted in.
 */
export function resolveToursEnabled(
  forAll: boolean,
  search: string,
  optedIn: boolean,
): { enabled: boolean; store: 'set' | 'clear' | null } {
  if (forAll) return { enabled: true, store: null };
  let param: string | null = null;
  try {
    param = new URLSearchParams(search).get(TOURS_URL_PARAM);
  } catch {
    param = null;
  }
  if (param === '1') return { enabled: true, store: optedIn ? null : 'set' };
  if (param === '0') return { enabled: false, store: optedIn ? 'clear' : null };
  return { enabled: optedIn, store: null };
}
