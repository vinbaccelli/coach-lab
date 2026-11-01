import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_TECHNICAL_SHEET_LABELS, SUGGESTED_LABELS, addRowIfMissing, ageFromDob, defaultTechnicalSheet, findRow, groupOfLabel,
  groupSheetRows, isLongLabel, labelsChanged, missingSuggestions, normalizeLabel, rowValue, type TechnicalSheetRow,
} from '@/lib/players/technicalSheet';
import { buildPatch, changedParts, draftFromPlayer, isDirty, runSave, type ProfileDraft } from '@/components/players/profileSave';

const rows = (...pairs: Array<[string, string]>): TechnicalSheetRow[] => pairs.map(([label, value]) => ({ label, value }));
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

// ── defaults ─────────────────────────────────────────────────────────────────

test('new defaults: UTR, Diet, Exercise plan and Goals are added; the original rows and their order are kept', () => {
  assert.deepEqual([...DEFAULT_TECHNICAL_SHEET_LABELS], [
    'Age', 'Height', 'Weight', 'Dominant Hand', 'Backhand', 'Strengths', 'Weaknesses', 'Level',
    'UTR', 'Diet', 'Exercise plan', 'Goals',
  ]);
  assert.deepEqual([...SUGGESTED_LABELS], ['UTR', 'Diet', 'Exercise plan', 'Goals']);
  const fresh = defaultTechnicalSheet();
  assert.equal(fresh.length, 12);
  assert.ok(fresh.every((r) => r.value === ''));
  assert.deepEqual(missingSuggestions(fresh), [], 'a new player already has them: no suggestions');
  // A coach's own saved template wins, as before.
  assert.deepEqual(defaultTechnicalSheet(['Height', 'Serve speed']).map((r) => r.label), ['Height', 'Serve speed']);
});

// ── grouping ─────────────────────────────────────────────────────────────────

test('grouping: Body, Game, Training and lifestyle, and Other for custom rows; nothing dropped or repeated', () => {
  const sheet = rows(
    ['Age', ''], ['Height', '185 cm'], ['Weight', '78 kg'], ['Dominant Hand', 'Right'], ['Backhand', 'Two-handed'],
    ['Strengths', 'Serve'], ['Weaknesses', 'Net'], ['Level', '4.0'], ['UTR', '7.5'],
    ['Diet', 'No dairy'], ['Exercise plan', 'Mon/Wed gym'], ['Goals', 'Top 10'], ['Serve speed', '170 km/h'], ['Racket', 'Pro Staff'],
  );
  const g = groupSheetRows(sheet);
  assert.deepEqual(g.body.map((x) => x.row.label), ['Age', 'Height', 'Weight']);
  assert.deepEqual(g.game.map((x) => x.row.label), ['Dominant Hand', 'Backhand', 'Strengths', 'Weaknesses', 'Level', 'UTR']);
  assert.deepEqual(g.lifestyle.map((x) => x.row.label), ['Diet', 'Exercise plan', 'Goals']);
  assert.deepEqual(g.other.map((x) => x.row.label), ['Serve speed', 'Racket']);
  const all = [...g.body, ...g.game, ...g.lifestyle, ...g.other];
  assert.equal(all.length, sheet.length);
  assert.deepEqual(all.map((x) => x.index).sort((a, b) => a - b), sheet.map((_, i) => i), 'every row keeps its place in the full sheet');
  for (const x of all) assert.equal(sheet[x.index], x.row, 'an edit goes back to the right row');
});

test('grouping reads the label, not the case or the spacing; unknown labels go to Other', () => {
  assert.equal(normalizeLabel('  Exercise   PLAN '), 'exercise plan');
  assert.equal(groupOfLabel('exercise plan'), 'lifestyle');
  assert.equal(groupOfLabel('EXERCISE  Plan'), 'lifestyle');
  assert.equal(groupOfLabel('utr'), 'game');
  assert.equal(groupOfLabel('dominant hand'), 'game');
  assert.equal(groupOfLabel('Shoe size'), 'other');
  assert.equal(groupOfLabel(''), 'other');
  assert.deepEqual(groupSheetRows([]), { body: [], game: [], lifestyle: [], other: [] });
  // Two rows with the same label both stay.
  assert.equal(groupSheetRows(rows(['Diet', 'a'], ['diet', 'b'])).lifestyle.length, 2);
});

test('long labels are the ones that hold sentences; short ones sit beside their label', () => {
  for (const l of ['Strengths', 'Weaknesses', 'Diet', 'Exercise plan', 'Goals', ' goals ']) assert.equal(isLongLabel(l), true, l);
  for (const l of ['Height', 'Weight', 'UTR', 'Level', 'Dominant Hand', 'Serve speed']) assert.equal(isLongLabel(l), false, l);
});

test('rowValue and findRow: any case, trimmed, empty when missing', () => {
  const sheet = rows(['UTR', ' 7.5 '], ['Level', '']);
  assert.equal(rowValue(sheet, 'utr'), '7.5');
  assert.equal(rowValue(sheet, 'Level'), '');
  assert.equal(rowValue(sheet, 'Diet'), '');
  assert.equal(findRow(sheet, 'Diet'), undefined);
});

// ── age ──────────────────────────────────────────────────────────────────────

test('age is worked out from the date of birth, by calendar date', () => {
  assert.equal(ageFromDob('2009-03-14', day(2026, 11, 1)), 17);
  assert.equal(ageFromDob('2009-03-14', day(2026, 3, 14)), 17, 'on the birthday');
  assert.equal(ageFromDob('2009-03-14', day(2026, 3, 13)), 16, 'the day before');
  assert.equal(ageFromDob('2009-11-02', day(2026, 11, 1)), 16, 'later this month');
  assert.equal(ageFromDob('2026-10-31', day(2026, 11, 1)), 0, 'a baby');
  assert.equal(ageFromDob('2000-02-29', day(2026, 2, 28)), 25, 'leap-day birthday, before the 1st of March');
  assert.equal(ageFromDob('2009-03-14T00:00:00.000Z', day(2026, 11, 1)), 17, 'an ISO timestamp is accepted');
});

test('age is empty when it cannot be trusted: no date, bad date, future, impossible', () => {
  const now = day(2026, 11, 1);
  for (const bad of [null, undefined, '', '  ', 'tomorrow', '14/03/2009', '2009-13-01', '2009-02-31', '2027-01-01', '1800-01-01']) {
    assert.equal(ageFromDob(bad as string | null | undefined, now), null, String(bad));
  }
});

// ── suggestions ──────────────────────────────────────────────────────────────

test('suggestions list only what is missing, and adding one never changes an existing row', () => {
  const existing = rows(['Height', '185'], ['Diet', 'Vegetarian'], ['Level', '4.0']);
  assert.deepEqual(missingSuggestions(existing), ['UTR', 'Exercise plan', 'Goals']);
  const added = addRowIfMissing(existing, 'UTR');
  assert.deepEqual(added.slice(0, 3), existing, 'existing rows are untouched');
  assert.deepEqual(added[3], { label: 'UTR', value: '' });
  assert.equal(added.length, 4);
  // Already there (even in another case): nothing is added, nothing overwritten.
  const same = addRowIfMissing(existing, 'diet');
  assert.deepEqual(same, existing);
  assert.equal(same[1].value, 'Vegetarian');
  assert.notEqual(same, existing, 'a copy, never the same array');
  assert.deepEqual(addRowIfMissing(existing, '   '), existing, 'a blank label adds nothing');
  assert.deepEqual(missingSuggestions(added), ['Exercise plan', 'Goals']);
  assert.deepEqual(missingSuggestions([]), ['UTR', 'Diet', 'Exercise plan', 'Goals']);
});

test('labelsChanged is true only when a row was added, removed or renamed (not when a value changed)', () => {
  const a = rows(['Height', '185'], ['Diet', '']);
  assert.equal(labelsChanged(a, rows(['Height', '190'], ['Diet', 'x'])), false);
  assert.equal(labelsChanged(a, rows(['Height', '185'])), true);
  assert.equal(labelsChanged(a, [...a, { label: 'UTR', value: '' }]), true);
  assert.equal(labelsChanged(a, rows(['Height', '185'], ['Food', ''])), true);
});

// ── save state ───────────────────────────────────────────────────────────────

const player = {
  photo_url: null, date_of_birth: '2009-03-14', nationality: 'Italy', playing_hand: 'right', notes: null,
  technical_sheet: rows(['Height', '185'], ['Diet', '']),
};

test('the draft starts from the player, with empty text for null and the built-in rows when no sheet was ever saved', () => {
  const d = draftFromPlayer(player);
  assert.deepEqual(d, { photo_url: '', date_of_birth: '2009-03-14', nationality: 'Italy', playing_hand: 'right', notes: '', sheet: rows(['Height', '185'], ['Diet', '']) });
  assert.equal(draftFromPlayer({ technical_sheet: null, playing_hand: 'banana' }).playing_hand, 'unknown');
  assert.equal(draftFromPlayer({ technical_sheet: null }).sheet.length, 12);
  assert.equal(draftFromPlayer({ date_of_birth: '2009-03-14T00:00:00Z' }).date_of_birth, '2009-03-14');
});

test('nothing changed: not dirty, nothing to send; a change makes only that part dirty', () => {
  const base = draftFromPlayer(player);
  assert.equal(isDirty(base, structuredClone(base)), false);
  assert.deepEqual(buildPatch(base, structuredClone(base)), {});
  const next: ProfileDraft = { ...structuredClone(base), nationality: 'Spain' };
  assert.equal(isDirty(base, next), true);
  assert.deepEqual(Object.entries(changedParts(base, next)).filter(([, v]) => v).map(([k]) => k), ['nationality']);
  assert.deepEqual(buildPatch(base, next), { nationality: 'Spain' });
});

test('only what changed is sent; emptied text goes as null; an edited sheet goes whole', () => {
  const base = draftFromPlayer(player);
  const draft: ProfileDraft = {
    ...structuredClone(base), nationality: '', notes: 'Left the club in May', playing_hand: 'left',
    sheet: rows(['Height', '186'], ['Diet', 'No dairy']),
  };
  assert.deepEqual(buildPatch(base, draft), {
    nationality: null, notes: 'Left the club in May', playing_hand: 'left', technical_sheet: rows(['Height', '186'], ['Diet', 'No dairy']),
  });
});

test('a save that works: the saved copy becomes what was sent, and the template follows only when labels changed', async () => {
  const base = draftFromPlayer(player);
  const sent: Array<Record<string, unknown>> = [];
  const valueOnly: ProfileDraft = { ...structuredClone(base), sheet: rows(['Height', '186'], ['Diet', '']) };
  const r1 = await runSave(base, valueOnly, async (p) => { sent.push(p); });
  assert.equal(r1.ok, true);
  assert.deepEqual(sent, [{ technical_sheet: rows(['Height', '186'], ['Diet', '']) }]);
  assert.equal(r1.ok && r1.templateLabels, null, 'a changed value does not touch the template');
  assert.equal(r1.ok && isDirty(r1.base, valueOnly), false);

  const withRow: ProfileDraft = { ...structuredClone(valueOnly), sheet: [...valueOnly.sheet, { label: 'UTR', value: '7.5' }] };
  const r2 = await runSave(valueOnly, withRow, async () => {});
  assert.deepEqual(r2.ok && r2.templateLabels, ['Height', 'Diet', 'UTR'], 'labels only, never the values');
});

test('nothing to save: no request is made', async () => {
  const base = draftFromPlayer(player);
  let calls = 0;
  const r = await runSave(base, structuredClone(base), async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(r.ok, true);
});

test('a failed save keeps what was typed: the draft is untouched, the saved copy is the old one, it is still unsaved', async () => {
  const base = draftFromPlayer(player);
  const draft: ProfileDraft = { ...structuredClone(base), notes: 'Long careful note the coach just typed', sheet: rows(['Height', '186'], ['Diet', 'No dairy'], ['UTR', '7.5']) };
  const before = structuredClone(draft);
  const r = await runSave(base, draft, async () => { throw new Error('Pro plan required'); });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, 'Pro plan required', 'the server\'s own words are shown');
  assert.deepEqual(draft, before, 'the draft was not changed');
  assert.equal(r.base, base, 'the saved copy is the old one');
  assert.equal(isDirty(r.base, draft), true, 'still unsaved, so it can be tried again');
  assert.equal(r.ok === false && 'templateLabels' in r, false, 'the template is not touched on a failure');
  // And a retry then works with the same draft.
  const again = await runSave(r.base, draft, async () => {});
  assert.equal(again.ok && isDirty(again.base, draft), false);
});

test('a failure with no message still says something; typing during a save stays unsaved', async () => {
  const base = draftFromPlayer(player);
  const draft: ProfileDraft = { ...structuredClone(base), notes: 'a' };
  const r = await runSave(base, draft, async () => { throw new Error(''); });
  assert.equal(!r.ok && r.error, 'Could not save the profile');
  // The coach keeps typing while the request is running: the saved copy is what was SENT.
  const live: ProfileDraft = { ...structuredClone(base), notes: 'a' };
  const ok = await runSave(base, live, async () => { live.notes = 'a and more typed meanwhile'; live.sheet[0].value = 'changed too'; });
  assert.equal(ok.ok && ok.base.notes, 'a');
  assert.equal(ok.ok && ok.base.sheet[0].value, '185');
  assert.equal(ok.ok && isDirty(ok.base, live), true);
});

// ── wiring ───────────────────────────────────────────────────────────────────

const client = readFileSync('components/players/PlayerProfileClient.tsx', 'utf8');
const view = readFileSync('components/players/PlayerProfileView.tsx', 'utf8');
const reports = readFileSync('components/players/ProfileReports.tsx', 'utf8');

test('REPORTS_IN_APP off: the original profile is what runs, byte for byte below one early return', () => {
  const at = client.indexOf('if (REPORTS_IN_APP) {\n    return <PlayerProfileView');
  assert.ok(at !== -1, 'one early return into the new view');
  assert.ok(at > client.indexOf('if (!player) {'), 'after the loading and not-found guards');
  const below = client.slice(at);
  for (const old of ['Technical Sheet', 'Save sheet', 'Save profile', 'New Analysis Session', 'Open Drive folder ↗', 'REPORTS_IN_APP ? <DeletePlayerSection']) {
    assert.ok(below.includes(old), `still there for the flag-off path: ${old}`);
  }
  // The flag is one constant and is on today.
  assert.match(readFileSync('lib/featureFlags.ts', 'utf8'), /export const REPORTS_IN_APP = true;/);
});

test('the view keeps what the profile had: Danger zone, reports, tour ids, plan lock, and saves through the existing PATCH', () => {
  assert.ok(view.includes('<DeletePlayerSection playerId={playerId} playerName={player.display_name} />'));
  assert.ok(!/canEdit[\s\S]{0,40}<DeletePlayerSection/.test(view), 'the Danger zone is not plan-gated');
  assert.ok(view.includes('data-tour-id="player-profile"'));
  assert.ok(reports.includes('data-tour-id="player-doc-links"') && reports.includes('data-tour-id="player-report-tabs"'));
  assert.ok(view.includes('<PlanLockedNotice feature="players">'));
  assert.ok(reports.includes('`/players/${playerId}/reports/${id}`') && reports.includes('`/players/${playerId}/reports`'));
  assert.ok(reports.includes('https://drive.google.com/drive/folders/${folderId}'));
  const save = readFileSync('components/players/profileSave.ts', 'utf8');
  assert.ok(save.includes("fetch(`/api/players/${playerId}`") && save.includes("method: 'PATCH'"));
  // The API route itself is not part of this change.
  assert.ok(readFileSync('app/api/players/[id]/route.ts', 'utf8').includes('export async function PATCH('));
});

test('privacy: the hint is under Training and lifestyle, and nothing about a value is logged or sent anywhere new', () => {
  assert.ok(view.includes("'Training and lifestyle'") && view.includes("'Only store what you need for coaching.'"));
  const code = [view, reports, readFileSync('components/players/profileSave.ts', 'utf8')].join('\n');
  assert.equal(/console\.|Sentry|captureException|localStorage|sessionStorage|navigator\.sendBeacon|analytics/i.test(code), false);
  // The only requests: the player PATCH, the coach-settings template (labels only), and links the coach follows.
  const urls = [...code.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(urls.sort(), ["'/api/coach-settings'", '`/api/players/${playerId}`']);
  assert.ok(code.includes('technicalSheetTemplate: labels'), 'the template carries labels only');
  // The photo link is loaded without sending the page address along.
  assert.ok(view.includes('referrerPolicy="no-referrer"'));
});

test('phone: 44 px targets on every control, 16 px inputs (no iOS zoom), no fixed widths that can overflow', () => {
  const css = view.slice(view.indexOf('const PROFILE_CSS'));
  for (const cls of ['.pp-x', '.pp-seg button', '.pp-add', '.pp-btn', '.pp-link', '.pp-jump', '.pp-save', '.pp-search', '.pp-select', '.pp-text']) {
    const rule = css.split('\n').find((l) => l.startsWith(`${cls} {`));
    assert.ok(rule, `${cls} has a rule`);
    assert.match(rule!, /(min-)?height: 44px/, `${cls} is at least 44 px high`);
  }
  assert.match(css.split('\n').find((l) => l.startsWith('.pp-text {'))!, /font-size: 16px/);
  assert.match(css.split('\n').find((l) => l.startsWith('.pp-search {'))!, /font-size: 16px/);
  assert.match(css, /\.pp-root \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.pp-root \*, \.pp-root \*::before, \.pp-root \*::after \{ box-sizing: border-box; \}/);
  assert.match(css, /safe-area-inset-bottom/);
});
