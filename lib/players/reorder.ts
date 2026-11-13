/** Pure helpers for manual ordering (drag up / down) of profile rows and timeline items. */

/** Move the item at `from` so it ends up at index `to`. Out-of-range or no-op moves return the same array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

/**
 * Apply a saved manual order to items that are already sorted by date.
 * Items whose key is NOT in the saved order (new ones) stay on top, in their date order;
 * the rest follow in the saved order. Keys in the order that no longer exist are ignored.
 */
export function applyManualOrder<T extends { key: string }>(items: readonly T[], order: readonly string[] | null | undefined): T[] {
  if (!order || order.length === 0) return items.slice();
  const pos = new Map<string, number>();
  order.forEach((k, i) => { if (!pos.has(k)) pos.set(k, i); });
  const fresh = items.filter((i) => !pos.has(i.key));
  const known = items.filter((i) => pos.has(i.key)).sort((a, b) => (pos.get(a.key) as number) - (pos.get(b.key) as number));
  return [...fresh, ...known];
}

/** Validate a saved order from the database / request body: an array of short strings, capped. */
export function parseOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 80).slice(0, 2000);
  return out;
}
