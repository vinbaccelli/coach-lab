import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('app/api/google/create-document/route.ts', 'utf8');
const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a standalone Google Doc is private: no sharing step of any kind', () => {
  assert.equal(/permissions/.test(code), false, 'no Drive permission call');
  assert.equal(/['"]anyone['"]/.test(code), false, 'no "anyone" grant');
  assert.equal(/['"](writer|reader|commenter)['"]/.test(code), false, 'no role grant');
  assert.equal(/google\.drive\(/.test(code), false, 'no Drive client needed any more');
});

test('the doc is still created, filled, and its URL returned for the owner to open', () => {
  assert.ok(code.includes('docs.documents.create('));
  assert.ok(code.includes('docs.documents.batchUpdate('));
  assert.ok(code.includes('https://docs.google.com/document/d/${docId}/edit'));
  assert.ok(code.includes('NextResponse.json({ documentId: docId, url })'));
});

test('the only caller (decoder export button) opens the returned URL in the signed-in browser', () => {
  const decoder = readFileSync('components/decoder/AiMatchDecoderClient.tsx', 'utf8');
  const call = decoder.slice(decoder.indexOf("fetch('/api/google/create-document'"));
  assert.ok(call.slice(0, 900).includes("window.open(data.url, '_blank', 'noopener,noreferrer')"));
});

test('upload-image keeps its own public-read rule (report images need it): this change does not touch it', () => {
  const up = readFileSync('app/api/google/upload-image/route.ts', 'utf8');
  assert.ok(up.includes("requestBody: { role: 'reader', type: 'anyone' }"));
});
