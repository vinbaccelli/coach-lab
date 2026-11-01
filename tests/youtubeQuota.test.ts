import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isYouTubeQuotaError, uploadToResumableSession, YOUTUBE_QUOTA_MESSAGE } from '@/lib/export/youtubeResumableUpload';

const googleError = (reason: string, code = 403) =>
  JSON.stringify({ error: { code, message: 'x', errors: [{ domain: 'youtube.quota', reason, message: 'x' }] } });

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('quota reasons are recognised; everything else is not', () => {
  assert.equal(isYouTubeQuotaError(googleError('quotaExceeded')), true);
  assert.equal(isYouTubeQuotaError(googleError('dailyLimitExceeded')), true);
  // Not "the daily quota": a short burst limit, the channel's own cap, a real auth/permission error.
  for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'uploadLimitExceeded', 'forbidden', 'authError', 'insufficientPermissions']) {
    assert.equal(isYouTubeQuotaError(googleError(reason)), false, reason);
  }
  // Several reasons in one body: any quota reason counts.
  assert.equal(isYouTubeQuotaError(JSON.stringify({ error: { errors: [{ reason: 'forbidden' }, { reason: 'quotaExceeded' }] } })), true);
  // Bodies that are not Google JSON.
  for (const body of ['', null, undefined, '<html>403</html>', 'quotaExceeded', '{}', '{"error":"quotaExceeded"}', '{"error":{"errors":"quotaExceeded"}}', '[]', 'null']) {
    assert.equal(isYouTubeQuotaError(body as string | null | undefined), false, String(body));
  }
});

test('the message is the one the coach was promised, with no reconnect wording', () => {
  assert.equal(
    YOUTUBE_QUOTA_MESSAGE,
    "YouTube's daily upload limit for AngleMotion has been reached. Try again tomorrow, or download the video and upload it to YouTube yourself.",
  );
  assert.equal(/reconnect|connect/i.test(YOUTUBE_QUOTA_MESSAGE), false);
});

test('browser upload step: a quota 403 during the PUT shows the quota message, a plain 403 keeps the raw refusal', async () => {
  const blob = new Blob([new Uint8Array(1024)]);
  globalThis.fetch = (async () => new Response(googleError('quotaExceeded'), { status: 403 })) as typeof fetch;
  const quota = await uploadToResumableSession('https://upload.example/session', blob);
  assert.deepEqual(quota, { ok: false, error: YOUTUBE_QUOTA_MESSAGE });

  globalThis.fetch = (async () => new Response(googleError('forbidden'), { status: 403 })) as typeof fetch;
  const other = await uploadToResumableSession('https://upload.example/session', blob);
  assert.equal(other.ok, false);
  assert.match(other.error ?? '', /^YouTube rejected the upload \(403\)/);
  assert.notEqual(other.error, YOUTUBE_QUOTA_MESSAGE);
});

test('wiring: upload-session answers a quota 403 with the message and no reconnect flag; other 401/403 keep reconnect', () => {
  const route = readFileSync('app/api/youtube/upload-session/route.ts', 'utf8');
  const fail = route.slice(route.indexOf('if (!init.ok)'), route.indexOf('const uploadUrl'));
  const quotaAt = fail.indexOf('isYouTubeQuotaError(detail)');
  const connectAt = fail.indexOf('const needsConnect = init.status === 401 || init.status === 403');
  assert.ok(quotaAt !== -1 && connectAt !== -1 && quotaAt < connectAt, 'quota is decided before the reconnect rule');
  const quotaBranch = fail.slice(quotaAt, connectAt);
  assert.ok(quotaBranch.includes('YOUTUBE_QUOTA_MESSAGE') && quotaBranch.includes('needsConnect: false'));
  assert.ok(fail.includes('YouTube authorization was rejected — reconnect YouTube and try again.'));
  assert.ok(route.includes("{ error: 'YouTube not connected', needsConnect: true }"), 'no grant at all still offers Connect');
});
