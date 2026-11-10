import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefetchWithProgress, formatProgress, percentFromStatus, toMB, type PrefetchProgress } from '../lib/modelPrefetch';

function fakeFetch(files: Record<string, { size: number; chunk: number; lengthHeader?: boolean; ok?: boolean }>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const f = files[url];
    if (!f) return new Response(null, { status: 404 });
    const headers: Record<string, string> = f.lengthHeader === false ? {} : { 'content-length': String(f.size) };
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers });
    if (f.ok === false) return new Response(null, { status: 500 });
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= f.size) { c.close(); return; }
        const n = Math.min(f.chunk, f.size - sent);
        sent += n;
        c.enqueue(new Uint8Array(n));
      },
    });
    return new Response(body, { status: 200, headers });
  }) as typeof fetch;
}

test('reports bytes across files, never 100 % before the end, finishes at 100', async () => {
  const seen: PrefetchProgress[] = [];
  await prefetchWithProgress(['/a', '/b'], (p) => seen.push(p), { fetchImpl: fakeFetch({ '/a': { size: 1000, chunk: 250 }, '/b': { size: 3000, chunk: 500 } }) });
  assert.ok(seen.length >= 8);
  assert.equal(seen[seen.length - 1].pct, 100);
  assert.equal(seen[seen.length - 1].loaded, 4000);
  assert.ok(seen.slice(0, -1).every((p) => p.pct <= 99));
  assert.ok(seen.every((p, i) => i === 0 || p.loaded >= seen[i - 1].loaded), 'monotonic');
  assert.equal(seen[0].total, 4000);
});

test('unknown size: shows MB, pct stays 0 until done; a failing file never blocks the rest', async () => {
  const seen: PrefetchProgress[] = [];
  await prefetchWithProgress(['/a', '/bad', '/c'], (p) => seen.push(p), {
    fetchImpl: fakeFetch({ '/a': { size: 500, chunk: 100, lengthHeader: false }, '/bad': { size: 10, chunk: 10, ok: false }, '/c': { size: 200, chunk: 100, lengthHeader: false } }),
  });
  assert.equal(seen[0].pct, 0);
  assert.equal(seen[seen.length - 1].pct, 100);
  assert.equal(seen[seen.length - 1].loaded, 700);
});

test('an aborted prefetch stops quietly', async () => {
  const ac = new AbortController();
  const seen: PrefetchProgress[] = [];
  const p = prefetchWithProgress(['/a', '/b'], (x) => { seen.push(x); if (x.loaded >= 200) ac.abort(); }, { signal: ac.signal, fetchImpl: fakeFetch({ '/a': { size: 400, chunk: 100 }, '/b': { size: 400, chunk: 100 } }) });
  await p;
  assert.ok(seen.every((x) => x.file !== '/b'), 'second file never started');
});

test('formatting and the status-toast percentage parser', () => {
  assert.equal(toMB(31 * 1024 * 1024), 31);
  assert.equal(formatProgress({ loaded: 12.3 * 1048576, total: 41 * 1048576, pct: 30 }), '12.3 / 41 MB (30%)');
  assert.equal(formatProgress({ loaded: 5 * 1048576, total: 0, pct: 0 }), '5 MB');
  assert.equal(percentFromStatus('AI-tracking your locked player… 27% (0.25× · real feet)'), 27);
  assert.equal(percentFromStatus('Downloading AI model… 12 / 41 MB (29%)'), 29);
  assert.equal(percentFromStatus('Loading precision tracking model…'), null);
  assert.equal(percentFromStatus(null), null);
});
