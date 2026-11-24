import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emailAllowed, hashShareToken, LINK_ADDS_PER_HOUR, looksLikeShareToken, newShareToken, validateShareSettings, withinLinkLimit,
} from '../lib/players/share';

test('tokens are unique, 43 url-safe chars, and hash to 64 hex', () => {
  const a = newShareToken(), b = newShareToken();
  assert.notEqual(a, b);
  assert.ok(looksLikeShareToken(a));
  assert.match(hashShareToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashShareToken(a), hashShareToken(a));
  assert.notEqual(hashShareToken(a), hashShareToken(b));
});

test('malformed tokens are rejected before any lookup', () => {
  for (const t of ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '/', null, undefined, 5]) {
    assert.equal(looksLikeShareToken(t), false);
  }
});

test('settings: mode required, email optional and validated, lower-cased', () => {
  assert.equal(validateShareSettings({}).ok, false);
  assert.equal(validateShareSettings({ mode: 'admin' }).ok, false);
  const ok = validateShareSettings({ mode: 'edit', allowed_email: '  Ana@Example.com ' });
  assert.ok(ok.ok && ok.mode === 'edit' && ok.allowed_email === 'ana@example.com');
  const open = validateShareSettings({ mode: 'view', allowed_email: '' });
  assert.ok(open.ok && open.allowed_email === null);
  assert.equal(validateShareSettings({ mode: 'view', allowed_email: 'nope' }).ok, false);
});

test('email gate: open when none set, otherwise must match ignoring case and spaces', () => {
  assert.equal(emailAllowed(null, undefined), true);
  assert.equal(emailAllowed('ana@example.com', ' ANA@example.com '), true);
  assert.equal(emailAllowed('ana@example.com', 'bob@example.com'), false);
  assert.equal(emailAllowed('ana@example.com', ''), false);
  assert.equal(emailAllowed('ana@example.com', undefined), false);
});

test('hourly limit', () => {
  assert.equal(withinLinkLimit(0), true);
  assert.equal(withinLinkLimit(LINK_ADDS_PER_HOUR - 1), true);
  assert.equal(withinLinkLimit(LINK_ADDS_PER_HOUR), false);
});
