/**
 * Turns saved `player_entries` rows into the report the in-app Reports pages show.
 *
 * PURE and TOLERANT. Rows span several eras (screenshots-only technique entries,
 * decoder entries with no stored sections, manual-match metadata v1/v2, rows saved
 * before `metadata` was written at all), so every field is read defensively and a
 * malformed one is dropped rather than thrown on. An old entry must always open.
 *
 * GROUPING (read time, no new storage): every `technique` entry of the same player
 * on the same local calendar day is one "Technical analysis" report, screenshots in
 * the order they were taken. Each `match` entry is its own "Match analysis" report.
 */

import { extractYoutubeVideoId } from '@/lib/youtubeId';
import type { ReportSection, SideReport } from '@/lib/matchAnalysis/reportModel';

export type ReportKind = 'technical' | 'match';

/** The slice of a `player_entries` row this module reads. Everything is optional-ish on purpose. */
export interface EntryLike {
  id: string;
  category?: string | null;
  folder_label?: string | null;
  body_text?: string | null;
  youtube_url?: string | null;
  opponent_name?: string | null;
  match_date?: string | null;
  screenshots?: unknown;
  source?: string | null;
  metadata?: unknown;
  created_at: string;
}

export interface ReportImage {
  url: string;
  entryId: string;
  /** ISO timestamp of the entry the image came from — the order it was taken in. */
  takenAt: string;
  /** A Supabase `player-assets` copy of the same image, shown if `url` (Drive) won't load. */
  fallbackUrl?: string;
}

export interface MeasurementRow {
  snapshot: string;
  label: string;
  value: number;
  unit: string;
  timeSec: number | null;
}

export interface ReportSectionBlock {
  heading?: string;
  headingLevel: 'h2' | 'h3';
  lines: string[];
  notes?: string;
  imageUrl?: string;
}

export type ReportBlock =
  | { type: 'text'; id: string; heading?: string; paragraphs: string[] }
  | { type: 'video'; id: string; url: string; videoId: string | null }
  | { type: 'screenshots'; id: string; images: ReportImage[] }
  | { type: 'measurements'; id: string; rows: MeasurementRow[] }
  | { type: 'sections'; id: string; sections: ReportSectionBlock[] }
  | { type: 'manualMatch'; id: string; match: ManualMatchData }
  | { type: 'decoderReport'; id: string; reports: SideReport[]; integrityWarnings: string[] };

/** What the manual recorder stores under `metadata.manualMatch` (v1 and v2 share these keys). */
export interface ManualMatchData {
  version: number;
  playerName: string;
  opponentName: string;
  matchDate: string | null;
  board: unknown;
  points: unknown[];
  startingScore: unknown;
  finish: unknown;
  gameNotes: string[];
}

export interface Report {
  /** Stable key: `t-<YYYY-MM-DD>` for technical days, `m-<entryId>` for a match. */
  key: string;
  kind: ReportKind;
  /** Local calendar day, YYYY-MM-DD. */
  dateKey: string;
  /** Newest entry in the report — the id the index links to. */
  linkId: string;
  entryIds: string[];
  /** Match: the entry's label. Technical: null (the UI composes "Technical analysis, <date>"). */
  title: string | null;
  opponent: string | null;
  /** Newest created_at, epoch ms — sort key. */
  sortTime: number;
  screenshotCount: number;
  hasVideo: boolean;
  /** First line of text worth previewing in the index, or ''. */
  preview: string;
  /** Match: the plain-text body saved with the entry, for rows whose structured data can't be shown. */
  fallbackText: string;
  /** Lower-cased haystack for the index search box. */
  searchText: string;
  blocks: ReportBlock[];
}

/** The line the analysis app writes on every screenshot-only entry; not worth showing. */
const SCREENSHOT_BOILERPLATE = 'Screenshot from analysis session.';

// ── tolerant readers ───────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

/** `screenshots` has been a string[], an array of `{url}` objects and a JSON string over time. */
export function readScreenshotUrls(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return isHttpUrl(value) ? [(value as string).trim()] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const url = typeof item === 'string' ? item : str(asRecord(item)?.url);
    if (isHttpUrl(url)) out.push(url.trim());
  }
  return out;
}

const isSupabaseAsset = (url: string) => /\/storage\/v1\/object\/public\/player-assets\//.test(url);

/**
 * An entry's images. When one entry lists both Drive URLs and Supabase
 * `player-assets` URLs for the same screenshots, the Supabase ones are not shown
 * as extra images: each becomes the `fallbackUrl` of the Drive image in the same
 * position. (Nothing copies images between the two; this only reads what is stored.)
 */
export function entryImages(e: EntryLike): ReportImage[] {
  const urls = readScreenshotUrls(e.screenshots);
  const supabase = urls.filter(isSupabaseAsset);
  const other = urls.filter((u) => !isSupabaseAsset(u));
  if (other.length === 0 || supabase.length === 0) {
    return urls.map((url) => ({ url, entryId: e.id, takenAt: e.created_at }));
  }
  const images: ReportImage[] = other.map((url, i) => ({
    url,
    entryId: e.id,
    takenAt: e.created_at,
    ...(supabase[i] ? { fallbackUrl: supabase[i] } : {}),
  }));
  // Supabase URLs beyond the Drive ones are images in their own right.
  for (const url of supabase.slice(other.length)) images.push({ url, entryId: e.id, takenAt: e.created_at });
  return images;
}

function readMeasurements(metadata: Record<string, unknown> | null): MeasurementRow[] {
  const list = metadata?.measurements;
  if (!Array.isArray(list)) return [];
  const rows: MeasurementRow[] = [];
  for (const item of list) {
    const m = asRecord(item);
    if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value) || !str(m.label)) continue;
    rows.push({
      snapshot: str(m.snapshot),
      label: str(m.label),
      value: m.value,
      unit: str(m.unit),
      timeSec: typeof m.timeSec === 'number' && Number.isFinite(m.timeSec) ? m.timeSec : null,
    });
  }
  return rows;
}

function readSections(metadata: Record<string, unknown> | null): ReportSectionBlock[] {
  const list = metadata?.sections;
  if (!Array.isArray(list)) return [];
  const out: ReportSectionBlock[] = [];
  for (const item of list) {
    const s = asRecord(item);
    if (!s) continue;
    const lines = Array.isArray(s.lines) ? s.lines.filter((l): l is string => typeof l === 'string' && l.trim() !== '') : [];
    const heading = str(s.heading).trim();
    const notes = str(s.notes).trim();
    const imageUrl = isHttpUrl(s.imageUrl) ? s.imageUrl.trim() : '';
    if (!heading && !lines.length && !notes && !imageUrl) continue;
    out.push({
      ...(heading ? { heading } : {}),
      headingLevel: s.headingLevel === 'h2' ? 'h2' : 'h3',
      lines,
      ...(notes ? { notes } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  return out;
}

function readManualMatch(metadata: Record<string, unknown> | null): ManualMatchData | null {
  const m = asRecord(metadata?.manualMatch);
  if (!m || !Array.isArray(m.points) || m.points.length === 0) return null;
  return {
    version: typeof m.version === 'number' ? m.version : 1,
    playerName: str(m.playerName) || 'Player',
    opponentName: str(m.opponentName) || 'Opponent',
    matchDate: str(m.matchDate) || null,
    board: m.board ?? undefined,
    points: m.points,
    startingScore: m.startingScore ?? undefined,
    finish: m.finish ?? undefined,
    gameNotes: Array.isArray(m.gameNotes) ? m.gameNotes.filter((n): n is string => typeof n === 'string') : [],
  };
}

/** A chart is inline SVG markup we generated; refuse anything that is not plain SVG. */
function safeChart(svg: unknown): svg is string {
  return typeof svg === 'string' && /^\s*<svg[\s>]/i.test(svg) && !/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(svg);
}

/**
 * The decoder's full structured report, as stored in `metadata.decoderReport` at
 * save time: the same `SideReport[]` the live decoder renders, so a saved decoder
 * report renders through the very component the manual match uses. Anything that
 * does not look like it is dropped (and the entry falls back to `sections` / text).
 */
function readDecoderReport(metadata: Record<string, unknown> | null): { reports: SideReport[]; integrityWarnings: string[] } | null {
  const d = asRecord(metadata?.decoderReport);
  if (!d || !Array.isArray(d.reports)) return null;
  const reports: SideReport[] = [];
  for (const r of d.reports) {
    const rec = asRecord(r);
    if (!rec || (rec.sideId !== 'A' && rec.sideId !== 'B') || !Array.isArray(rec.sections)) continue;
    const sections: ReportSection[] = [];
    for (const s of rec.sections) {
      const sec = asRecord(s);
      if (!sec || typeof sec.heading !== 'string' || !Array.isArray(sec.rows)) continue;
      sections.push({
        id: str(sec.id) || `s${sections.length + 1}`,
        number: typeof sec.number === 'number' ? sec.number : sections.length + 1,
        heading: sec.heading,
        explanation: str(sec.explanation),
        rows: sec.rows.filter((row): row is ReportSection['rows'][number] => !!asRecord(row) && typeof asRecord(row)!.label === 'string'),
        charts: Array.isArray(sec.charts) ? sec.charts.filter(safeChart) : [],
        notes: Array.isArray(sec.notes) ? sec.notes.filter((n): n is string => typeof n === 'string') : [],
        present: sec.present !== false,
        ...(typeof sec.coverage === 'string' ? { coverage: sec.coverage } : {}),
      });
    }
    if (sections.length) reports.push({ sideId: rec.sideId, label: str(rec.label) || `Side ${rec.sideId}`, sections });
  }
  if (!reports.length) return null;
  return {
    reports,
    integrityWarnings: Array.isArray(d.integrityWarnings) ? d.integrityWarnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ── dates ──────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A match is filed under the day it was played when the entry says so, else the day it was saved. */
export function entryDateKey(e: Pick<EntryLike, 'category' | 'match_date' | 'created_at'>): string {
  if (e.category === 'match') {
    const md = str(e.match_date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(md)) return md;
  }
  const d = new Date(e.created_at);
  return Number.isNaN(d.getTime()) ? '1970-01-01' : localDateKey(d);
}

function time(e: EntryLike): number {
  const t = new Date(e.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// ── blocks ─────────────────────────────────────────────────────────────────

function videoBlocks(entries: EntryLike[]): ReportBlock[] {
  const seen = new Set<string>();
  const out: ReportBlock[] = [];
  for (const e of entries) {
    const url = str(e.youtube_url).trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ type: 'video', id: `video-${e.id}`, url, videoId: extractYoutubeVideoId(url) });
  }
  return out;
}

function technicalBlocks(entries: EntryLike[]): ReportBlock[] {
  const blocks: ReportBlock[] = [...videoBlocks(entries)];

  const notes: string[] = [];
  for (const e of entries) {
    const text = str(e.body_text).trim();
    if (text && text !== SCREENSHOT_BOILERPLATE) notes.push(...paragraphs(text));
  }
  if (notes.length) blocks.push({ type: 'text', id: 'notes', heading: 'Notes', paragraphs: notes });

  const images: ReportImage[] = entries.flatMap((e) => entryImages(e));
  if (images.length) blocks.push({ type: 'screenshots', id: 'screenshots', images });

  const rows = entries.flatMap((e) => readMeasurements(asRecord(e.metadata)));
  if (rows.length) blocks.push({ type: 'measurements', id: 'measurements', rows });

  return blocks;
}

function matchBlocks(e: EntryLike): ReportBlock[] {
  const metadata = asRecord(e.metadata);
  const blocks: ReportBlock[] = [...videoBlocks([e])];

  const manual = readManualMatch(metadata);
  const decoder = manual ? null : readDecoderReport(metadata);
  const sections = readSections(metadata);

  if (manual) {
    blocks.push({ type: 'manualMatch', id: 'manual-match', match: manual });
  } else if (decoder) {
    blocks.push({ type: 'decoderReport', id: 'decoder-report', reports: decoder.reports, integrityWarnings: decoder.integrityWarnings });
  } else if (sections.length) {
    blocks.push({ type: 'sections', id: 'sections', sections });
  } else {
    // Rows saved before sections were stored: the plain-text body is all there is.
    const text = str(e.body_text).trim();
    if (text) blocks.push({ type: 'text', id: 'body', paragraphs: paragraphs(text) });
  }

  const images = entryImages(e);
  if (images.length) blocks.push({ type: 'screenshots', id: 'screenshots', images });

  const rows = readMeasurements(metadata);
  if (rows.length) blocks.push({ type: 'measurements', id: 'measurements', rows });

  return blocks;
}

/** The blocks for one report, from its entries (oldest first for technical days). */
export function deriveBlocks(entries: EntryLike[], kind: ReportKind): ReportBlock[] {
  const ordered = [...entries].sort((a, b) => time(a) - time(b));
  if (kind === 'technical') return technicalBlocks(ordered);
  return ordered.flatMap((e) => matchBlocks(e));
}

// ── reports ────────────────────────────────────────────────────────────────

function buildReport(kind: ReportKind, key: string, dateKey: string, entries: EntryLike[]): Report {
  const ordered = [...entries].sort((a, b) => time(a) - time(b));
  const newest = ordered[ordered.length - 1];
  const blocks = deriveBlocks(ordered, kind);
  const first = kind === 'match' ? ordered[0] : null;
  const title = first ? str(first.folder_label).trim() || null : null;
  const opponent = first ? str(first.opponent_name).trim() || null : null;

  const screenshotCount = blocks.reduce((n, b) => (b.type === 'screenshots' ? n + b.images.length : n), 0);
  const textBlock = blocks.find((b): b is Extract<ReportBlock, { type: 'text' }> => b.type === 'text');
  const preview = textBlock?.paragraphs[0]?.slice(0, 140) ?? '';

  return {
    key,
    kind,
    dateKey,
    linkId: newest.id,
    entryIds: ordered.map((e) => e.id),
    title,
    opponent,
    sortTime: time(newest),
    screenshotCount,
    hasVideo: blocks.some((b) => b.type === 'video'),
    preview,
    fallbackText: first ? str(first.body_text).trim() : '',
    searchText: [title, opponent, dateKey, kind === 'technical' ? 'technical analysis' : 'match analysis', ...ordered.map((e) => str(e.body_text))]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    blocks,
  };
}

/** Group a player's entries into reports, newest day first. Entries with an unknown category are skipped. */
export function groupEntriesIntoReports(entries: EntryLike[]): Report[] {
  const technical = new Map<string, EntryLike[]>();
  const reports: Report[] = [];

  for (const e of entries) {
    if (!e || typeof e.id !== 'string') continue;
    if (e.category === 'technique') {
      const dk = entryDateKey(e);
      technical.set(dk, [...(technical.get(dk) ?? []), e]);
    } else if (e.category === 'match') {
      reports.push(buildReport('match', `m-${e.id}`, entryDateKey(e), [e]));
    }
  }
  for (const [dk, list] of technical) reports.push(buildReport('technical', `t-${dk}`, dk, list));

  // Day first (a match is filed under the day it was played), then newest save.
  return reports.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.sortTime - a.sortTime);
}

/** The report containing `entryId` (a technical day contains several entries). */
export function findReportForEntry(reports: Report[], entryId: string): Report | null {
  return reports.find((r) => r.entryIds.includes(entryId)) ?? null;
}

export interface MonthGroup {
  /** YYYY-MM */
  monthKey: string;
  /** "October 2026" */
  label: string;
  reports: Report[];
}

/** Month groups in the order the reports arrive (callers pass them newest first). */
export function groupByMonth(reports: Report[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const r of reports) {
    const monthKey = r.dateKey.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.monthKey !== monthKey) {
      const [y, m] = monthKey.split('-').map(Number);
      const label = new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      g = { monthKey, label, reports: [] };
      groups.push(g);
    }
    g.reports.push(r);
  }
  return groups;
}

export function filterReports(reports: Report[], kind: ReportKind | 'all', query: string): Report[] {
  const q = query.trim().toLowerCase();
  return reports.filter((r) => (kind === 'all' || r.kind === kind) && (!q || r.searchText.includes(q)));
}
