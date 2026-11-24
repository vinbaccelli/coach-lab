import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadQueue, type UploadRunner } from '../lib/uploads/backgroundUploads';

const blob = new Blob(['x']);
const ok = (url = 'https://youtu.be/abc'): UploadRunner => async (_f, _t, p) => { p(0.5); p(1); return { ok: true, url }; };
const tick = () => new Promise((r) => setTimeout(r, 5));

test('an upload reports progress, calls afterUpload with the link, and ends done', async () => {
  const q = createUploadQueue(ok());
  const seen: string[] = [];
  q.subscribe(() => seen.push(q.getSnapshot().map((j) => j.status).join(',')));
  let got = '';
  q.enqueue({ file: blob, title: 't', label: 'Video for Alex', afterUpload: async (u) => { got = u; } });
  await tick();
  assert.equal(got, 'https://youtu.be/abc');
  const j = q.getSnapshot()[0];
  assert.equal(j.status, 'done');
  assert.equal(j.progress, 1);
  assert.ok(seen.includes('uploading') && seen.includes('saving'));
  assert.equal(q.hasActive(), false);
});

test('hasActive is true while it runs (the tab must not be closed)', async () => {
  let release!: () => void;
  const q = createUploadQueue(() => new Promise((res) => { release = () => res({ ok: true, url: 'u' }); }));
  q.enqueue({ file: blob, title: 't', label: 'a' });
  await tick();
  assert.equal(q.hasActive(), true);
  assert.equal(q.getSnapshot()[0].status, 'uploading');
  release();
  await tick();
  assert.equal(q.hasActive(), false);
});

test('uploads go one at a time, in order', async () => {
  const order: string[] = [];
  const q = createUploadQueue(async (_f, title) => { order.push(`start ${title}`); await tick(); order.push(`end ${title}`); return { ok: true, url: title }; });
  q.enqueue({ file: blob, title: 'A', label: 'A' });
  q.enqueue({ file: blob, title: 'B', label: 'B' });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(order, ['start A', 'end A', 'start B', 'end B']);
});

test('a failed upload says why and does not stop the next one', async () => {
  let n = 0;
  const q = createUploadQueue(async () => (++n === 1 ? { ok: false, error: 'quota' } : { ok: true, url: 'u2' }));
  q.enqueue({ file: blob, title: 'A', label: 'A' });
  q.enqueue({ file: blob, title: 'B', label: 'B' });
  await tick(); await tick();
  const [a, b] = q.getSnapshot();
  assert.equal(a.status, 'error');
  assert.equal(a.error, 'quota');
  assert.equal(b.status, 'done');
});

test('needing YouTube to be connected gets its own message', async () => {
  const q = createUploadQueue(async () => ({ ok: false, needsConnect: true }));
  q.enqueue({ file: blob, title: 'A', label: 'A' });
  await tick();
  assert.match(q.getSnapshot()[0].error ?? '', /Connect YouTube/);
});

test('on YouTube but not added: the error keeps the link so it can be pasted', async () => {
  const q = createUploadQueue(ok('https://youtu.be/zzz'));
  q.enqueue({ file: blob, title: 'A', label: 'A', afterUpload: async () => { throw new Error('offline'); } });
  await tick();
  const j = q.getSnapshot()[0];
  assert.equal(j.status, 'error');
  assert.equal(j.url, 'https://youtu.be/zzz');
  assert.match(j.error ?? '', /youtu\.be\/zzz/);
});

test('a runner that throws is a failed job, not an unhandled rejection', async () => {
  const q = createUploadQueue(async () => { throw new Error('boom'); });
  q.enqueue({ file: blob, title: 'A', label: 'A' });
  await tick();
  assert.equal(q.getSnapshot()[0].error, 'boom');
});

test('only finished or failed jobs can be dismissed', async () => {
  let release!: () => void;
  const q = createUploadQueue(() => new Promise((res) => { release = () => res({ ok: true, url: 'u' }); }));
  const id = q.enqueue({ file: blob, title: 'A', label: 'A' });
  await tick();
  q.dismiss(id);
  assert.equal(q.getSnapshot().length, 1, 'a running upload stays');
  release();
  await tick();
  q.dismiss(id);
  assert.equal(q.getSnapshot().length, 0);
});
