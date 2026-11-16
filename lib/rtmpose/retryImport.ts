/** Dynamic-import chunks can time out on a phone's first visit to a fresh deploy ("Loading chunk N failed"): retry a few times. */
export async function retryImport<T>(load: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await load(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
