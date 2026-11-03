import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/*
 * public/sw.js — what the service worker may store, how much, and what it deletes.
 * The real worker file is run in a sandbox with a fake CacheStorage; nothing is mocked inside it.
 */

const SRC = readFileSync(join(__dirname, '..', 'public/sw.js'), 'utf8');
const ORIGIN = 'https://app.test';

class FakeCache {
  entries = new Map<string, { request: { url: string }; response: Response }>();
  async put(request: { url: string }, response: Response) {
    // like the real Cache: the body is consumed on put; an existing entry is replaced
    const buf = await response.arrayBuffer();
    const stored = new Response(buf, { status: response.status, headers: response.headers });
    this.entries.delete(request.url);
    this.entries.set(request.url, { request, response: stored });
  }
  async match(request: { url: string }) {
    return this.entries.get(request.url)?.response.clone();
  }
  async keys() {
    return [...this.entries.values()].map((e) => e.request);
  }
  async delete(request: { url: string }) {
    return this.entries.delete(request.url);
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.entries.set(`${ORIGIN}${u}`, { request: { url: `${ORIGIN}${u}` }, response: new Response('x', { status: 200 }) });
  }
}

function load() {
  const stores = new Map<string, FakeCache>();
  const caches = {
    stores,
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(request: { url: string }) {
      for (const c of stores.values()) {
        const r = await c.match(request);
        if (r) return r;
      }
      return undefined;
    },
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const net = { impl: async (_r: unknown): Promise<Response> => new Response('', { status: 404 }) };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const sandbox: Record<string, unknown> = {
    self, caches, URL, Response, Request, Headers, console, setTimeout,
    fetch: (r: unknown) => net.impl(r),
    module: { exports: {} },
  };
  vm.runInNewContext(SRC, sandbox);
  const api = (sandbox.module as { exports: Record<string, any> }).exports; // eslint-disable-line @typescript-eslint/no-explicit-any
  const req = (path: string, o: { dest?: string; mode?: string; host?: string; headers?: Record<string, string>; method?: string } = {}) => ({
    url: `${o.host ?? ORIGIN}${path}`,
    method: o.method ?? 'GET',
    mode: o.mode ?? 'cors',
    destination: o.dest ?? '',
    headers: new Headers(o.headers ?? {}),
  });
  /** Dispatch a fetch event. Returns the response given to the page (null = the worker did not intercept) once storing has finished. */
  async function fetchEvent(request: ReturnType<typeof req>, respond: () => Promise<Response>) {
    net.impl = respond;
    const box: { responded: Promise<Response> | null } = { responded: null };
    const waits: Promise<unknown>[] = [];
    handlers.fetch({ request, respondWith: (p: Promise<Response>) => { box.responded = p; }, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    const out: Response | null = box.responded ? await box.responded : null;
    await Promise.all(waits);
    return out;
  }
  return { api, caches, handlers, req, fetchEvent, stores };
}

const bytes = (n: number) => 'a'.repeat(n);
const withLength = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Length': String(body.length), ...extra } });
/** A 200 that declares no length, streamed in 64 KiB pieces. */
function streamed(total: number, status = 200) {
  let sent = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (sent >= total) { c.close(); return; }
        const n = Math.min(65536, total - sent);
        sent += n;
        c.enqueue(new Uint8Array(n));
      },
    }),
    { status },
  );
}
const runtimeKeys = async (caches: ReturnType<typeof load>['caches'], name: string) => (await (await caches.open(name)).keys()).map((r) => r.url.replace(ORIGIN, ''));

test('activate: every cache whose name is not the current one is deleted, the current one is kept untouched', async () => {
  const { api, caches, handlers } = load();
  await (await caches.open('angle-motion-v1')).put({ url: `${ORIGIN}/a` }, new Response('1'));
  await (await caches.open('angle-motion-v3')).put({ url: `${ORIGIN}/b` }, new Response('2'));
  await (await caches.open('something-else')).put({ url: `${ORIGIN}/c` }, new Response('3'));
  await (await caches.open(api.CACHE_NAME)).put({ url: `${ORIGIN}/keep` }, new Response('4'));
  assert.notEqual(api.CACHE_NAME, 'angle-motion-v3', 'the name was bumped from v3');
  let activated: Promise<unknown> | null = null;
  handlers.activate({ waitUntil: (p: Promise<unknown>) => { activated = p; } });
  await activated;
  assert.deepEqual(await caches.keys(), [api.CACHE_NAME]);
  assert.deepEqual(await runtimeKeys(caches, api.CACHE_NAME), ['/keep'], 'the current cache keeps its entries');
});

test('size rule: a response over the limit is not stored — declared length, or measured when none is declared', async () => {
  const { api, caches, req, fetchEvent } = load();
  const limit = api.MAX_ENTRY_BYTES;
  // small hashed chunk: stored
  await fetchEvent(req('/_next/static/chunks/a.js', { dest: 'script' }), async () => withLength(bytes(1000)));
  // exactly at the limit: stored
  await fetchEvent(req('/_next/static/chunks/edge.js', { dest: 'script' }), async () => withLength(bytes(limit)));
  // one byte over: not stored
  await fetchEvent(req('/_next/static/chunks/over.js', { dest: 'script' }), async () => withLength(bytes(limit + 1)));
  // the 23 MB wasm under /_next/static: not stored
  await fetchEvent(req('/_next/static/media/ort.wasm'), async () => new Response('x', { status: 200, headers: { 'Content-Length': String(23_567_050) } }));
  // unhashed big model, no declared length: measured, not stored
  await fetchEvent(req('/models/pose_landmarker_heavy.task'), async () => streamed(limit * 3));
  // unhashed small file, no declared length: measured, stored
  await fetchEvent(req('/vendor/small.js', { dest: 'script' }), async () => streamed(50_000));
  assert.deepEqual((await runtimeKeys(caches, api.CACHE_NAME)).sort(), ['/_next/static/chunks/a.js', '/_next/static/chunks/edge.js', '/vendor/small.js']);
});

test('size rule: a big response still reaches the page whole', async () => {
  const { api, req, fetchEvent } = load();
  const out = await fetchEvent(req('/models/big.task'), async () => streamed(api.MAX_ENTRY_BYTES * 2));
  assert.ok(out);
  const buf = await out!.arrayBuffer();
  assert.equal(buf.byteLength, api.MAX_ENTRY_BYTES * 2);
});

test('status rule: only a complete 200 is stored — never errors, empty bodies, 206, redirects, 201 or opaque responses', async () => {
  const { api, caches, req, fetchEvent } = load();
  const cases: Array<[string, () => Response | object]> = [
    ['/_next/static/chunks/404.js', () => withLength('not found', 404)],
    ['/_next/static/chunks/500.js', () => withLength('boom', 500)],
    ['/_next/static/chunks/206.js', () => withLength('part', 206)],
    ['/_next/static/chunks/201.js', () => withLength('made', 201)],
    ['/_next/static/chunks/empty-declared.js', () => new Response('', { status: 200, headers: { 'Content-Length': '0' } })],
    ['/_next/static/chunks/empty-measured.js', () => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 })],
    ['/_next/static/chunks/opaque.js', () => ({ status: 0, type: 'opaque', ok: false, headers: new Headers(), body: null, clone() { return this; } })],
  ];
  for (const [path, make] of cases) await fetchEvent(req(path, { dest: 'script' }), async () => make() as Response);
  assert.deepEqual(await runtimeKeys(caches, api.CACHE_NAME), [], 'nothing from the error cases was stored');
  // and the same for the cache-first rules that used to store anything: jsdelivr, images, fonts
  await fetchEvent(req('/wasm/x.wasm', { host: 'https://cdn.jsdelivr.net' }), async () => withLength('', 503));
  await fetchEvent(req('/img.png', { dest: 'image' }), async () => withLength('gone', 404));
  await fetchEvent(req('/f.woff2', { dest: 'font' }), async () => ({ status: 0, type: 'opaque', ok: false, headers: new Headers(), body: null, clone() { return this; } }) as unknown as Response);
  assert.deepEqual(await runtimeKeys(caches, api.CACHE_NAME), []);
  // a good one on the same rules is stored
  await fetchEvent(req('/img.png', { dest: 'image' }), async () => withLength('png', 200));
  await fetchEvent(req('/lib.js', { host: 'https://cdn.jsdelivr.net' }), async () => withLength('js', 200));
  assert.equal((await runtimeKeys(caches, api.CACHE_NAME)).length, 2);
});

test('the coco-ssd model host is not intercepted at all', async () => {
  const { api, caches, req, fetchEvent } = load();
  const out = await fetchEvent(req('/tfjs-models/coco-ssd/model.json', { host: 'https://storage.googleapis.com' }), async () => withLength('{}'));
  assert.equal(out, null, 'no respondWith: the browser fetches it itself');
  assert.deepEqual(await runtimeKeys(caches, api.CACHE_NAME), []);
});

test('entry cap: the runtime part holds at most MAX_RUNTIME_ENTRIES, oldest first, and the precached shell is never evicted', async () => {
  const { api, caches, handlers, req, fetchEvent } = load();
  let installed: Promise<unknown> | null = null;
  handlers.install({ waitUntil: (p: Promise<unknown>) => { installed = p; } });
  await installed;
  const shell = await runtimeKeys(caches, api.CACHE_NAME);
  assert.deepEqual(shell.sort(), [...api.PRECACHE_ASSETS].sort());
  const extra = 25;
  for (let i = 0; i < api.MAX_RUNTIME_ENTRIES + extra; i++) {
    await fetchEvent(req(`/_next/static/chunks/c${i}.js`, { dest: 'script' }), async () => withLength(bytes(10)));
  }
  const keys = await runtimeKeys(caches, api.CACHE_NAME);
  const runtime = keys.filter((k) => k.startsWith('/_next/'));
  assert.equal(runtime.length, api.MAX_RUNTIME_ENTRIES);
  assert.ok(!runtime.includes('/_next/static/chunks/c0.js'), 'the oldest went first');
  assert.ok(runtime.includes(`/_next/static/chunks/c${api.MAX_RUNTIME_ENTRIES + extra - 1}.js`), 'the newest is kept');
  for (const s of api.PRECACHE_ASSETS) assert.ok(keys.includes(s), `${s} still cached`);
});

test('unchanged rules: /api is network-only and never stored; documents and RSC payloads are not stored; media is not intercepted', async () => {
  const { api, caches, req, fetchEvent } = load();
  const apiRes = await fetchEvent(req('/api/me'), async () => withLength('{"ok":true}'));
  assert.ok(apiRes, '/api is answered by the worker (network)');
  assert.equal(await apiRes!.text(), '{"ok":true}');
  const offline = await fetchEvent(req('/api/me'), async () => { throw new Error('offline'); });
  assert.deepEqual(await offline!.json(), { error: 'Offline' });
  const doc = await fetchEvent(req('/analysis', { mode: 'navigate', dest: 'document' }), async () => withLength('<html>signed in</html>'));
  assert.ok(doc);
  const rsc = await fetchEvent(req('/analysis?_rsc=1', { headers: { RSC: '1' } }), async () => withLength('rsc'));
  assert.equal(rsc, null, 'an RSC fetch is left alone');
  const video = await fetchEvent(req('/Demodjokovic.mp4', { dest: 'video' }), async () => withLength('v'));
  assert.equal(video, null, 'media goes straight to the network');
  assert.deepEqual(await runtimeKeys(caches, api.CACHE_NAME), []);
});

test('worker source: no caching call is left that skips the size/status rule', () => {
  assert.equal((SRC.match(/cache\.put\(/g) ?? []).length, 1, 'one store call, inside storeIfAllowed');
  assert.ok(!/response\.ok/.test(SRC), 'no store decision on `ok` alone');
});
