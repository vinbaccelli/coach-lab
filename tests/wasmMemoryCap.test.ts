import test from 'node:test';
import assert from 'node:assert/strict';
import { capMemoryDescriptor, installWasmMemoryCap, PHONE_WASM_MEMORY_MAX_PAGES } from '../lib/stroMotionDraft/wasmMemoryCap';

test('a 4 GB maximum is lowered to the cap; smaller or missing maxima are untouched', () => {
  assert.deepEqual(capMemoryDescriptor({ initial: 256, maximum: 65536, shared: true }, PHONE_WASM_MEMORY_MAX_PAGES), { initial: 256, maximum: PHONE_WASM_MEMORY_MAX_PAGES, shared: true });
  assert.deepEqual(capMemoryDescriptor({ initial: 256, maximum: 1000 }, PHONE_WASM_MEMORY_MAX_PAGES), { initial: 256, maximum: 1000 });
  assert.deepEqual(capMemoryDescriptor({ initial: 256 }, PHONE_WASM_MEMORY_MAX_PAGES), { initial: 256 });
});

test('installed constructor still builds real memories, with the lowered maximum, and instanceof keeps working', () => {
  const Real = WebAssembly.Memory;
  try {
    assert.equal(installWasmMemoryCap(100), true);
    assert.equal(installWasmMemoryCap(100), false, 'idempotent');
    const m = new WebAssembly.Memory({ initial: 2, maximum: 65536 });
    assert.ok(m instanceof Real);
    m.grow(98); // up to the capped maximum is fine
    assert.throws(() => m.grow(1), RangeError); // past it is refused
  } finally {
    WebAssembly.Memory = Real;
  }
});
