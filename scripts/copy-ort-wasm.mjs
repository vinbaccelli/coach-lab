/**
 * Stage onnxruntime-web's wasm runtime into public/ort/ before dev and build.
 *
 * WHY A BUILD STEP RATHER THAN COMMITTED FILES
 * --------------------------------------------
 * The SAM racket segmenter needs ORT's wasm binaries at runtime, and this app's
 * rule is SELF-HOSTED, NOT CDN (see multiclassSegmenter.ts) — so leaving ORT to
 * its default jsDelivr fetch is not an option. But the binaries run to ~51MB
 * across the variants a browser might ask for, and committing that would dwarf
 * the ~33MB of model weights, which is the only size cost that was actually
 * agreed.
 *
 * They already ship inside node_modules on every install, including on Vercel.
 * Copying them here gives same-origin self-hosting with ZERO repo weight, and
 * they stay automatically in step with the installed onnxruntime-web version
 * instead of silently rotting as committed copies would.
 *
 * WHICH VARIANTS, AND WHY NOT ALL OF THEM
 * ---------------------------------------
 * ORT picks one at runtime from the browser's capabilities:
 *   - asyncify → WebGPU without JSPI (what Chrome on the dev machine picks)
 *   - jspi     → WebGPU with JSPI available
 *   - plain    → no WebGPU at all, wasm EP only
 * The `jsep` build is the legacy name and onnxruntime-web 1.27 never requests
 * it — measured, not assumed: the browser fetched only `asyncify` when all four
 * were staged. It is excluded, which alone saves 26MB.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(root, 'public', 'ort');

const FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

if (!existsSync(src)) {
  // Not an error: onnxruntime-web arrives as a transitive dep of
  // @huggingface/transformers, and a checkout without it should still build —
  // the racket tool simply reports itself unavailable at runtime.
  console.warn('[copy-ort-wasm] onnxruntime-web not installed — skipping (SAM racket tool will be unavailable)');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
let copied = 0;
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.warn(`[copy-ort-wasm] missing ${f} — skipped`);
    continue;
  }
  copyFileSync(from, join(dest, f));
  copied++;
}
console.log(`[copy-ort-wasm] staged ${copied}/${FILES.length} ORT runtime files into public/ort/`);
