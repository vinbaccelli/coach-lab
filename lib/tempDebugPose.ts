// TEMP-DEBUG-POSE — remove after the iPhone skeleton diagnosis.
//
// Phones have no console, so this draws one small on-screen panel with what the
// live skeleton is doing: which path runs it (worker / main thread), the backend
// and model, how often frames go out and results come back, how long each step
// takes, how long the current frame has been in flight, worker errors, and how
// janky the main thread is. Shown only with ?debug=1 (the same sticky
// sessionStorage flag the analysis page's TEMP-DEBUG overlay uses). Pure
// observation: nothing here changes what the skeleton does.

type Win = { t: number; v: number }[];

interface PoseDbg {
  mode: string;
  backend: string;
  model: string;
  sendCalls: number[];        // bridge.sendFrame entries (timestamps)
  sent: number[];             // frames actually posted to the worker / run on main
  results: number[];          // results received
  skipInit: number;
  skipNotReady: number;
  skipFrameSkip: number;
  skipBusy: number;
  inFlightSince: number | null;
  maxInFlightMs: number;
  bitmapMs: Win;
  rttMs: Win;
  inferMs: Win;
  nullResults: number;
  workerErrors: number;
  workerOnerror: number;
  bitmapFailures: number;
  events: string[];
  frameGaps: Win;
}

const D: PoseDbg = {
  mode: 'none', backend: '?', model: '?',
  sendCalls: [], sent: [], results: [],
  skipInit: 0, skipNotReady: 0, skipFrameSkip: 0, skipBusy: 0,
  inFlightSince: null, maxInFlightMs: 0,
  bitmapMs: [], rttMs: [], inferMs: [],
  nullResults: 0, workerErrors: 0, workerOnerror: 0, bitmapFailures: 0,
  events: [], frameGaps: [],
};

let enabled: boolean | null = null;
/**
 * Which deployment this is, so a screenshot proves the build it came from (a
 * test on 2026-10-06 turned out to have run the build before the fix). Vercel
 * exposes the commit to the client as NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.
 */
const BUILD_ID = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7);

export function poseDebugOn(): boolean {
  if (enabled !== null) return enabled;
  try {
    const v = new URLSearchParams(window.location.search).get('debug');
    if (v === '1') window.sessionStorage.setItem('am-temp-debug', '1');
    if (v === '0') window.sessionStorage.removeItem('am-temp-debug');
    enabled = window.sessionStorage.getItem('am-temp-debug') === '1';
  } catch {
    enabled = false;
  }
  if (enabled) install();
  return enabled;
}

/**
 * `&pose=thunder` (with ?debug=1): keep MoveNet THUNDER for the whole session
 * — no automatic drop to Lightning — so its real per-frame cost after warm-up
 * can be read off this panel. Sticky for the tab like the debug flag;
 * `&pose=auto` clears it. Ignored entirely without ?debug=1.
 */
export function poseDebugForcedModel(): 'thunder' | null {
  if (!poseDebugOn()) return null;
  try {
    const v = new URLSearchParams(window.location.search).get('pose');
    if (v === 'thunder') window.sessionStorage.setItem('am-temp-pose', 'thunder');
    if (v === 'auto') window.sessionStorage.removeItem('am-temp-pose');
    return window.sessionStorage.getItem('am-temp-pose') === 'thunder' ? 'thunder' : null;
  } catch {
    return null;
  }
}

const now = () => performance.now();
const keep = (a: number[], t: number) => { while (a.length && t - a[0] > 1000) a.shift(); };
const keepW = (a: Win, t: number) => { while (a.length && t - a[0].t > 3000) a.shift(); };

export const poseDbg = {
  set(k: 'mode' | 'backend' | 'model', v: string) { if (poseDebugOn()) D[k] = v; },
  sendCall() { if (poseDebugOn()) D.sendCalls.push(now()); },
  skip(why: 'init' | 'notReady' | 'frameSkip' | 'busy') {
    if (!poseDebugOn()) return;
    if (why === 'init') D.skipInit++;
    else if (why === 'notReady') D.skipNotReady++;
    else if (why === 'frameSkip') D.skipFrameSkip++;
    else D.skipBusy++;
  },
  sent() { if (!poseDebugOn()) return; const t = now(); D.sent.push(t); D.inFlightSince = t; },
  bitmap(ms: number) { if (poseDebugOn()) D.bitmapMs.push({ t: now(), v: ms }); },
  bitmapFailed() { if (poseDebugOn()) { D.bitmapFailures++; event('bitmap failed'); } },
  result(hasPose: boolean, inferMs?: number) {
    if (!poseDebugOn()) return;
    const t = now();
    D.results.push(t);
    if (D.inFlightSince !== null) D.rttMs.push({ t, v: t - D.inFlightSince });
    D.inFlightSince = null;
    if (!hasPose) D.nullResults++;
    if (typeof inferMs === 'number') D.inferMs.push({ t, v: inferMs });
  },
  workerError(msg: string) { if (poseDebugOn()) { D.workerErrors++; event(`worker error: ${msg}`); } },
  workerOnerror() { if (poseDebugOn()) { D.workerOnerror++; event('worker onerror'); } },
  event(msg: string) { if (poseDebugOn()) event(msg); },
};

function event(msg: string) {
  const s = (now() / 1000).toFixed(1);
  D.events.push(`${s}s ${msg}`);
  if (D.events.length > 8) D.events.shift();
}

function stats(w: Win): string {
  if (!w.length) return '-';
  const v = w.map((x) => x.v).sort((a, b) => a - b);
  return `${Math.round(v[v.length >> 1])}/${Math.round(v[v.length - 1])}`;
}

let installed = false;
function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const el = document.createElement('div');
  el.setAttribute('data-temp-debug-pose', '');
  Object.assign(el.style, {
    position: 'fixed', left: '4px', bottom: '4px', zIndex: '2147483647',
    maxWidth: 'calc(100vw - 8px)', padding: '4px 6px', borderRadius: '6px',
    background: 'rgba(0,0,0,0.78)', color: '#7CFC9A', pointerEvents: 'none',
    font: '10px/1.35 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap',
  } as Partial<CSSStyleDeclaration>);
  const attach = () => document.body?.appendChild(el);
  if (document.body) attach(); else window.addEventListener('DOMContentLoaded', attach, { once: true });

  // Main-thread jank: the longest gap between animation frames.
  let last = now();
  const tick = () => {
    const t = now();
    D.frameGaps.push({ t, v: t - last });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  setInterval(() => {
    const t = now();
    keep(D.sendCalls, t); keep(D.sent, t); keep(D.results, t);
    keepW(D.bitmapMs, t); keepW(D.rttMs, t); keepW(D.inferMs, t); keepW(D.frameGaps, t);
    const inFlightMs = D.inFlightSince === null ? 0 : t - D.inFlightSince;
    if (inFlightMs > D.maxInFlightMs) D.maxInFlightMs = inFlightMs;
    const gaps = D.frameGaps.map((g) => g.v);
    const maxGap = gaps.length ? Math.max(...gaps) : 0;
    const fps = D.frameGaps.length / 3;
    const vids = [...document.querySelectorAll('video')] as HTMLVideoElement[];
    const v = vids.find((x) => !x.paused) ?? vids.find((x) => x.readyState >= 2) ?? vids[0] ?? null;
    let vid = 'video: none';
    if (v) {
      const q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
      vid = `video t=${v.currentTime.toFixed(2)} ${v.paused ? 'paused' : 'PLAYING'} rs=${v.readyState}`
        + (q ? ` drop=${q.droppedVideoFrames}/${q.totalVideoFrames}` : '');
    }
    el.textContent = [
      `POSE ${D.mode} | ${D.backend} | ${D.model} | build ${BUILD_ID}`,
      `calls/s ${D.sendCalls.length} sent/s ${D.sent.length} res/s ${D.results.length} null ${D.nullResults}`,
      `skip init ${D.skipInit} notReady ${D.skipNotReady} fskip ${D.skipFrameSkip} busy ${D.skipBusy}`,
      `ms p50/max  bitmap ${stats(D.bitmapMs)}  infer ${stats(D.inferMs)}  rtt ${stats(D.rttMs)}`,
      `in flight ${Math.round(inFlightMs)}ms (max ${Math.round(D.maxInFlightMs)})${inFlightMs > 2500 ? '  STUCK' : ''}`,
      `errors worker ${D.workerErrors} onerror ${D.workerOnerror} bitmap ${D.bitmapFailures}`,
      `main fps ${fps.toFixed(0)} max gap ${Math.round(maxGap)}ms`,
      vid,
      ...D.events,
    ].join('\n');
  }, 500);
}
