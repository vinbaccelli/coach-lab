'use client';

/**
 * RESTART BREADCRUMB (phones).
 *
 * When iOS ends a tab for memory, Chrome simply loads the page again and nothing says
 * so. This keeps a one-record trail in sessionStorage (it survives a reload of the
 * same tab and is gone with the tab) so the next load can say why the page restarted:
 *
 *   state  running | hidden | leaving     last thing the page told us
 *   at     ms timestamp of the last write
 *   lastError  the last `error` / `unhandledrejection`, if any
 *
 * A page that ends normally fires `pagehide` (state = leaving). A page the OS kills
 * fires nothing, so its record still says running/hidden on the next load. A reload is
 * seen in the navigation type of the new load. Everything is best-effort: storage can
 * be blocked, and nothing here may ever throw or block the app.
 */

export const TRAIL_KEY = 'anglemotion:page-trail';
/** An error older than this at the last write is not blamed for the end of the page. */
export const ERROR_BLAME_WINDOW_MS = 30_000;

export type TrailState = 'running' | 'hidden' | 'leaving';

export interface Trail {
  state: TrailState;
  at: number;
  lastError: { msg: string; at: number; kind: 'error' | 'rejection' } | null;
  /** The last thing the page said it was doing (`recordStage`), e.g. "Auto-detect: SAM frame 2/5". */
  stage?: string | null;
}

export type RestartReason = 'killed' | 'script-error' | 'reload';

export interface RestartVerdict {
  reason: RestartReason;
  /** The one dismissible line shown to the coach. */
  text: string;
}

export interface TrailStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function readTrail(storage: TrailStorage | null): Trail | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TRAIL_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<Trail>;
    if (t.state !== 'running' && t.state !== 'hidden' && t.state !== 'leaving') return null;
    if (typeof t.at !== 'number') return null;
    return { state: t.state, at: t.at, lastError: t.lastError ?? null, stage: typeof t.stage === 'string' ? t.stage : null };
  } catch {
    return null;
  }
}

export function writeTrail(storage: TrailStorage | null, t: Trail): void {
  try { storage?.setItem(TRAIL_KEY, JSON.stringify(t)); } catch { /* blocked or full */ }
}

/**
 * Why did the previous page end? `null` = it ended normally (or there is no record).
 * `navType` is the navigation type of THIS load ('navigate' | 'reload' | 'back_forward' …).
 */
export function classifyRestart(prev: Trail | null, navType: string | undefined): RestartVerdict | null {
  if (!prev) return null;
  const blamed = prev.lastError && prev.at - prev.lastError.at <= ERROR_BLAME_WINDOW_MS ? prev.lastError : null;
  const where = prev.stage ? ` Last step: ${prev.stage}.` : '';
  const scriptError = (e: NonNullable<Trail['lastError']>): RestartVerdict => ({
    reason: 'script-error',
    text: `The page restarted. Reason: a script error (${e.msg}).${where}`,
  });
  if (prev.state !== 'leaving') {
    // The page never said it was leaving: it was ended from outside.
    if (blamed) return scriptError(blamed);
    return {
      reason: 'killed',
      text: prev.state === 'hidden'
        ? `The page restarted. Reason: killed by the phone while it was in the background.${where}`
        : `The page restarted. Reason: killed by the phone (the page ended without warning, usually its memory).${where}`,
    };
  }
  if (navType === 'reload') {
    if (blamed) return scriptError(blamed);
    return { reason: 'reload', text: `The page restarted. Reason: a reload (the page was refreshed or reloaded itself).${where}` };
  }
  return null;
}

let activeStage: ((name: string) => void) | null = null;

/**
 * Say what the page is doing now. A no-op unless the breadcrumb is installed (phones only),
 * so callers can leave it in without a gate. Cheap: one small sessionStorage write, and it
 * skips the write when the stage has not changed.
 */
let lastStage: string | null = null;
export function recordStage(name: string): void {
  if (!activeStage || name === lastStage) return;
  lastStage = name;
  activeStage(name);
}

export interface BreadcrumbEnv {
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc: { visibilityState: string } & Pick<Document, 'addEventListener' | 'removeEventListener'>;
  storage: TrailStorage | null;
  navType: string | undefined;
  now?: () => number;
}

export function currentNavType(): string | undefined {
  try {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (e?.type) return e.type;
    const legacy = (performance as unknown as { navigation?: { type: number } }).navigation?.type;
    return legacy === 1 ? 'reload' : legacy === 2 ? 'back_forward' : legacy === 0 ? 'navigate' : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the previous page's record, classify it, start a new record, and keep it
 * current. Returns the verdict (or null) and a function that removes the listeners.
 */
export function installRestartBreadcrumb(env: BreadcrumbEnv): { verdict: RestartVerdict | null; dispose: () => void } {
  const now = env.now ?? (() => Date.now());
  const verdict = classifyRestart(readTrail(env.storage), env.navType);

  let trail: Trail = { state: env.doc.visibilityState === 'hidden' ? 'hidden' : 'running', at: now(), lastError: null };
  writeTrail(env.storage, trail);
  const update = (patch: Partial<Trail>) => {
    trail = { ...trail, ...patch, at: now() };
    writeTrail(env.storage, trail);
  };
  lastStage = null;
  activeStage = (name: string) => { if (trail.state !== 'leaving') update({ stage: name }); };
  const onOpening = () => activeStage?.('opening the editor (finalize)');
  const onDrawn = () => activeStage?.('editor open, first layers drawn');

  // `pagehide` can come BEFORE the `visibilitychange` that follows it on the way out (iOS
  // Safari, and Chrome on a reload): once the page has said it is leaving, a later hidden
  // must not turn that back into "backgrounded". Only `pageshow` ends the leaving state.
  const onVisibility = () => {
    if (trail.state === 'leaving') return;
    update({ state: env.doc.visibilityState === 'hidden' ? 'hidden' : 'running' });
  };
  // `persisted` = the page goes into the back/forward cache and may come back; it is not "leaving".
  const onPageHide = (e: Event) => update({ state: (e as PageTransitionEvent).persisted ? 'hidden' : 'leaving' });
  const onPageShow = () => update({ state: 'running' });
  const onError = (e: Event) => {
    const ev = e as ErrorEvent;
    const msg = String(ev.message || (ev.error && (ev.error as Error).message) || 'unknown error').slice(0, 160);
    update({ lastError: { msg, at: now(), kind: 'error' } });
  };
  const onRejection = (e: Event) => {
    const r = (e as PromiseRejectionEvent).reason;
    const msg = String((r && (r as Error).message) || r || 'unhandled rejection').slice(0, 160);
    update({ lastError: { msg, at: now(), kind: 'rejection' } });
  };

  env.doc.addEventListener('visibilitychange', onVisibility);
  env.win.addEventListener('pagehide', onPageHide);
  env.win.addEventListener('pageshow', onPageShow);
  env.win.addEventListener('error', onError);
  env.win.addEventListener('unhandledrejection', onRejection);
  env.win.addEventListener('stro:opening-editor', onOpening);
  env.win.addEventListener('stro:first-layers-drawn', onDrawn);
  return {
    verdict,
    dispose: () => {
      env.doc.removeEventListener('visibilitychange', onVisibility);
      env.win.removeEventListener('pagehide', onPageHide);
      env.win.removeEventListener('pageshow', onPageShow);
      env.win.removeEventListener('error', onError);
      env.win.removeEventListener('unhandledrejection', onRejection);
      env.win.removeEventListener('stro:opening-editor', onOpening);
      env.win.removeEventListener('stro:first-layers-drawn', onDrawn);
      activeStage = null;
    },
  };
}
