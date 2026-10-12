import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES } from '@/lib/entitlements';

/**
 * Pins which API write paths carry the plan guard (R1d). Reads stay open so a
 * downgraded coach keeps read access to everything they made; writes need the
 * plan. A guard removed by accident fails here.
 */
const GUARDS: Array<[file: string, method: string, feature: keyof typeof FEATURES]> = [
  ['app/api/players/route.ts', 'POST', 'players'],
  ['app/api/players/[id]/route.ts', 'PATCH', 'players'],
  ['app/api/players/[id]/route.ts', 'DELETE', 'players'],
  ['app/api/players/[id]/entries/route.ts', 'POST', 'players'],
  ['app/api/players/[id]/sessions/route.ts', 'POST', 'players'],
  ['app/api/players/[id]/sessions/[sessionId]/route.ts', 'PATCH', 'players'],
  ['app/api/players/[id]/sessions/[sessionId]/route.ts', 'DELETE', 'players'],
  ['app/api/sessions/[sessionId]/artifacts/route.ts', 'POST', 'players'],
  ['app/api/coach-settings/route.ts', 'PUT', 'players'],
  ['app/api/players/[id]/google-doc/route.ts', 'POST', 'docsExport'],
  ['app/api/google/create-document/route.ts', 'POST', 'docsExport'],
  ['app/api/google/report/route.ts', 'POST', 'docsExport'],
  ['app/api/google/upload-image/route.ts', 'POST', 'docsExport'],
  ['app/api/youtube/upload-session/route.ts', 'POST', 'youtube'],
  ['app/api/coach-profile/route.ts', 'PUT', 'coachProfile'],
  ['app/api/academy/route.ts', 'GET', 'academy'],
  ['app/api/academy/route.ts', 'POST', 'academy'],
  ['app/api/academy/route.ts', 'DELETE', 'academy'],
  ['app/api/academy/questions/route.ts', 'GET', 'academy'],
  ['app/api/academy/questions/route.ts', 'POST', 'academy'],
  ['app/api/academy/questions/route.ts', 'DELETE', 'academy'],
  ['app/api/academy/questions/[id]/replies/route.ts', 'GET', 'academy'],
  ['app/api/academy/questions/[id]/replies/route.ts', 'POST', 'academy'],
  ['app/api/academy/votes/route.ts', 'POST', 'academy'],
];

/** Body of `export async function METHOD(` up to the next exported handler. */
function handlerBody(src: string, method: string): string {
  const start = src.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${method} handler not found`);
  const next = src.indexOf('export async function ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

test('every gated API write path calls requireFeature with its feature, after the 401 check', () => {
  for (const [file, method, feature] of GUARDS) {
    const body = handlerBody(readFileSync(join(process.cwd(), file), 'utf8'), method);
    const call = body.indexOf(`requireFeature(`);
    assert.ok(call >= 0, `${file} ${method}: no requireFeature`);
    assert.match(body.slice(call, call + 200), new RegExp(`'${feature}'\\)`), `${file} ${method}: wrong feature`);
    assert.match(body.slice(call, call + 260), /if \(denied\) return denied;/, `${file} ${method}: result not returned`);
    assert.equal(FEATURES[feature].enforced, 'server', `${feature} must be marked server-enforced`);
  }
});

test('read paths stay open (downgraded coaches keep read access)', () => {
  const reads: Array<[string, string]> = [
    ['app/api/players/route.ts', 'GET'],
    ['app/api/players/[id]/route.ts', 'GET'],
    ['app/api/players/[id]/sessions/route.ts', 'GET'],
    ['app/api/players/[id]/sessions/[sessionId]/route.ts', 'GET'],
    ['app/api/coach-profile/route.ts', 'GET'],
    ['app/api/coach-settings/route.ts', 'GET'],
  ];
  for (const [file, method] of reads) {
    const body = handlerBody(readFileSync(join(process.cwd(), file), 'utf8'), method);
    assert.equal(body.includes('requireFeature('), false, `${file} ${method} should stay open`);
  }
});
