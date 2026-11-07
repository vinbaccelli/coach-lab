/**
 * LOOK-AHEAD live skeleton (standard playback, AI Track stays the slow exact pass).
 *
 * The live pose arrives one worker round trip (≈ 100 ms measured on a phone) after the
 * frame it describes, so whatever is drawn is always behind the picture. Instead of
 * guessing where the player is NOW, detect the frame the viewer will see ONE ROUND TRIP
 * LATER: a hidden second <video> of the same source is kept `lead` seconds ahead of the
 * visible one and is what the (unchanged) pose bridge captures frames from. Each result is
 * stored under the VIDEO time of the frame it describes, and drawn when the playhead
 * reaches that time, interpolated between neighbours — i.e. a baked track built a
 * moment ahead of the playhead. At playback speeds ≤ 0.5× the detections are dense
 * (detections per VIDEO second = detections per second ÷ speed).
 *
 * Memory: the only extra cost is one more video decoder plus a ≤ 3 s buffer of poses
 * (a few KB). The second video exists ONLY while the main one plays and is torn down on
 * pause / seek / end / skeleton-off (decoder released); any failure falls back to the
 * previous live path.
 *
 * EXPERIMENTAL and OFF by default (an iPhone test showed the hidden second video stalling the main one).
 * Switches (lib/skeletonSwitches.ts): link `?lookahead=1` turns it on, `?legacy=1` turns every skeleton change off.
 */

import { legacyOn, lookAheadOnSwitch } from './skeletonSwitches';

export interface AheadKp { x: number; y: number; score: number; name: string }

/** Keep this many seconds of results behind the playhead and drop anything older. */
const KEEP_BEHIND_S = 1;
const MAX_ENTRIES = 240;
/** Newest result may be held (not extrapolated) for at most this long past its time. */
const HOLD_S = 0.12;
/** Neighbours further apart than this are not interpolated across. */
const MAX_GAP_S = 0.5;
const SNAP_S = 0.25;

export class AheadBuffer {
  private items: Array<{ t: number; kps: AheadKp[] }> = [];

  get size() { return this.items.length; }
  clear() { this.items = []; }

  push(t: number, kps: AheadKp[]) {
    if (!Number.isFinite(t) || !kps?.length) return;
    const it = this.items;
    // keep ascending by time; a result for an existing time replaces it
    let i = it.length;
    while (i > 0 && it[i - 1].t > t) i--;
    if (i > 0 && Math.abs(it[i - 1].t - t) < 1e-4) it[i - 1] = { t, kps };
    else it.splice(i, 0, { t, kps });
    if (it.length > MAX_ENTRIES) it.splice(0, it.length - MAX_ENTRIES);
  }

  /** Drop what the playhead has long passed. */
  prune(playhead: number) {
    const cut = playhead - KEEP_BEHIND_S;
    let n = 0;
    while (n < this.items.length - 1 && this.items[n + 1].t < cut) n++;
    if (n > 0) this.items.splice(0, n);
  }

  /** Pose at video time `t`, or null when no result is close enough (caller falls back). */
  lookup(t: number): AheadKp[] | null {
    const it = this.items;
    if (!it.length) return null;
    const first = it[0], last = it[it.length - 1];
    if (t < first.t - SNAP_S) return null;
    if (t <= first.t) return first.kps;
    if (t >= last.t) return t - last.t <= HOLD_S ? last.kps : null;
    let lo = 0, hi = it.length - 1;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (it[mid].t <= t) lo = mid; else hi = mid; }
    const a = it[lo], b = it[hi];
    const span = b.t - a.t;
    if (span <= 0) return b.kps;
    if (span > MAX_GAP_S) return t - a.t < b.t - t ? (t - a.t <= SNAP_S ? a.kps : null) : (b.t - t <= SNAP_S ? b.kps : null);
    const f = (t - a.t) / span;
    return a.kps.map((p, i) => {
      const q = b.kps[i] && b.kps[i].name === p.name ? b.kps[i] : b.kps.find((k) => k.name === p.name);
      if (!q) return p;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, score: Math.min(p.score, q.score), name: p.name };
    });
  }
}

/** How far ahead (video seconds) the second video should run: one round trip plus margin, scaled by speed. */
export function leadSeconds(rttMs: number, playbackRate: number, marginMs = 40): number {
  const lead = ((Math.max(0, rttMs) + marginMs) * Math.max(0.05, playbackRate)) / 1000;
  return Math.min(0.8, Math.max(0.04, lead));
}

export type DriftAction =
  | { kind: 'rate'; rate: number }
  | { kind: 'seek'; to: number };

/**
 * Keep the ahead video exactly `lead` seconds in front of the main one. Small error ⇒ nudge
 * its playbackRate (≤ ±10 %, no visible/audible effect — it is hidden and muted); large
 * error (a seek, a stall) ⇒ jump it.
 */
export function driftAction(aheadT: number, mainT: number, lead: number, mainRate: number): DriftAction {
  const err = aheadT - mainT - lead; // + ⇒ too far ahead
  if (Math.abs(err) > 0.35) return { kind: 'seek', to: mainT + lead };
  if (Math.abs(err) > 0.03) {
    const nudge = Math.max(-0.1, Math.min(0.1, -err / 0.5));
    return { kind: 'rate', rate: mainRate * (1 + nudge) };
  }
  return { kind: 'rate', rate: mainRate };
}

export function lookAheadDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  // OFF by default: on an iPhone the second playing video stalled the main one (see docs/SKELETON_LOOKAHEAD.md).
  return legacyOn() || !lookAheadOnSwitch();
}

/**
 * The hidden second video. Created lazily when the main video plays, destroyed when it stops.
 * `failed` flips on any error / long stall; the caller then uses the previous live path.
 */
export class LookAheadVideo {
  video: HTMLVideoElement | null = null;
  failed = false;
  /** Why it failed (shown in the ?debug=1 panel). */
  failReason = '';
  private fail(reason: string) { if (!this.failed) { this.failed = true; this.failReason = reason; } }
  private startedAt = 0;
  private unplayableSince: number | null = null;
  private lastProgressAt = 0;
  private lastT = -1;

  start(main: HTMLVideoElement): boolean {
    if (this.video || typeof document === 'undefined') return !!this.video;
    const src = main.currentSrc || main.src;
    if (!src) { this.fail('no source'); return false; }
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.disablePictureInPicture = true;
    if (main.crossOrigin) v.crossOrigin = main.crossOrigin;
    // Not display:none — some mobile browsers do not decode a video that is not rendered.
    Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
    v.addEventListener('error', () => this.fail(`video error ${v.error?.code ?? ''}`));
    v.src = src;
    document.body.appendChild(v);
    this.video = v;
    this.startedAt = this.lastProgressAt = performance.now();
    this.unplayableSince = this.startedAt;
    return true;
  }

  /**
   * Usable right now: decodable AND actually advancing (a hidden video a phone refuses to play would
   * otherwise "be ready" while frozen and feed a frozen frame). Not advancing for > 0.8 s ⇒ not ready,
   * the caller uses the previous live path until it moves again (or it is marked failed after 2.5 s).
   */
  get ready() {
    const v = this.video;
    return !!v && !this.failed && v.readyState >= 2 && v.videoWidth > 0 && performance.now() - this.lastProgressAt < 800;
  }

  /** Call every detection tick while the main video plays. */
  sync(main: HTMLVideoElement, lead: number) {
    const v = this.video;
    if (!v || this.failed) return;
    const now = performance.now();
    // never became playable, or stopped advancing while it should be playing
    // Fail only when it has been UNPLAYABLE CONTINUOUSLY for 3 s (a brief rebuffer after a seek is normal).
    if (v.readyState >= 2) this.unplayableSince = null;
    else if (this.unplayableSince === null) this.unplayableSince = now;
    else if (now - this.unplayableSince > 3000) { this.fail('unplayable for 3 s'); return; }
    if (v.currentTime !== this.lastT) { this.lastT = v.currentTime; this.lastProgressAt = now; }
    else if (!v.paused && now - this.lastProgressAt > 2500) { this.fail('stalled 2.5 s'); return; }
    const act = driftAction(v.currentTime, main.currentTime, lead, main.playbackRate || 1);
    try {
      if (act.kind === 'seek') v.currentTime = Math.min(act.to, Math.max(0, (main.duration || act.to) - 0.001));
      else if (Math.abs(v.playbackRate - act.rate) > 0.005) v.playbackRate = Math.min(16, Math.max(0.0625, act.rate));
      // Only an autoplay refusal is fatal; an interrupted play() (a seek, a reload) just retries on the next tick.
      if (v.paused && v.readyState >= 2) void v.play().catch((e: { name?: string }) => { if (e?.name === 'NotAllowedError') this.fail('autoplay refused'); });
    } catch (e) { this.fail(`sync threw ${(e as Error)?.message ?? ''}`.slice(0, 60)); }
  }

  /** Release the decoder. Safe to call repeatedly. */
  destroy() {
    const v = this.video;
    this.video = null;
    if (!v) return;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* noop */ }
    v.remove();
  }
}
