/**
 * The CLOSED VOCABULARY of point outcomes, and the fuzzy matcher that maps a
 * timeline row's right-hand text onto it.
 *
 * WHY A CLOSED VOCABULARY
 * This is the anti-fabrication gate for Phase 2, and it is the same idea as
 * Phase 1's "the section title must literally appear on the page": a point's
 * outcome is only ever recorded if the words on screen match terms in THIS
 * file. There is no open-ended "whatever tesseract said" path into the data
 * model — an unmatched row is reported as `unrecognizedOutcomeText` and
 * flagged, never coerced into the nearest plausible label. So a mis-scan
 * shows up in the harness as a visible gap, which is checkable; it cannot
 * quietly become a Forehand Winner in the report.
 *
 * WHY COMPOSITIONAL (shot term + result term) RATHER THAN ONE FLAT LIST
 * SwingVision's labels are a product of two independent axes — which stroke
 * ("Forehand", "Backhand", "Service") and what happened ("Winner", "Unforced
 * Error"). Enumerating the cross-product by hand means a label the app emits
 * but we forgot to list ("Volley Forced Error") reads as unrecognized even
 * though both of its halves are known. Matching each axis separately covers
 * the grid, and — critically — both halves must still be literally found in
 * the row text, so nothing is invented by the composition.
 *
 * FUZZINESS IS BOUNDED AND REPORTED. OCR on this content misreads a letter or
 * two ("Unforced"→"Untorced"). A word is accepted at Levenshtein ≤1 (≤2 for
 * words of 9+ characters) and never for short words, where a 1-edit
 * neighbourhood is large enough to be a different word entirely. Any fuzzy
 * acceptance downgrades the parse's `quality` to 'fuzzy', which the harness
 * shows, so the architect can see exactly which reads were not verbatim.
 */

import type { OutcomeResult, OutcomeShot, ParsedOutcome } from '@/lib/matchDecoder/types';

// ── string distance ───────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export type MatchQuality = 'exact' | 'fuzzy';

/**
 * Does `observed` match vocabulary word `target`?
 *
 * Tolerance scales with the TARGET's length, not the observed string's: a
 * 1-edit neighbourhood around a 4-letter word ("Ace") contains real other
 * words, so short targets must match verbatim; a 1-edit slip in "Unforced" is
 * overwhelmingly an OCR artefact.
 */
export function wordMatch(observed: string, target: string): MatchQuality | null {
  if (observed === target) return 'exact';
  const tolerance = target.length >= 9 ? 2 : target.length >= 5 ? 1 : 0;
  if (tolerance === 0) return null;
  if (Math.abs(observed.length - target.length) > tolerance) return null;
  return levenshtein(observed, target) <= tolerance ? 'fuzzy' : null;
}

/** Locate a multi-word phrase as a consecutive run inside `words`. */
export function findPhrase(
  words: string[],
  phrase: string[],
): { index: number; quality: MatchQuality } | null {
  for (let i = 0; i + phrase.length <= words.length; i++) {
    let quality: MatchQuality = 'exact';
    let ok = true;
    for (let k = 0; k < phrase.length; k++) {
      const m = wordMatch(words[i + k], phrase[k]);
      if (!m) {
        ok = false;
        break;
      }
      if (m === 'fuzzy') quality = 'fuzzy';
    }
    if (ok) return { index: i, quality };
  }
  return null;
}

/** Letters and spaces only — strips the icon/dot junk tesseract emits ("©", "dd", "HF" survive as words but match nothing). */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ── the vocabulary ────────────────────────────────────────────────────────

interface ShotTerm {
  display: OutcomeShot;
  phrase: string[];
}

interface ResultTerm {
  display: OutcomeResult;
  phrase: string[];
  /**
   * The label stands alone on screen — SwingVision writes "Ace", not "Service
   * Ace" — so the canonical string must not have a shot prefixed onto it.
   */
  standalone?: boolean;
  /** Structurally a serve, so the point is attributable to whoever served. */
  impliesServe?: boolean;
}

/**
 * LONGEST PHRASE FIRST within each table. "Forehand Volley" must be tested
 * before "Forehand" or the volley half is lost; "Double Fault" before "Fault";
 * "Unforced Error" before "Forced Error" before "Error".
 */
const SHOT_TERMS: ShotTerm[] = [
  { display: 'Forehand Volley', phrase: ['forehand', 'volley'] },
  { display: 'Backhand Volley', phrase: ['backhand', 'volley'] },
  { display: 'Forehand Slice', phrase: ['forehand', 'slice'] },
  { display: 'Backhand Slice', phrase: ['backhand', 'slice'] },
  { display: 'Drop Shot', phrase: ['drop', 'shot'] },
  { display: 'Service', phrase: ['service'] },
  { display: 'Service', phrase: ['serve'] },
  { display: 'Forehand', phrase: ['forehand'] },
  { display: 'Backhand', phrase: ['backhand'] },
  { display: 'Return', phrase: ['return'] },
  { display: 'Volley', phrase: ['volley'] },
  { display: 'Smash', phrase: ['smash'] },
  { display: 'Smash', phrase: ['overhead'] },
  { display: 'Slice', phrase: ['slice'] },
  { display: 'Lob', phrase: ['lob'] },
];

const RESULT_TERMS: ResultTerm[] = [
  { display: 'Unforced Error', phrase: ['unforced', 'error'] },
  { display: 'Forced Error', phrase: ['forced', 'error'] },
  { display: 'Double Fault', phrase: ['double', 'fault'], standalone: true, impliesServe: true },
  { display: 'Ace', phrase: ['ace'], standalone: true, impliesServe: true },
  { display: 'Winner', phrase: ['winner'] },
  { display: 'Let', phrase: ['let'], standalone: true, impliesServe: true },
  { display: 'Fault', phrase: ['fault'], impliesServe: true },
  { display: 'Error', phrase: ['error'] },
];

/** Every canonical label this decoder can produce — rendered in the harness so the vocabulary is auditable against the app. */
export function vocabularySummary(): { shots: string[]; results: string[] } {
  return {
    shots: Array.from(new Set(SHOT_TERMS.map((s) => s.display))),
    results: Array.from(new Set(RESULT_TERMS.map((r) => r.display))),
  };
}

/**
 * Parse one timeline row's outcome column.
 *
 * Returns null when NEITHER axis is present — that row is not an outcome, and
 * the caller reports it as unrecognized rather than reaching for a default.
 *
 * `hitter` is deliberately coarse. A serve outcome (Ace, Double Fault, Service
 * Winner) can only have been struck by whoever was serving, and the game header
 * tells us who that was — so those points are attributable with certainty. A
 * "Forehand Winner" could have come off either racket, and the only on-screen
 * cue for which is the small coloured dot the architect measured as not
 * reliably OCR-able. So it stays 'unknown'. This is the field that stops the
 * later analysis engine from splitting winners and errors between players on a
 * guess.
 */
export function matchOutcome(text: string): ParsedOutcome | null {
  const words = normalizeWords(text);
  if (!words.length) return null;

  let quality: MatchQuality = 'exact';

  let shot: OutcomeShot | undefined;
  for (const term of SHOT_TERMS) {
    const hit = findPhrase(words, term.phrase);
    if (hit) {
      shot = term.display;
      if (hit.quality === 'fuzzy') quality = 'fuzzy';
      break;
    }
  }

  let resultTerm: ResultTerm | undefined;
  for (const term of RESULT_TERMS) {
    const hit = findPhrase(words, term.phrase);
    if (hit) {
      resultTerm = term;
      if (hit.quality === 'fuzzy') quality = 'fuzzy';
      break;
    }
  }

  if (!shot && !resultTerm) return null;

  let result: OutcomeResult = resultTerm?.display ?? 'Unspecified';
  const impliesServe = resultTerm?.impliesServe === true;
  const effectiveShot: OutcomeShot | undefined = shot ?? (impliesServe ? 'Service' : undefined);

  // CONFIRMED against real captures: SwingVision's "Service Winner" IS an ace —
  // the app has no separate "Ace" label. Collapsing the two here means the
  // report counts aces once under one name, rather than splitting the same event
  // across two labels and under-reporting both.
  let standalone = resultTerm?.standalone === true;
  if (effectiveShot === 'Service' && result === 'Winner') {
    result = 'Ace';
    standalone = true;
  }

  // Canonical string is assembled ONLY from terms that were literally matched.
  const canonical = standalone
    ? result
    : effectiveShot && result !== 'Unspecified'
      ? `${effectiveShot} ${result}`
      : effectiveShot
        ? effectiveShot
        : result;

  return {
    canonical,
    shot: effectiveShot,
    result,
    hitter: effectiveShot === 'Service' ? 'server' : 'unknown',
    quality,
  };
}
