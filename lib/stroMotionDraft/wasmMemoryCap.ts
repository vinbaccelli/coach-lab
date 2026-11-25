/**
 * Every onnxruntime-web wasm binary we ship imports a SHARED WebAssembly.Memory with a 4096 MB maximum (measured: all three
 * ort-wasm-simd-threaded*.wasm files). WebKit reserves a shared memory's whole maximum up front, and on an iPhone that reservation fails
 * ("[wasm] RangeError: Out of memory" at model load, whatever the video size), more so once earlier workers have each reserved theirs.
 * A smaller maximum is a valid import (the provided memory only has to fit inside the declared one), so on a phone the worker caps it.
 */
export const PHONE_WASM_MEMORY_MAX_PAGES = 24576; // 1536 MB (64 KiB pages): MobileSAM peaks near 400 MB, SAM-2 near 900 MB

export function capMemoryDescriptor<T extends { initial?: number; maximum?: number; shared?: boolean }>(desc: T, maxPages: number): T {
  if (desc && typeof desc.maximum === 'number' && desc.maximum > maxPages) return { ...desc, maximum: maxPages };
  return desc;
}

/** Replace WebAssembly.Memory with a constructor that caps the maximum. Idempotent; returns false if already installed or unavailable. */
export function installWasmMemoryCap(maxPages: number = PHONE_WASM_MEMORY_MAX_PAGES): boolean {
  const W = (globalThis as { WebAssembly?: { Memory?: unknown } }).WebAssembly;
  const Orig = W?.Memory as (new (d: { initial: number; maximum?: number; shared?: boolean }) => unknown) & { __capped?: boolean } | undefined;
  if (!W || !Orig || Orig.__capped) return false;
  const Patched = function (this: unknown, desc: { initial: number; maximum?: number; shared?: boolean }) {
    return new Orig(capMemoryDescriptor(desc, maxPages));
  } as unknown as { prototype: unknown; __capped?: boolean };
  Patched.prototype = (Orig as unknown as { prototype: unknown }).prototype;
  Patched.__capped = true;
  W.Memory = Patched;
  return true;
}
