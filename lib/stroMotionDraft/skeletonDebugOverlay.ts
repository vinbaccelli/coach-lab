'use client';

/**
 * TEMP-DEBUG-SKELZONE — visual + numeric diagnostics for the skeleton hard limit.
 *
 * Answers, per frame, the questions that are otherwise invisible:
 *   - was a pose detected at all, and does it sit ON the player?
 *   - where is the thickened-skeleton zone, and is it a sensible size?
 *   - where did the segmenter find the person?
 *   - DO THE TWO OVERLAP? (an empty final mask means they do not)
 *
 * Renders the frame with the zone tinted, the skeleton drawn on top, the
 * segmenter's mask outlined, and the crop rect marked — then appends it to a
 * floating panel so the coach can simply look at it.
 *
 * Remove this file and its call site (grep the tag) once the pipeline is trusted.
 */

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/** Enabled by default while we are debugging; set window.__stroSkelDebug = false to silence. */
function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return w.__stroSkelDebug !== false;
}

const BONES: Array<[number, number]> = [
  [5, 7], [7, 9], [6, 8], [8, 10],       // arms
  [11, 13], [13, 15], [12, 14], [14, 16], // legs
  [5, 6], [11, 12], [5, 11], [6, 12],     // torso
];

export interface SkeletonDebugInput {
  /** Human-readable identifier, e.g. the frame's time. */
  label?: string;
  sourceFrame: ImageBitmap;
  /** COCO-17, full-frame normalized. */
  keypoints: Array<{ x: number; y: number; score: number }> | null;
  /** Thickened-skeleton zone, full-frame, 1 = inside. */
  zone: Uint8Array | null;
  /** Segmenter output in FULL-FRAME space (post-embed), before intersection. */
  personMask: AlphaMask | null;
  /** Crop rect handed to the segmenter, in full-frame px. */
  bounds: { x: number; y: number; w: number; h: number } | null;
  /** Final mask after the hard intersection. */
  finalMask: AlphaMask | null;
}

export interface SkeletonDebugStats {
  label?: string;
  visibleJoints: number;
  zonePx: number;
  personPx: number;
  overlapPx: number;
  finalPx: number;
  bounds: string;
  verdict: string;
}

/** Compute the numbers that diagnose an empty result, with no rendering. */
export function computeSkeletonDebugStats(input: SkeletonDebugInput): SkeletonDebugStats {
  const { keypoints, zone, personMask, finalMask, bounds } = input;
  const visibleJoints = (keypoints ?? []).filter((k) => k && k.score >= 0.2).length;

  let zonePx = 0;
  if (zone) for (let i = 0; i < zone.length; i++) if (zone[i]) zonePx++;

  let personPx = 0;
  if (personMask) for (let i = 0; i < personMask.data.length; i++) if (personMask.data[i] > 0) personPx++;

  let overlapPx = 0;
  if (zone && personMask && zone.length === personMask.data.length) {
    for (let i = 0; i < zone.length; i++) if (zone[i] && personMask.data[i] > 0) overlapPx++;
  }

  let finalPx = 0;
  if (finalMask) for (let i = 0; i < finalMask.data.length; i++) if (finalMask.data[i] > 0) finalPx++;

  let verdict: string;
  if (!keypoints || visibleJoints < 4) verdict = 'NO POSE — zone cannot be built; falls back to the selection box';
  else if (zonePx === 0) verdict = 'ZONE EMPTY — capsules produced nothing';
  else if (personPx === 0) verdict = 'SEGMENTER EMPTY — no person found in the crop';
  else if (overlapPx === 0) verdict = 'NO OVERLAP — pose/zone and person mask are in different places (coordinate mismatch)';
  else if (finalPx === 0) verdict = 'OVERLAP EXISTS BUT FINAL IS EMPTY — intersection wiring bug';
  else verdict = 'OK';

  return {
    label: input.label,
    visibleJoints,
    zonePx,
    personPx,
    overlapPx,
    finalPx,
    bounds: bounds ? `${bounds.x},${bounds.y} ${bounds.w}x${bounds.h}` : 'none',
    verdict,
  };
}

function panel(): HTMLDivElement {
  const id = 'stro-skel-debug-panel';
  let el = document.getElementById(id) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483000',
    'max-height:70vh', 'max-width:min(420px,46vw)', 'overflow:auto',
    'background:rgba(10,10,12,0.94)', 'border:1px solid #FF00FF', 'border-radius:10px',
    'padding:8px', 'color:#fff', 'font:11px ui-monospace,monospace',
    'box-shadow:0 10px 30px rgba(0,0,0,.6)',
  ].join(';');
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px';
  bar.innerHTML = '<strong style="color:#FF00FF">SKELETON / ZONE DEBUG</strong>';
  const close = document.createElement('button');
  close.textContent = 'clear';
  close.style.cssText = 'background:#333;color:#fff;border:1px solid #666;border-radius:6px;cursor:pointer;font:11px ui-monospace';
  close.onclick = () => { el?.remove(); };
  bar.appendChild(close);
  el.appendChild(bar);
  document.body.appendChild(el);
  return el;
}

/**
 * Draw the diagnostic composite and append it to the floating panel.
 * Always logs the stats, even when rendering is unavailable.
 */
export function renderSkeletonDebug(input: SkeletonDebugInput): SkeletonDebugStats {
  const stats = computeSkeletonDebugStats(input);
  // eslint-disable-next-line no-console
  console.log(
    `[TEMP-DEBUG-SKELZONE] frame=${stats.label ?? '?'} joints=${stats.visibleJoints} ` +
      `zone=${stats.zonePx}px person=${stats.personPx}px overlap=${stats.overlapPx}px ` +
      `final=${stats.finalPx}px crop=${stats.bounds} :: ${stats.verdict}`,
  );
  if (!debugEnabled() || typeof document === 'undefined') return stats;

  try {
    const { sourceFrame, keypoints, zone, personMask, bounds } = input;
    const W = sourceFrame.width;
    const H = sourceFrame.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return stats;

    ctx.drawImage(sourceFrame, 0, 0);

    // Tint: magenta = zone, cyan = segmenter person, white = both (the overlap
    // that actually survives). If you see no white, the intersection is empty.
    if (zone || personMask) {
      const img = ctx.getImageData(0, 0, W, H);
      const px = img.data;
      for (let i = 0; i < W * H; i++) {
        const inZone = zone ? zone[i] === 1 : false;
        const inP = personMask ? personMask.data[i] > 0 : false;
        if (!inZone && !inP) continue;
        const o = i * 4;
        const mix = (r: number, g: number, b: number, t: number) => {
          px[o] = Math.round(px[o] * (1 - t) + r * t);
          px[o + 1] = Math.round(px[o + 1] * (1 - t) + g * t);
          px[o + 2] = Math.round(px[o + 2] * (1 - t) + b * t);
        };
        if (inZone && inP) mix(255, 255, 255, 0.75);
        else if (inZone) mix(255, 0, 255, 0.35);
        else mix(0, 220, 255, 0.55);
      }
      ctx.putImageData(img, 0, 0);
    }

    // Crop rect handed to the segmenter.
    if (bounds) {
      ctx.strokeStyle = '#00FF66';
      ctx.lineWidth = Math.max(2, Math.round(W / 400));
      ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }

    // Skeleton on top — if this is not ON the player, the pose is the problem.
    if (keypoints && keypoints.length >= 17) {
      const P = (i: number) => {
        const k = keypoints[i];
        return k && k.score >= 0.2 ? { x: k.x * W, y: k.y * H } : null;
      };
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = Math.max(3, Math.round(W / 300));
      for (const [a, b] of BONES) {
        const pa = P(a), pb = P(b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      const r = Math.max(4, Math.round(W / 220));
      for (let i = 0; i < keypoints.length; i++) {
        const p = P(i);
        if (!p) continue;
        ctx.fillStyle = '#FF3B30';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Downscale for the panel.
    const outW = 380;
    const outH = Math.max(1, Math.round((outW * H) / W));
    const small = document.createElement('canvas');
    small.width = outW;
    small.height = outH;
    small.getContext('2d')?.drawImage(c, 0, 0, outW, outH);
    small.style.cssText = 'display:block;width:100%;border-radius:6px;margin-bottom:4px';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;border-bottom:1px solid #444;padding-bottom:6px';
    const cap = document.createElement('div');
    cap.style.cssText = `color:${stats.verdict === 'OK' ? '#34C759' : '#FF453A'};margin-bottom:4px;line-height:1.35`;
    cap.textContent =
      `#${stats.label ?? '?'} joints ${stats.visibleJoints}/17 · zone ${stats.zonePx} · ` +
      `person ${stats.personPx} · overlap ${stats.overlapPx} · final ${stats.finalPx}\n${stats.verdict}`;
    cap.style.whiteSpace = 'pre-wrap';
    wrap.appendChild(cap);
    wrap.appendChild(small);
    const legend = document.createElement('div');
    legend.style.cssText = 'color:#aaa';
    legend.textContent = 'magenta=zone · cyan=segmenter · white=BOTH (survives) · green=crop · yellow=skeleton';
    wrap.appendChild(legend);
    panel().appendChild(wrap);
  } catch {
    /* diagnostics must never break the pipeline */
  }
  return stats;
}
