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
import type { SkeletonZoneShapes } from '@/lib/stroMotionDraft/skeletonMaskFilter';

/**
 * ON by default while the zone is being tuned.
 *
 *   window.__stroShowZone = false   // hide the panel
 *   window.__stroShowZone = true    // show it again
 *
 * `__stroSkelDebug` is the original name and still works, so anything that set it
 * previously keeps behaving the same.
 */
function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__stroShowZone !== undefined) return w.__stroShowZone !== false;
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
  /**
   * Bone cores unioned back in — the pixels the skeleton forced ON because a
   * tracked bone runs through them. Drawn ORANGE where they rescued something
   * the segmenter had missed.
   */
  coreMask?: AlphaMask | null;
  /** The shapes the zone was rasterized from, so they can be outlined exactly. */
  shapes?: SkeletonZoneShapes | null;
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
  /** Head-oval geometry in px, so its size can be compared with the real head numerically. */
  head?: { cx: number; cy: number; semiMajor: number; semiMinor: number; heightPx: number } | null;
  /** Shoulder width in px — every zone thickness is a multiple of this. */
  unitPx?: number | null;
  /**
   * Where `unitPx` came from. 'shoulder' is the normal case; anything else means
   * the collapse floor fired for this frame (see poseScaleUnit).
   */
  unitSource?: string | null;
  /** Pixels the bone cores rescued from a segmenter miss (0 = union was a no-op). */
  forcedPx?: number;
}

/** Compute the numbers that diagnose an empty result, with no rendering. */
export function computeSkeletonDebugStats(input: SkeletonDebugInput): SkeletonDebugStats {
  const { keypoints, zone, personMask, finalMask, bounds, coreMask } = input;
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

  // Bone-core pixels the segmenter had NOT found — what the union actually
  // rescued on this frame. Counted against the segmenter's own output, so it
  // reports the recovery rather than the core's total size.
  let forcedPx = 0;
  if (coreMask && personMask && coreMask.data.length === personMask.data.length) {
    for (let i = 0; i < coreMask.data.length; i++) {
      if (coreMask.data[i] > 0 && personMask.data[i] === 0) forcedPx++;
    }
  }

  let verdict: string;
  if (!keypoints || visibleJoints < 4) verdict = 'NO POSE — zone cannot be built; falls back to the selection box';
  else if (zonePx === 0) verdict = 'ZONE EMPTY — capsules produced nothing';
  else if (personPx === 0) verdict = 'SEGMENTER EMPTY — no person found in the crop';
  else if (overlapPx === 0) verdict = 'NO OVERLAP — pose/zone and person mask are in different places (coordinate mismatch)';
  else if (finalPx === 0) verdict = 'OVERLAP EXISTS BUT FINAL IS EMPTY — intersection wiring bug';
  else verdict = 'OK';

  const head = input.shapes?.head ?? null;
  return {
    label: input.label,
    visibleJoints,
    head: head
      ? {
          cx: Math.round(head.center.x), cy: Math.round(head.center.y),
          semiMajor: Math.round(head.semiMajor), semiMinor: Math.round(head.semiMinor),
          heightPx: Math.round(head.semiMajor * 2),
        }
      : null,
    unitPx: input.shapes ? Math.round(input.shapes.unitPx) : null,
    unitSource: input.shapes ? input.shapes.unitSource : null,
    zonePx,
    personPx,
    overlapPx,
    finalPx,
    bounds: bounds ? `${bounds.x},${bounds.y} ${bounds.w}x${bounds.h}` : 'none',
    forcedPx,
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
      `final=${stats.finalPx}px crop=${stats.bounds}` +
      // unit is reported UNCONDITIONALLY — it used to ride along with the head
      // oval, so on exactly the collapse frames (where the oval can be missing)
      // the number needed to diagnose the collapse was the one not printed.
      ` unit=${stats.unitPx ?? '?'}px(${stats.unitSource ?? '?'})` +
      // The elbow/leg recovery, as a number. >0 means bones put back pixels the
      // segmenter had missed; 0 means the segmenter already covered every bone.
      ` rescued=${stats.forcedPx ?? 0}px` +
      (stats.head ? ` headOval=${stats.head.heightPx}px tall @(${stats.head.cx},${stats.head.cy})` : ' headOval=NONE') +
      ` :: ${stats.verdict}`,
  );
  if (!debugEnabled() || typeof document === 'undefined') return stats;

  try {
    const { sourceFrame, keypoints, zone, personMask, bounds, finalMask, coreMask } = input;
    const W = sourceFrame.width;
    const H = sourceFrame.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return stats;

    ctx.drawImage(sourceFrame, 0, 0);

    // ── THE DIAGNOSTIC COLOUR SCHEME ────────────────────────────────────────
    //
    // Built to separate the two failures that look identical in the result but
    // have opposite fixes:
    //
    //   GREEN   kept — in the final mask. What the coach actually gets.
    //   CYAN    the SEGMENTER found a person here and THE ZONE REJECTED IT.
    //           Cyan over the top of the head means the oval is too small or
    //           mispositioned — a zone problem.
    //   MAGENTA the zone allows this, but the segmenter found nothing.
    //           Magenta over the top of the head means segmentation missed the
    //           hair — a model problem, and widening the oval would not help.
    //   RED     in zone AND in segmenter, yet NOT in the final mask — the
    //           intersection is losing pixels it should have kept (a wiring bug).
    //
    // So for the reported symptoms: if the between-arms gap is GREEN, check
    // whether it is also inside the magenta zone (zone too fat) or whether the
    // segmenter filled it (model). If the head top is CYAN, the oval is the
    // problem; if it is MAGENTA, the segmenter is.
    if (zone || personMask || finalMask) {
      const img = ctx.getImageData(0, 0, W, H);
      const px = img.data;
      for (let i = 0; i < W * H; i++) {
        const inZone = zone ? zone[i] === 1 : false;
        const inP = personMask ? personMask.data[i] > 0 : false;
        const inF = finalMask ? finalMask.data[i] > 0 : false;
        if (!inZone && !inP && !inF) continue;
        const o = i * 4;
        const mix = (r: number, g: number, b: number, t: number) => {
          px[o] = Math.round(px[o] * (1 - t) + r * t);
          px[o + 1] = Math.round(px[o + 1] * (1 - t) + g * t);
          px[o + 2] = Math.round(px[o + 2] * (1 - t) + b * t);
        };
        // ORANGE outranks green: a pixel the SKELETON rescued is the thing being
        // verified on these frames, and it is in the final mask too — so without
        // its own colour it would just look green like any other kept pixel and
        // the fix would be invisible in the very overlay built to show it.
        const rescued = coreMask ? coreMask.data[i] > 0 && !inP : false;
        if (rescued && inF) mix(255, 150, 0, 0.7);
        else if (inF) mix(60, 230, 90, 0.55);
        else if (inZone && inP) mix(255, 60, 60, 0.75);
        else if (inP) mix(0, 210, 255, 0.55);
        else mix(255, 0, 255, 0.26);
      }
      ctx.putImageData(img, 0, 0);
    }

    // ── ZONE SHAPE OUTLINES ─────────────────────────────────────────────────
    // The tint shows the zone as one blob; these outlines show WHICH shape put
    // each part there. The head oval is drawn from the exact geometry the zone was
    // rasterized from, so its size against the real head can simply be looked at.
    if (input.shapes) {
      const lw = Math.max(2, Math.round(W / 500));
      ctx.lineWidth = lw;

      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      for (const cap of input.shapes.capsules) {
        const dx = cap.b.x - cap.a.x;
        const dy = cap.b.y - cap.a.y;
        const len = Math.hypot(dx, dy);
        ctx.beginPath();
        if (len < 0.5) {
          ctx.arc(cap.a.x, cap.a.y, cap.halfWidth, 0, Math.PI * 2);
        } else {
          // Outline of a capsule = two parallel sides joined by half-circle caps.
          const ux = dx / len, uy = dy / len;
          const nx = -uy * cap.halfWidth, ny = ux * cap.halfWidth;
          const ang = Math.atan2(uy, ux);
          ctx.moveTo(cap.a.x + nx, cap.a.y + ny);
          ctx.lineTo(cap.b.x + nx, cap.b.y + ny);
          ctx.arc(cap.b.x, cap.b.y, cap.halfWidth, ang + Math.PI / 2, ang - Math.PI / 2, true);
          ctx.lineTo(cap.a.x - nx, cap.a.y - ny);
          ctx.arc(cap.a.x, cap.a.y, cap.halfWidth, ang - Math.PI / 2, ang + Math.PI / 2, true);
        }
        ctx.stroke();
      }

      // THE HEAD OVAL — the shape under investigation, in its own colour.
      const head = input.shapes.head;
      if (head) {
        ctx.strokeStyle = '#FFD400';
        ctx.lineWidth = Math.max(3, Math.round(W / 320));
        ctx.beginPath();
        // `stampEllipse` projects u ALONG `axis` and tests u²/semiMajor², so the
        // major axis lies along `axis`. Canvas puts `radiusX` along `rotation`, so
        // rotation is the axis angle itself — no quarter-turn. Getting this wrong
        // draws a tall head zone as a wide one, which would misreport the very
        // thing this overlay exists to measure.
        ctx.ellipse(
          head.center.x, head.center.y,
          head.semiMajor, head.semiMinor,
          Math.atan2(head.axis.y, head.axis.x),
          0, Math.PI * 2,
        );
        ctx.stroke();
        // Centre cross + the major axis, so position and lean are readable too.
        ctx.beginPath();
        ctx.moveTo(head.center.x - head.axis.x * head.semiMajor, head.center.y - head.axis.y * head.semiMajor);
        ctx.lineTo(head.center.x + head.axis.x * head.semiMajor, head.center.y + head.axis.y * head.semiMajor);
        ctx.stroke();
      }
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
    legend.textContent =
      'GREEN=kept (final) · ORANGE=SKELETON RESCUED it (segmenter missed it, bone core forced it on) · ' +
      'CYAN=segmenter found it, ZONE REJECTED it · MAGENTA=zone allows, segmenter found nothing · ' +
      'RED=in both but dropped (bug) · YELLOW oval=head zone · white outlines=capsules · green rect=crop' +
      (stats.head ? `\nhead oval ${stats.head.heightPx}px tall (${stats.head.semiMajor}x${stats.head.semiMinor} semi-axes), shoulder unit ${stats.unitPx}px` : '');
    wrap.appendChild(legend);
    panel().appendChild(wrap);
  } catch {
    /* diagnostics must never break the pipeline */
  }
  return stats;
}
