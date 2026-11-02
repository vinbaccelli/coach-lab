import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupEntriesIntoReports, type EntryLike } from '@/lib/reports/deriveBlocks';
import { countImages, imageSources, pdfFilename, reportToPdfItems, reportsToPdfDocument, toPdfText } from '@/lib/reports/pdf/reportPdfModel';
import { parseSvgSize, renderReportsPdf, runPool, type PdfImageLoader, type PdfProgress } from '@/lib/reports/pdf/renderReportPdf';
import { FEATURES } from '@/lib/entitlements';

const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAMABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCtAR06f//Z';
const ok: PdfImageLoader = {
  async loadImage() { return { dataUrl: JPEG, width: 16, height: 12 }; },
  async rasterizeSvg() { return { dataUrl: JPEG, width: 16, height: 12 }; },
};
const read = (p: string) => readFileSync(p, 'utf8');

const shots = (n: number, host = 'https://drive.google.com/uc?export=view&id=') =>
  JSON.stringify(Array.from({ length: n }, (_, i) => `${host}FILE${i}`));

function techEntries(n = 10): EntryLike[] {
  return [
    { id: 'e1', category: 'technique', folder_label: 'Forehand', body_text: 'Open the stance earlier.', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', screenshots: JSON.parse(shots(n)), created_at: '2026-10-05T10:00:00Z', metadata: { measurements: [{ snapshot: 'Snapshot 1', label: 'Knee angle', value: 142.34, unit: '°', timeSec: 1.2 }] } },
  ];
}

test('structure: title, notes, video (not embedded), screenshots in order, measurements', () => {
  const [report] = groupEntriesIntoReports(techEntries(10));
  const pdf = reportToPdfItems(report);
  assert.match(pdf.title, /^Technical analysis, /);
  const kinds = pdf.items.map((i) => i.kind);
  assert.ok(kinds.includes('paragraph'));
  assert.equal(pdf.items.filter((i) => i.kind === 'image').length, 10);
  const video = pdf.items.find((i) => i.kind === 'video');
  assert.ok(video && video.kind === 'video');
  assert.equal(video.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(video.thumbUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  // Order: the video comes before the screenshots, measurements last.
  assert.ok(kinds.indexOf('video') < kinds.indexOf('image'));
  const table = pdf.items.find((i) => i.kind === 'table');
  assert.ok(table && table.kind === 'table' && table.rows[0][0] === 'Knee angle');
  assert.equal(countImages(pdf.items), 11); // 10 screenshots + the video thumbnail
});

test('structure: an unsafe video address is not a link; Drive images list their fallbacks in the page order', () => {
  const [r] = groupEntriesIntoReports([{ id: 'x', category: 'technique', body_text: 'n', youtube_url: 'javascript:alert(1)', screenshots: [], created_at: '2026-10-05T10:00:00Z' }]);
  const v = reportToPdfItems(r).items.find((i) => i.kind === 'video');
  assert.ok(!v || (v.kind === 'video' && v.url === null));
  const srcs = imageSources('https://drive.google.com/uc?export=view&id=ABC123xyz_-', 'https://x.supabase.co/a.png');
  assert.equal(srcs[0], 'https://drive.google.com/uc?export=view&id=ABC123xyz_-');
  assert.equal(srcs[1], 'https://lh3.googleusercontent.com/d/ABC123xyz_-=w1200');
  assert.equal(srcs[2], 'https://x.supabase.co/a.png');
  assert.deepEqual(imageSources('javascript:alert(1)'), []);
});

test('text: characters outside Latin-1 are mapped or marked, never passed through', () => {
  assert.equal(toPdfText('a → b ≥ 3 “x” — ok'), 'a -> b >= 3 "x" - ok');
  assert.equal(toPdfText('Zoë 日本'), 'Zoë ??');
  assert.equal(pdfFilename('Ana / María: reports', 'x'), 'Ana-María-reports.pdf');
  assert.equal(pdfFilename('///', 'fallback'), 'fallback.pdf');
});

test('output: a 10-screenshot report becomes a PDF with a clickable video link and a progress that reaches 100%', async () => {
  const [report] = groupEntriesIntoReports(techEntries(10));
  const doc = reportsToPdfDocument('Ana', [report]);
  const seen: PdfProgress[] = [];
  const res = await renderReportsPdf({ title: doc.reports[0].title, reports: doc.reports }, { loader: ok, onProgress: (p) => seen.push(p) });
  const head = Buffer.from(res.data.slice(0, 5)).toString('latin1');
  assert.equal(head, '%PDF-');
  assert.ok(res.pages >= 1);
  assert.deepEqual(res.images, { ok: 10, failed: 0 }); // screenshots; the video thumbnail is not counted as a screenshot
  const raw = Buffer.from(res.data).toString('latin1');
  assert.ok(raw.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'the video is a link in the file');
  assert.equal(raw.includes('/Subtype /Video'), false);
  const last = seen[seen.length - 1];
  assert.equal(last.done, last.total);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].done >= seen[i - 1].done, 'progress never goes backwards');
});

test('placeholder path: images that cannot be fetched are drawn as "Image unavailable" and the PDF is still finished', async () => {
  const [report] = groupEntriesIntoReports(techEntries(4));
  const doc = reportsToPdfDocument('Ana', [report]);
  let n = 0;
  const flaky: PdfImageLoader = {
    async loadImage(sources) {
      n++;
      return n % 2 === 0 || sources[0].includes('ytimg') ? null : { dataUrl: JPEG, width: 16, height: 12 };
    },
    async rasterizeSvg() { throw new Error('should not matter'); },
  };
  const res = await renderReportsPdf({ title: 't', reports: doc.reports }, { loader: flaky });
  assert.equal(res.images.failed + res.images.ok, 4); // the 4 screenshots
  assert.ok(res.images.failed >= 2);
  assert.ok(res.bytes > 500);
  const allFail: PdfImageLoader = { async loadImage() { return null; }, async rasterizeSvg() { return null; } };
  const res2 = await renderReportsPdf({ title: 't', reports: doc.reports }, { loader: allFail });
  assert.equal(res2.images.ok, 0);
  assert.equal(Buffer.from(res2.data.slice(0, 5)).toString('latin1'), '%PDF-');
});

test('all reports: one PDF with a contents list and internal links, oldest report first', async () => {
  const entries: EntryLike[] = [
    { id: 'a', category: 'technique', body_text: 'second day', screenshots: [], created_at: '2026-10-06T10:00:00Z' },
    { id: 'b', category: 'technique', body_text: 'first day', screenshots: [], created_at: '2026-10-05T10:00:00Z' },
    { id: 'c', category: 'technique', body_text: 'third day', screenshots: [], created_at: '2026-10-07T10:00:00Z' },
  ];
  const doc = reportsToPdfDocument('Ana', groupEntriesIntoReports(entries));
  assert.equal(doc.contents.length, 3);
  assert.match(doc.contents[0], /^1\. Technical analysis, .*5/);
  assert.match(doc.contents[2], /^3\. Technical analysis, .*7/);
  const res = await renderReportsPdf({ title: doc.title, contents: doc.contents, reports: doc.reports }, { loader: ok });
  assert.ok(res.pages >= 4, 'a contents page plus one page per report');
  const raw = Buffer.from(res.data).toString('latin1');
  assert.ok(/\/Dest/.test(raw) || /\/D \[/.test(raw) || /\/Subtype \/Link/.test(raw), 'contents entries are links');
});

test('cancel: an aborted export rejects with AbortError instead of finishing', async () => {
  const [report] = groupEntriesIntoReports(techEntries(3));
  const doc = reportsToPdfDocument('Ana', [report]);
  const c = new AbortController();
  c.abort();
  await assert.rejects(renderReportsPdf({ title: 't', reports: doc.reports }, { loader: ok, signal: c.signal }), (e: Error) => e.name === 'AbortError');
});

test('helpers: svg size from width/height or viewBox; the pool never runs more than its limit', async () => {
  assert.deepEqual(parseSvgSize('<svg width="300" height="150" xmlns="x">'), { width: 300, height: 150 });
  assert.deepEqual(parseSvgSize('<svg viewBox="0 0 640 320">'), { width: 640, height: 320 });
  assert.deepEqual(parseSvgSize('<svg>'), { width: 800, height: 400 });
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: 9 }, (_, i) => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return i;
  });
  assert.deepEqual(await Promise.all(runPool(tasks, 3)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(peak <= 3);
});

test('access: the PDF reads only data the page already loaded, adds no endpoint, and sits behind REPORTS_IN_APP and the players entitlement', () => {
  // Light has the player database, so Light can export.
  assert.equal(FEATURES.players.plan, 'light');
  // The data comes from /api/players/[id], which is gated by the same feature.
  assert.match(read('app/api/players/[id]/route.ts'), /requireFeature\([^)]*'players'\)/);
  // No network call and no new route in the PDF code or the button.
  for (const f of ['lib/reports/pdf/reportPdfModel.ts', 'lib/reports/pdf/renderReportPdf.ts', 'components/reports/DownloadPdfButton.tsx']) {
    assert.equal(/\bfetch\(/.test(read(f)), false, f);
  }
  // Both buttons are mounted behind the flag.
  assert.match(read('components/reports/ReportViewClient.tsx'), /REPORTS_IN_APP \? \(\s*<div[^>]*>\s*<DownloadPdfButton label="Download PDF"/);
  assert.match(read('components/players/PlayerProfileClient.tsx'), /REPORTS_IN_APP \? \(\s*<DownloadPdfButton label="Download all reports"/);
});
