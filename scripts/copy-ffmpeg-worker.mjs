/**
 * Stage @ffmpeg/ffmpeg's ESM worker into public/ffmpeg/ before dev and build.
 *
 * WHY THIS EXISTS — A BUNDLER BUG, NOT A HOSTING PREFERENCE
 * --------------------------------------------------------
 * `@ffmpeg/ffmpeg`'s worker loads ffmpeg-core like this (dist/esm/worker.js):
 *
 *     try { importScripts(_coreURL); }                        // classic worker
 *     catch { self.createFFmpegCore =
 *       (await import(  //* @vite-ignore *  _coreURL)).default; }  // module worker
 *
 * Two facts make that fatal under webpack, which is what Next builds with:
 *
 *   1. `classes.js` always creates the worker with `{ type: "module" }`, and a
 *      module worker has no `importScripts` — so the try ALWAYS throws and the
 *      catch is the only path ever taken.
 *   2. That catch does `await import(<runtime value>)`. The pragma next to it is
 *      `@vite-ignore`; there is no webpack equivalent, so webpack compiles the
 *      call into its own module registry — measured in the built chunk, it comes
 *      out as `t(30260)(s)`, i.e. `__webpack_require__` against a generated
 *      context module, with the URL passed as a MODULE KEY.
 *
 * Nothing in webpack's registry is keyed by a runtime URL, so every conversion
 * died with `Cannot find module 'blob:http://localhost:3001/…'`. It had nothing
 * to do with where the core was fetched from: reproduced with the core served
 * same-origin at 200 OK.
 *
 * Serving the worker as a STATIC FILE fixes it at the root. Webpack never sees
 * it, so the `import()` inside stays a native dynamic import and resolves the
 * URL — blob or otherwise — the way the library intended.
 *
 * Same reasoning and same shape as copy-ort-wasm.mjs: copied from node_modules
 * at build time rather than committed, so it cannot rot out of step with the
 * installed @ffmpeg/ffmpeg version, and costs the repo nothing.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const dest = join(root, 'public', 'ffmpeg');

// worker.js plus the two leaf modules it imports relatively. Both are
// dependency-free, so this is the complete closure — verified, not assumed.
const FILES = ['worker.js', 'const.js', 'errors.js'];

if (!existsSync(src)) {
  console.warn('[copy-ffmpeg-worker] @ffmpeg/ffmpeg not installed — skipping (MP4 conversion will be unavailable)');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
let copied = 0;
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.warn(`[copy-ffmpeg-worker] missing ${f} — skipped`);
    continue;
  }
  copyFileSync(from, join(dest, f));
  copied++;
}
console.log(`[copy-ffmpeg-worker] staged ${copied}/${FILES.length} ffmpeg worker files into public/ffmpeg/`);
