/**
 * The in-app Trustpilot review card: shown to every signed-in user right after their first sign-in, once
 * more after their first real use (a video loaded in the analysis page), and then once a month after a
 * "Not now". Trustpilot's rules (legal.trustpilot.com, business guidelines): the invitation must
 * be neutral, identical for everyone, with no incentive and no selection of happy users, so nothing here
 * looks at what the user did or felt. State lives only in this browser (nothing is sent anywhere).
 */
export const REVIEW_PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type ReviewPromptState = {
  /** When the card was last shown or snoozed (ms since epoch). Absent = never shown. */
  lastAt?: number;
  /** The user opened the Trustpilot page: never ask again. */
  done?: boolean;
  /** The extra ask after the user's first real use (a video loaded in the analysis page) was already shown. */
  firstUseShown?: boolean;
};

/** Pages where the card must not appear: the public pages and the sign-in flow. */
const HIDDEN_PREFIXES = ['/login', '/auth', '/share', '/privacy', '/terms', '/pricing', '/r/', '/coach', '/coaches'];

export function isReviewPromptPath(pathname: string): boolean {
  if (pathname === '/') return false;
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export function shouldShowReviewPrompt(state: ReviewPromptState | null, now: number): boolean {
  if (!state) return true; // right after the first sign-in
  if (state.done) return false;
  if (typeof state.lastAt !== 'number' || !Number.isFinite(state.lastAt)) return true;
  return now - state.lastAt >= REVIEW_PROMPT_INTERVAL_MS;
}

/** After the first real use (first video loaded): ask once more, unless they already reviewed or were already asked then. */
export function shouldShowAfterFirstUse(state: ReviewPromptState | null): boolean {
  return !state?.done && !state?.firstUseShown;
}

export function parseReviewPromptState(raw: string | null): ReviewPromptState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return {
      ...(typeof o.lastAt === 'number' && Number.isFinite(o.lastAt) ? { lastAt: o.lastAt } : {}),
      ...(o.done === true ? { done: true } : {}),
      ...(o.firstUseShown === true ? { firstUseShown: true } : {}),
    };
  } catch {
    return null;
  }
}

export const reviewPromptKey = (userId: string): string => `anglemotion:review-prompt:${userId}`;

/** Dispatched on `window` by the analysis page when the user's video is loaded. */
export const FIRST_USE_EVENT = 'anglemotion-first-use';
