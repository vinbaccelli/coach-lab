import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBlocks,
  entryDateKey,
  filterReports,
  findReportForEntry,
  groupByMonth,
  groupEntriesIntoReports,
  readScreenshotUrls,
  type EntryLike,
} from '../lib/reports/deriveBlocks';

/** Local-time timestamps, so the day grouping is the same in any TZ the suite runs in. */
const at = (y: number, mo: number, d: number, h = 10, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

const shot = (id: string, created_at: string, url: string, extra: Partial<EntryLike> = {}): EntryLike => ({
  id,
  category: 'technique',
  folder_label: 'Analysis',
  body_text: 'Screenshot from analysis session.',
  screenshots: [url],
  created_at,
  ...extra,
});

test('same-day technique entries become one report, screenshots in the order taken', () => {
  const entries = [
    shot('b', at(2026, 10, 27, 12), 'https://img/2.png'),
    shot('a', at(2026, 10, 27, 9), 'https://img/1.png'),
    shot('c', at(2026, 10, 27, 15), 'https://img/3.png'),
    shot('d', at(2026, 10, 26, 15), 'https://img/old.png'),
  ];
  const reports = groupEntriesIntoReports(entries);
  assert.equal(reports.length, 2);
  const today = reports[0];
  assert.equal(today.kind, 'technical');
  assert.equal(today.dateKey, '2026-10-27');
  assert.deepEqual(today.entryIds, ['a', 'b', 'c']);
  const gallery = today.blocks.find((b) => b.type === 'screenshots');
  assert.ok(gallery && gallery.type === 'screenshots');
  assert.deepEqual(gallery.images.map((i) => i.url), ['https://img/1.png', 'https://img/2.png', 'https://img/3.png']);
  assert.equal(today.screenshotCount, 3);
  assert.equal(today.linkId, 'c');
  assert.equal(findReportForEntry(reports, 'a'), today);
  assert.equal(findReportForEntry(reports, 'nope'), null);
});

test('the screenshot boilerplate line is not shown, real notes are', () => {
  const blocks = deriveBlocks(
    [
      shot('a', at(2026, 10, 27, 9), 'https://img/1.png'),
      shot('b', at(2026, 10, 27, 10), 'https://img/2.png', { body_text: 'Toss too low.\n\nKnees late.' }),
    ],
    'technical',
  );
  const text = blocks.find((b) => b.type === 'text');
  assert.ok(text && text.type === 'text');
  assert.deepEqual(text.paragraphs, ['Toss too low.', 'Knees late.']);
});

test('technical report carries the video once and the measurements', () => {
  const m = { snapshot: 'S1', label: 'Elbow', value: 92.5, unit: '°', timeSec: 1.2 };
  const blocks = deriveBlocks(
    [
      shot('a', at(2026, 10, 27, 9), 'https://img/1.png', { youtube_url: 'https://youtu.be/dQw4w9WgXcQ', metadata: { measurements: [m, { label: 'bad', value: 'x' }] } }),
      shot('b', at(2026, 10, 27, 10), 'https://img/2.png', { youtube_url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ],
    'technical',
  );
  assert.equal(blocks.filter((b) => b.type === 'video').length, 1);
  const video = blocks[0];
  assert.ok(video.type === 'video');
  assert.equal(video.videoId, 'dQw4w9WgXcQ');
  const meas = blocks.find((b) => b.type === 'measurements');
  assert.ok(meas && meas.type === 'measurements');
  assert.equal(meas.rows.length, 1);
  assert.equal(meas.rows[0].label, 'Elbow');
});

test('a non-YouTube link keeps the url with no video id', () => {
  const blocks = deriveBlocks([shot('a', at(2026, 10, 27), 'https://img/1.png', { youtube_url: 'https://example.com/clip' })], 'technical');
  assert.ok(blocks[0].type === 'video');
  assert.equal(blocks[0].videoId, null);
});

test('each match entry is its own report, filed under the day it was played', () => {
  const entries: EntryLike[] = [
    { id: 'm1', category: 'match', folder_label: 'Vin vs Luca', match_date: '2026-09-30', opponent_name: 'Luca', body_text: 'Summary', created_at: at(2026, 10, 2) },
    { id: 'm2', category: 'match', folder_label: 'Vin vs Ana', created_at: at(2026, 10, 5) },
  ];
  const reports = groupEntriesIntoReports(entries);
  assert.deepEqual(reports.map((r) => r.key), ['m-m2', 'm-m1']);
  assert.equal(reports[1].dateKey, '2026-09-30');
  assert.equal(reports[1].opponent, 'Luca');
  assert.equal(reports[1].title, 'Vin vs Luca');
});

test('decoder entry with stored sections shows them; without, it falls back to the body text', () => {
  const withSections: EntryLike = {
    id: 'd1',
    category: 'match',
    folder_label: 'Decoder',
    body_text: 'Coach summary',
    created_at: at(2026, 10, 2),
    metadata: {
      sections: [
        { heading: '1. Serve', headingLevel: 'h3', lines: ['First serve: 62%', 5, ''], notes: 'Good', imageUrl: 'https://img/chart.png', imageObjectSizePt: { width: 1, height: 1 } },
        { heading: 'Side A', headingLevel: 'h2' },
        'junk',
        {},
      ],
    },
  };
  const old: EntryLike = { id: 'd0', category: 'match', folder_label: 'Old', body_text: 'Line one\n\nLine two', created_at: at(2026, 9, 1), metadata: {} };

  const a = deriveBlocks([withSections], 'match');
  assert.equal(a.length, 1);
  assert.ok(a[0].type === 'sections');
  assert.equal(a[0].sections.length, 2);
  assert.deepEqual(a[0].sections[0].lines, ['First serve: 62%']);
  assert.equal(a[0].sections[0].imageUrl, 'https://img/chart.png');
  assert.equal(a[0].sections[1].headingLevel, 'h2');

  const b = deriveBlocks([old], 'match');
  assert.ok(b[0].type === 'text');
  assert.deepEqual(b[0].paragraphs, ['Line one', 'Line two']);
});

test('manual match metadata (v1 or v2) becomes a manualMatch block; empty points do not', () => {
  const base = { id: 'x', category: 'match', folder_label: 'M', created_at: at(2026, 10, 2), body_text: 'compiled text' };
  const v2 = deriveBlocks([{ ...base, metadata: { manualMatch: { version: 2, playerName: 'A', opponentName: 'B', points: [{}], gameNotes: ['n', 3] } } }], 'match');
  assert.ok(v2[0].type === 'manualMatch');
  assert.deepEqual(v2[0].match.gameNotes, ['n']);
  const v1 = deriveBlocks([{ ...base, metadata: { manualMatch: { points: [{}] } } }], 'match');
  assert.ok(v1[0].type === 'manualMatch');
  assert.equal(v1[0].match.version, 1);
  assert.equal(v1[0].match.playerName, 'Player');
  const empty = deriveBlocks([{ ...base, metadata: { manualMatch: { points: [] } } }], 'match');
  assert.ok(empty[0].type === 'text');
});

test('tolerates missing and malformed fields', () => {
  const weird = [
    { id: '1', category: 'technique', created_at: at(2026, 10, 1), screenshots: null, metadata: null, body_text: null },
    { id: '2', category: 'technique', created_at: at(2026, 10, 1), screenshots: 'not json', metadata: 'str' },
    { id: '3', category: 'technique', created_at: 'garbage', screenshots: [{ url: 'https://img/a.png' }, 4, 'ftp://x', 'data:image/png;base64,AA'] },
    { id: '4', category: 'mystery', created_at: at(2026, 10, 1) },
  ] as unknown as EntryLike[];
  const reports = groupEntriesIntoReports(weird);
  assert.ok(reports.length >= 1);
  assert.ok(reports.every((r) => r.key !== 'm-4' && !r.entryIds.includes('4')));
  assert.deepEqual(readScreenshotUrls('["https://a/1.png"]'), ['https://a/1.png']);
  assert.deepEqual(readScreenshotUrls('https://a/2.png'), ['https://a/2.png']);
  assert.deepEqual(readScreenshotUrls(undefined), []);
  assert.equal(entryDateKey({ category: 'technique', created_at: 'garbage' }), '1970-01-01');
});

test('month groups, newest first, and search / type filters', () => {
  const entries: EntryLike[] = [
    shot('a', at(2026, 10, 27), 'https://img/1.png'),
    { id: 'm', category: 'match', folder_label: 'Vin vs Luca', opponent_name: 'Luca', created_at: at(2026, 10, 3) },
    shot('b', at(2026, 9, 14), 'https://img/2.png', { body_text: 'Backhand slice' }),
  ];
  const reports = groupEntriesIntoReports(entries);
  const months = groupByMonth(reports);
  assert.deepEqual(months.map((g) => g.monthKey), ['2026-10', '2026-09']);
  assert.equal(months[0].reports.length, 2);
  assert.equal(months[0].label, 'October 2026');
  assert.equal(filterReports(reports, 'match', '').length, 1);
  assert.equal(filterReports(reports, 'all', 'slice').length, 1);
  assert.equal(filterReports(reports, 'all', 'luca')[0].kind, 'match');
  assert.equal(filterReports(reports, 'technical', 'luca').length, 0);
});

test('a Supabase player-assets copy becomes the fallback of the Drive image, not an extra image', () => {
  const sb = 'https://x.supabase.co/storage/v1/object/public/player-assets/u1/screenshots/1.png';
  const drive = 'https://drive.google.com/uc?export=view&id=ABCDEFGHIJKL';
  const both = shot('a', at(2026, 10, 27), drive, { screenshots: [drive, sb] });
  const [g] = deriveBlocks([both], 'technical').filter((b) => b.type === 'screenshots');
  assert.ok(g && g.type === 'screenshots');
  assert.equal(g.images.length, 1);
  assert.equal(g.images[0].url, drive);
  assert.equal(g.images[0].fallbackUrl, sb);

  // Supabase-only and Drive-only entries are untouched.
  const sbOnly = deriveBlocks([shot('b', at(2026, 10, 27), sb)], 'technical').find((b) => b.type === 'screenshots');
  assert.ok(sbOnly && sbOnly.type === 'screenshots');
  assert.equal(sbOnly.images[0].fallbackUrl, undefined);
  assert.equal(sbOnly.images.length, 1);
});

test('a decoder entry with a stored decoderReport renders from it; older entries keep their sections/text', async () => {
  const { buildManualReport } = await import('../lib/tennis/manualReportModel');
  const { emptyFormattedBoard } = await import('../lib/tennis/matchFormat');
  // Any SideReport[] has the stored shape; the manual model is a ready source of a real one.
  const reports = buildManualReport({
    playerName: 'A',
    opponentName: 'B',
    points: [
      { winner: 'player', outcome: { kind: 'winner', stroke: 'Forehand' } },
      { winner: 'opponent', outcome: { kind: 'ue', stroke: 'Backhand' } },
    ] as never,
    board: emptyFormattedBoard(),
  });
  const stored = JSON.parse(JSON.stringify({ decoderReport: { version: 1, scope: 'both', reports, integrityWarnings: ['Check 1', 7] } }));
  const entry: EntryLike = { id: 'd1', category: 'match', folder_label: 'Decoder', body_text: 'summary', created_at: at(2026, 10, 2), source: 'match_decoder', metadata: stored };
  const [b] = deriveBlocks([entry], 'match');
  assert.ok(b.type === 'decoderReport');
  assert.equal(b.reports.length, 2);
  assert.deepEqual(b.integrityWarnings, ['Check 1']);
  assert.equal(b.reports[0].sections.length, reports[0].sections.length);
  assert.ok(b.reports[0].sections.some((s) => s.charts.length > 0), 'charts survive');

  // Only a shape check here (a chart is an SVG string); sanitising happens where it is drawn
  // (components/reports/sanitizeSvg.ts, tests/sanitizeSvg.test.ts).
  const odd = JSON.parse(JSON.stringify(stored));
  odd.decoderReport.reports[0].sections[0].charts = ['not svg', 42, '<svg width="1"></svg>'];
  const [e] = deriveBlocks([{ ...entry, metadata: odd }], 'match');
  assert.ok(e.type === 'decoderReport');
  assert.deepEqual(e.reports[0].sections[0].charts, ['<svg width="1"></svg>']);

  // Malformed decoderReport falls back to stored sections, then to text.
  const withSections = { ...entry, metadata: { decoderReport: { reports: 'nope' }, sections: [{ heading: 'Serve', lines: ['x'] }] } };
  assert.ok(deriveBlocks([withSections], 'match')[0].type === 'sections');
  const textOnly = { ...entry, metadata: { decoderReport: {} } };
  assert.ok(deriveBlocks([textOnly], 'match')[0].type === 'text');
});
