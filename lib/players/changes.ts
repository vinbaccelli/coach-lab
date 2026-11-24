/**
 * The player change log: what the timeline shows when something that OVERWRITES its old value is saved
 * (the Blueprint first). Pure functions; the route writes the row, the history reads it.
 */
import {
  SCOPES, STROKE_KEYS, STROKE_LABELS, choiceLabel, sanitizeBlueprint, variantsFor,
} from '@/lib/players/blueprint';

const MAX_LINES = 8;

/**
 * What changed between two Blueprints, one line each ("Forehand, Grip: Semi-western", "Serve: 2 checks marked"),
 * or null when nothing changed (saving the same Blueprint again leaves no stamp).
 */
export function summarizeBlueprintChange(prevRaw: unknown, nextRaw: unknown): { title: string; body: string } | null {
  const prev = sanitizeBlueprint(prevRaw);
  const next = sanitizeBlueprint(nextRaw);
  const lines: string[] = [];

  for (const scope of SCOPES) {
    for (const g of variantsFor(scope)) {
      const a = prev.choices[scope]?.[g.id];
      const b = next.choices[scope]?.[g.id];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      const was = a ? choiceLabel(scope, g.id, a) : '';
      const now = b ? choiceLabel(scope, g.id, b) : '';
      const where = scope === 'general' ? g.label : `${STROKE_LABELS[scope]}, ${g.label}`;
      lines.push(now ? `${where}: ${now}${was ? ` (was ${was})` : ''}` : `${where}: choice removed${was ? ` (was ${was})` : ''}`);
    }
  }
  for (const stroke of STROKE_KEYS) {
    const a = prev.checks[stroke] ?? {};
    const b = next.checks[stroke] ?? {};
    const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
    let changed = 0;
    ids.forEach((id) => { if (JSON.stringify(a[id] ?? null) !== JSON.stringify(b[id] ?? null)) changed += 1; });
    if (changed) lines.push(`${STROKE_LABELS[stroke]}: ${changed} ${changed === 1 ? 'check' : 'checks'} marked or changed`);
  }

  if (!lines.length) return null;
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`);
  return { title: 'Blueprint updated', body: shown.join('\n') };
}
