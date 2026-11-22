/**
 * A phone Auto-detect step that never returns (observed: the page sat on "Removing background: frame 1/5…" for 30+ minutes,
 * not killed, not restarted) is worse than a slow one. This runs `attempt` with a time limit. When it does not finish in time,
 * `recover` is awaited (e.g. release the person segmenter so the retry starts clean) and the step is tried ONCE more with a fresh
 * limit. A second timeout throws, so the caller's own per-frame catch skips that frame and the pass carries on with the rest.
 * Waiting is fine; waiting forever is not.
 */
export class StepTimedOut extends Error {}

function limit<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimedOut(`no answer after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runWithWatchdog<T>(
  attempt: () => Promise<T>,
  opts: { timeoutMs: number; recover?: () => Promise<void>; onTimeout?: (attemptNo: number) => void },
): Promise<T> {
  try {
    return await limit(attempt(), opts.timeoutMs);
  } catch (e) {
    if (!(e instanceof StepTimedOut)) throw e;
    opts.onTimeout?.(1);
    try { await opts.recover?.(); } catch { /* best-effort */ }
  }
  try {
    return await limit(attempt(), opts.timeoutMs);
  } catch (e) {
    if (e instanceof StepTimedOut) opts.onTimeout?.(2);
    throw e;
  }
}
