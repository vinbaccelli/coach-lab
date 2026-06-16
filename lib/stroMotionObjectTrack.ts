'use client';

import {
  detectTennisRacketNearHint,
  type NormRect,
} from '@/lib/racketCocoDetect';
import {
  normalizeObjectBox,
  type StroMotionSubjectBox,
} from '@/lib/stroMotion';

export interface StroMotionFrameStop {
  index: number;
  timeSec: number;
  box: StroMotionSubjectBox;
  autoDetected: boolean;
  userConfirmed: boolean;
  detectionScore: number | null;
}

function toSubjectBox(r: NormRect): StroMotionSubjectBox {
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}

function boxCenter(b: StroMotionSubjectBox): { cx: number; cy: number } {
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

function expandBox(b: StroMotionSubjectBox, ratio: number): StroMotionSubjectBox {
  const padW = b.width * ratio;
  const padH = b.height * ratio;
  const x = Math.max(0, b.x - padW);
  const y = Math.max(0, b.y - padH);
  const width = Math.min(1 - x, b.width + padW * 2);
  const height = Math.min(1 - y, b.height + padH * 2);
  return { x, y, width, height };
}

async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const t = Math.max(0, Math.min(timeSec, Math.max(0, (video.duration || timeSec) - 1e-6)));
  if (Math.abs(video.currentTime - t) < 0.001) return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 4000);
    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = t;
  });
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

function captureVideoFrame(
  video: HTMLVideoElement,
): ImageData | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 8 || vh < 8) return null;
  const c = document.createElement('canvas');
  c.width = vw;
  c.height = vh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, vw, vh);
  return ctx.getImageData(0, 0, vw, vh);
}

function lerpBox(a: StroMotionSubjectBox, b: StroMotionSubjectBox, t: number): StroMotionSubjectBox {
  return normalizeObjectBox({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  });
}

/** Motion centroid shift inside search window — fallback when COCO misses. */
function trackByMotion(
  prevFrame: ImageData,
  currFrame: ImageData,
  hint: StroMotionSubjectBox,
): StroMotionSubjectBox | null {
  const vw = currFrame.width;
  const vh = currFrame.height;
  const search = expandBox(hint, 0.85);
  const x0 = Math.floor(search.x * vw);
  const y0 = Math.floor(search.y * vh);
  const x1 = Math.min(vw, Math.ceil((search.x + search.width) * vw));
  const y1 = Math.min(vh, Math.ceil((search.y + search.height) * vh));
  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw < 8 || sh < 8) return null;

  const stride = sw * sh > 120_000 ? 2 : 1;
  const diffs: number[] = [];
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const i = (y * vw + x) * 4;
      const dr = Math.abs(currFrame.data[i] - prevFrame.data[i]);
      const dg = Math.abs(currFrame.data[i + 1] - prevFrame.data[i + 1]);
      const db = Math.abs(currFrame.data[i + 2] - prevFrame.data[i + 2]);
      diffs.push(dr + dg + db);
    }
  }
  diffs.sort((a, b) => a - b);
  const medianDiff = diffs[Math.floor(diffs.length / 2)] ?? 24;
  const TH = Math.max(18, Math.min(42, medianDiff * 1.35));

  let sumX = 0;
  let sumY = 0;
  let hits = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const i = (y * vw + x) * 4;
      const dr = Math.abs(currFrame.data[i] - prevFrame.data[i]);
      const dg = Math.abs(currFrame.data[i + 1] - prevFrame.data[i + 1]);
      const db = Math.abs(currFrame.data[i + 2] - prevFrame.data[i + 2]);
      if (dr + dg + db > TH) {
        hits++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const minHits = Math.max(8, Math.floor((sw * sh) / (stride * stride * 180)));
  if (hits < minHits) return null;

  const motionW = (maxX - minX + stride) / vw;
  const motionH = (maxY - minY + stride) / vh;
  const blendW = Math.max(hint.width * 0.92, motionW * 1.08);
  const blendH = Math.max(hint.height * 0.92, motionH * 1.08);
  const mcx = sumX / hits / vw;
  const mcy = sumY / hits / vh;

  return normalizeObjectBox({
    x: mcx - blendW / 2,
    y: mcy - blendH / 2,
    width: blendW,
    height: blendH,
  });
}

async function detectAtTime(
  video: HTMLVideoElement,
  timeSec: number,
  hint: StroMotionSubjectBox,
  prevFrame: ImageData | null,
): Promise<{ box: StroMotionSubjectBox; score: number | null; method: 'coco' | 'motion' | 'carry' }> {
  await seekVideo(video, timeSec);
  const currFrame = captureVideoFrame(video);

  const coco = await detectTennisRacketNearHint(video, {
    x: hint.x,
    y: hint.y,
    w: hint.width,
    h: hint.height,
  });
  if (coco) {
    return {
      box: normalizeObjectBox(toSubjectBox(coco.box)),
      score: coco.score,
      method: 'coco',
    };
  }

  if (prevFrame && currFrame) {
    const motion = trackByMotion(prevFrame, currFrame, hint);
    if (motion) {
      return { box: motion, score: null, method: 'motion' };
    }
  }

  return { box: normalizeObjectBox(hint), score: null, method: 'carry' };
}

export function enforceMonotonicFrameStops(
  stops: StroMotionFrameStop[],
  trimStartSec: number,
  trimEndSec: number,
): StroMotionFrameStop[] {
  const sorted = [...stops].sort((a, b) => a.index - b.index);
  const span = trimEndSec - trimStartSec;
  const minGap = span > 0 ? Math.min(0.04, span / (sorted.length * 3)) : 0.01;
  let prev = trimStartSec - minGap;
  return sorted.map((s) => {
    const t = Math.max(trimStartSec, Math.min(trimEndSec, Math.max(s.timeSec, prev + minGap)));
    const next = { ...s, timeSec: Math.round(t * 1000) / 1000 };
    prev = t;
    return next;
  });
}

export async function trackObjectFrameStops(
  video: HTMLVideoElement,
  sampleTimes: number[],
  seedBox: StroMotionSubjectBox,
  onProgress?: (current: number, total: number) => void,
): Promise<StroMotionFrameStop[]> {
  if (sampleTimes.length === 0) return [];

  const wasPaused = video.paused;
  video.pause();
  const originalTime = video.currentTime;

  const stops: StroMotionFrameStop[] = [];
  let hint = normalizeObjectBox(seedBox);
  let prevFrame: ImageData | null = null;

  try {
    for (let i = 0; i < sampleTimes.length; i++) {
      onProgress?.(i + 1, sampleTimes.length);
      const { box, score, method } = await detectAtTime(
        video,
        sampleTimes[i],
        hint,
        prevFrame,
      );
      const smoothed =
        method === 'coco'
          ? box
          : method === 'motion'
            ? lerpBox(hint, box, 0.72)
            : hint;
      hint = smoothed;
      await seekVideo(video, sampleTimes[i]);
      prevFrame = captureVideoFrame(video);

      stops.push({
        index: i,
        timeSec: sampleTimes[i],
        box: smoothed,
        autoDetected: method !== 'carry',
        userConfirmed: false,
        detectionScore: score,
      });
    }
    return stops;
  } finally {
    try {
      await seekVideo(video, originalTime);
    } catch {
      video.currentTime = originalTime;
    }
    if (!wasPaused) void video.play().catch(() => {});
  }
}
