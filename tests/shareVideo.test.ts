import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShareVideoRequest, shareVideoTitle, withinUploadLimits, SHARE_MAX_VIDEO_BYTES, SHARE_UPLOADS_PER_LINK_PER_DAY, SHARE_UPLOADS_PER_COACH_PER_DAY } from '../lib/players/shareVideo';

test('validateShareVideoRequest: accepts a video within the cap', () => {
  const r = validateShareVideoRequest({ sizeBytes: 10_000_000, mimeType: 'video/mp4' });
  assert.ok(r.ok);
});
test('validateShareVideoRequest: rejects too big, empty, non-video', () => {
  assert.equal(validateShareVideoRequest({ sizeBytes: SHARE_MAX_VIDEO_BYTES + 1, mimeType: 'video/mp4' }).ok, false);
  assert.equal(validateShareVideoRequest({ sizeBytes: 0, mimeType: 'video/mp4' }).ok, false);
  assert.equal(validateShareVideoRequest({ sizeBytes: 5, mimeType: 'application/pdf' }).ok, false);
  assert.equal(validateShareVideoRequest(null).ok, false);
});
test('shareVideoTitle is built from the player name only, cleaned', () => {
  assert.equal(shareVideoTitle('Philipp'), 'Philipp — AngleMotion');
  assert.equal(shareVideoTitle('<b>x</b>\nBuy now'), 'b x /b  Buy now — AngleMotion');
  assert.equal(shareVideoTitle(''), 'Player — AngleMotion');
});
test('withinUploadLimits: per link and per coach', () => {
  assert.equal(withinUploadLimits(0, 0).ok, true);
  assert.equal(withinUploadLimits(SHARE_UPLOADS_PER_LINK_PER_DAY, 0).ok, false);
  assert.equal(withinUploadLimits(0, SHARE_UPLOADS_PER_COACH_PER_DAY).ok, false);
});
