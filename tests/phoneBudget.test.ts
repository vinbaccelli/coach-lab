import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isPhoneEnv, processingSize, upscaleAlphaMask, PHONE_MAX_EDGE,
  markAutoDetectStarted, markAutoDetectFinished, consumeAutoDetectKilled,
  AUTODETECT_MARKER_KEY, AUTODETECT_MARKER_MAX_AGE_MS,
} from '@/lib/stroMotionDraft/phoneBudget';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test('phone gate: iPhone and Android phones yes; desktop, iPad no; overrides win', () => {
  assert.equal(isPhoneEnv({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120' }), true);
  assert.equal(isPhoneEnv({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari' }), true);
  assert.equal(isPhoneEnv({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' }), false);
  assert.equal(isPhoneEnv({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)', coarsePointer: true, maxTouchPoints: 5, shortSide: 820 }), false);
  assert.equal(isPhoneEnv({ userAgent: 'desktop', override: true }), true);
  assert.equal(isPhoneEnv({ userAgent: 'iPhone', override: false }), false);
  assert.equal(isPhoneEnv({ userAgent: 'desktop', stored: '1' }), true);
});

test('processingSize: off or within the cap = native, scale 1', () => {
  assert.deepEqual(processingSize(1920, 1080, false), { w: 1920, h: 1080, scale: 1 });
  assert.deepEqual(processingSize(1280, 720, true), { w: 1280, h: 720, scale: 1 });
});

test('processingSize: caps the long edge, keeps aspect, both orientations', () => {
  const a = processingSize(3840, 2160, true);
  assert.equal(PHONE_MAX_EDGE, 1280);
  assert.deepEqual([a.w, a.h], [1280, 720]);
  assert.ok(Math.abs(a.scale - 1 / 3) < 1e-9);
  const b = processingSize(1080, 1920, true);
  assert.deepEqual([b.w, b.h], [720, 1280]);
});

test('upscaleAlphaMask: size, constant stays constant, edge stays soft', () => {
  const m = { width: 2, height: 1, data: new Uint8ClampedArray([0, 255]) };
  const u = upscaleAlphaMask(m, 8, 2);
  assert.equal(u.data.length, 16);
  assert.equal(u.data[0], 0);
  assert.equal(u.data[7], 255);
  assert.ok(u.data.some((v) => v > 0 && v < 255), 'bilinear keeps intermediate alpha');
  const c = upscaleAlphaMask({ width: 3, height: 3, data: new Uint8ClampedArray(9).fill(200) }, 10, 7);
  assert.ok(c.data.every((v) => v === 200));
});

test('crash marker: set, cleared on finish, notice once, stale ignored, never throws', () => {
  const s = mem();
  markAutoDetectStarted(s, 1000);
  assert.equal(consumeAutoDetectKilled(s, 2000), true);
  assert.equal(consumeAutoDetectKilled(s, 2000), false, 'cleared after being shown');
  markAutoDetectStarted(s, 1000);
  markAutoDetectFinished(s);
  assert.equal(consumeAutoDetectKilled(s, 2000), false);
  markAutoDetectStarted(s, 0);
  assert.equal(consumeAutoDetectKilled(s, AUTODETECT_MARKER_MAX_AGE_MS + 1), false);
  assert.ok(s.m.size === 0 && AUTODETECT_MARKER_KEY);
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => { markAutoDetectStarted(bad); markAutoDetectFinished(bad); });
  assert.equal(consumeAutoDetectKilled(bad), false);
  assert.equal(consumeAutoDetectKilled(null), false);
});

test('cleanup is wired and gated by the phone check (source)', () => {
  const hook = readFileSync('hooks/useStroMotion.ts', 'utf8');
  assert.match(hook, /releaseSamRacket\(\)/);
  assert.match(hook, /dropRacketEncoding\(/);
  assert.match(hook, /releaseSelfieSegmenter/);
  assert.match(hook, /finalizeBuiltAtNativeSize/);
  assert.match(hook, /markAutoDetectStarted/);
  assert.match(hook, /markAutoDetectFinished/);
  assert.match(hook, /if \(phone\)/);
  const sam = readFileSync('lib/stroMotionDraft/samRacket.ts', 'utf8');
  assert.match(sam, /isPhoneBudgetActive\(\) \? \{ session_options/);
  const det = readFileSync('lib/stroMotionDraft/racketDetect.ts', 'utf8');
  assert.match(det, /isPhoneBudgetActive\(\)/);
});
