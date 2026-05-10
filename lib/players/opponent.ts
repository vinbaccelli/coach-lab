/** Normalize names for fuzzy equality (coach-entered vs report text). */
export function normalizePlayerName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-']/g, '');
}

export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

/** Extract opponent-like token from match folder label "YYYY-MM-DD — A vs B" */
export function extractOpponentFromFolderLabel(label: string, playerName: string): string | null {
  const vs = label.split(/\s+vs\s+/i);
  if (vs.length >= 2) {
    const sides = vs[1].split(/\s+/);
    const candidate = sides.slice(0, 3).join(' ').trim();
    if (candidate && !namesLikelyMatch(candidate, playerName)) return candidate;
  }
  const parts = label.split(/[—\-]/);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1].trim();
    if (tail && !namesLikelyMatch(tail, playerName)) return tail;
  }
  return null;
}
