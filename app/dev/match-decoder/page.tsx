'use client';

/**
 * PHASE 1 VALIDATION + CALIBRATION HARNESS — no-AI Match Decoder.
 *
 * Two jobs, deliberately combined on one page:
 *   1. Run the real pipeline (classify → extract player_stats) over uploaded
 *      screenshots and show every extracted value NEXT TO the crop it came
 *      from, so it can be checked by eye against the source image.
 *   2. Let the SECTION BANDS in lib/matchDecoder/regionMaps.ts be tuned live.
 *      Overall/Serves are calibrated against a real screenshot; Returns'
 *      row offsets are extrapolated (not independently measured); Groundstrokes
 *      is a placeholder on a different, uncalibrated screenshot. Edit a
 *      section's search-band rect, hit Scan, and see exactly which token got
 *      picked for each field and why — this page does not write files, so
 *      copy corrected numbers back into regionMaps.ts once they're right.
 *
 * Isolated: no app state, no session, no player data. Dev only — middleware.ts
 * only serves /dev/* when NODE_ENV !== 'production'.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeScreenshotsPhase1 } from '@/lib/matchDecoder/decodeScreenshots';
import { recognizeBand, recognizeRegion, type OcrToken } from '@/lib/matchDecoder/ocr';
import { anchorTitleY, pairLabelsWithPercents, pickField } from '@/lib/matchDecoder/extractPlayerStats';
import { preloadTesseract, disposeTesseractWorker } from '@/lib/matchDecoder/tesseractWorker';
import { getTrace, type RawOcrShape, type SectionTrace } from '@/lib/matchDecoder/debugTrace';
import { DISTRIBUTION_SPECS, HEADER_REGION, STAT_SECTIONS } from '@/lib/matchDecoder/regionMaps';
import { vocabularySummary } from '@/lib/matchDecoder/outcomeVocabulary';
import { attributePoints } from '@/lib/matchAnalysis/attribution';
import type { PointAttribution } from '@/lib/matchAnalysis/types';
import type {
  ClassifiedScreenshot,
  CropRectFraction,
  DistributionSpec,
  Extracted,
  PlayerStatBlock,
  SectionSpec,
  StitchedTimeline,
  TimelineGame,
  TimelinePoint,
  TimelineScreenshotResult,
} from '@/lib/matchDecoder/types';

interface LoadedImage {
  file: File;
  bitmap: ImageBitmap;
  objectUrl: string;
}

interface FieldPick {
  key: string;
  label: string;
  value: number | null;
  rawText: string | null;
  confidence: number | null;
}

interface SectionCalibState {
  spec: SectionSpec;
  rect: CropRectFraction;
  anchor: { y: number; matched: boolean } | null;
  tokens: OcrToken[];
  picks: FieldPick[];
}

interface SimpleCalibState {
  key: 'header';
  label: string;
  rect: CropRectFraction;
  rawText: string | null;
  confidence: number | null;
}

interface DistCalibState {
  spec: DistributionSpec;
  rect: CropRectFraction;
  pairs: Array<{ label: string; percent: number; rawText: string; confidence: number }>;
  tokens: OcrToken[];
  scanned: boolean;
}

function initSections(): SectionCalibState[] {
  return STAT_SECTIONS.map((spec) => ({
    spec,
    rect: { x: 0, y: Math.max(0, spec.fallbackTitleY - spec.bandAbove), w: 1, h: spec.bandAbove + spec.bandBelow },
    anchor: null,
    tokens: [],
    picks: spec.fields.map((f) => ({ key: f.key, label: f.label, value: null, rawText: null, confidence: null })),
  }));
}

function initSimple(): SimpleCalibState[] {
  return [{ key: 'header', label: 'Player name header', rect: { ...HEADER_REGION }, rawText: null, confidence: null }];
}

function initDists(): DistCalibState[] {
  return DISTRIBUTION_SPECS.map((spec) => ({
    spec,
    rect: { x: 0, y: Math.max(0, spec.fallbackTitleY - spec.bandAbove), w: 1, h: spec.bandAbove + spec.bandBelow },
    pairs: [], tokens: [], scanned: false,
  }));
}

const CANVAS_W = 420;
const SECTION_COLORS = ['#FF3B30', '#007AFF', '#34C759', '#AF52DE'];

export default function MatchDecoderDevPage() {
  const [loaded, setLoaded] = useState<LoadedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [classified, setClassified] = useState<ClassifiedScreenshot[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStatBlock[]>([]);
  const [timeline, setTimeline] = useState<TimelineScreenshotResult[]>([]);
  const [stitched, setStitched] = useState<StitchedTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  // TEMP-DEBUG-MATCHDECODER — captured after each run so it can be screenshotted.
  const [trace, setTrace] = useState<{ rawShapes: RawOcrShape[]; sectionTraces: SectionTrace[] }>({ rawShapes: [], sectionTraces: [] });

  const [calibrateIndex, setCalibrateIndex] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionCalibState[]>(() => initSections());
  const [simple, setSimple] = useState<SimpleCalibState[]>(() => initSimple());
  const [dists, setDists] = useState<DistCalibState[]>(() => initDists());
  const [regionBusy, setRegionBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<LoadedImage[]>([]);
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);

  useEffect(() => {
    preloadTesseract();
    return () => { void disposeTesseractWorker(); };
  }, []);

  /**
   * Decode every picked file, then run the pipeline immediately.
   *
   * `Promise.allSettled`, not a manual counter: the previous version decremented
   * a `pending` count inside `.then()` only, so a single `createImageBitmap`
   * rejection (an unsupported format, a corrupt file) left the counter stuck
   * above zero — `setLoaded` never fired, no thumbnail appeared, and the Run
   * button stayed disabled with no error anywhere. A failure is now reported
   * per file and the surviving files still load.
   */
  const onFiles = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const results = await Promise.allSettled(
      Array.from(list).map(async (file) => ({
        file,
        bitmap: await createImageBitmap(file),
        objectUrl: URL.createObjectURL(file),
      })),
    );
    const ok: LoadedImage[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push(r.value);
      else failed.push(Array.from(list)[i]?.name ?? `file ${i}`);
    });
    if (failed.length) {
      setError(`Could not decode ${failed.length} file(s): ${failed.join(', ')}. Unsupported image format?`);
    }
    if (!ok.length) return;
    const merged = [...loadedRef.current, ...ok].sort((a, b) => a.file.name.localeCompare(b.file.name));
    setLoaded(merged);
    // Auto-run: the page previously required a separate "Run pipeline" click
    // after upload, which is indistinguishable from "it ran and produced
    // nothing" if you don't know to click it.
    void runPipelineFor(merged);
  }, []);

  const runPipelineFor = useCallback(async (images: LoadedImage[]) => {
    if (!images.length) return;
    setBusy(true);
    setClassified([]);
    setPlayerStats([]);
    setTimeline([]);
    setStitched(null);
    try {
      const result = await decodeScreenshotsPhase1(
        images.map((l) => l.file),
        (done, total, label) => setProgressLabel(`${label} (${done}/${total})`),
      );
      setClassified(result.classified);
      setPlayerStats(result.playerStats);
      setTimeline(result.timeline);
      setStitched(result.stitchedTimeline);
      setTrace(getTrace());
      const firstStats = result.classified.find((c) => c.type === 'player_stats');
      if (firstStats) setCalibrateIndex(firstStats.index);
    } catch (e) {
      // Surface the real message + stack, not a generic label — a swallowed
      // mid-pipeline error is exactly the "ran but nothing appeared" symptom.
      console.error('[match-decoder] pipeline failed:', e);
      setError(e instanceof Error ? `${e.message}` : 'Pipeline failed');
    } finally {
      setBusy(false);
      setProgressLabel('');
    }
  }, []);

  // ── Region calibration ────────────────────────────────────────────────
  const calibrateImage = calibrateIndex !== null ? loaded[calibrateIndex] : null;

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !calibrateImage) return;
    const { bitmap } = calibrateImage;
    const scale = CANVAS_W / bitmap.width;
    canvas.width = CANVAS_W;
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    for (const s of simple) {
      ctx.strokeRect(s.rect.x * canvas.width, s.rect.y * canvas.height, s.rect.w * canvas.width, s.rect.h * canvas.height);
    }
    ctx.strokeStyle = '#FF9500';
    ctx.lineWidth = 1.5;
    for (const d of dists) {
      ctx.strokeRect(d.rect.x * canvas.width, d.rect.y * canvas.height, d.rect.w * canvas.width, d.rect.h * canvas.height);
    }
    sections.forEach((s, i) => {
      ctx.strokeStyle = SECTION_COLORS[i % SECTION_COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.rect.x * canvas.width, s.rect.y * canvas.height, s.rect.w * canvas.width, s.rect.h * canvas.height);
      // Anchor line: where the title token was actually found (or the fallback).
      if (s.anchor) {
        ctx.strokeStyle = s.anchor.matched ? SECTION_COLORS[i % SECTION_COLORS.length] : 'rgba(0,0,0,0.3)';
        ctx.setLineDash(s.anchor.matched ? [] : [4, 3]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, s.anchor.y * canvas.height);
        ctx.lineTo(canvas.width, s.anchor.y * canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }, [calibrateImage, sections, simple, dists]);

  useEffect(() => { redrawOverlay(); }, [redrawOverlay]);

  const updateSectionRect = useCallback((idx: number, patch: Partial<CropRectFraction>) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, rect: { ...s.rect, ...patch } } : s)));
  }, []);
  const updateSimpleRect = useCallback((idx: number, patch: Partial<CropRectFraction>) => {
    setSimple((prev) => prev.map((s, i) => (i === idx ? { ...s, rect: { ...s.rect, ...patch } } : s)));
  }, []);
  const updateDistRect = useCallback((idx: number, patch: Partial<CropRectFraction>) => {
    setDists((prev) => prev.map((d, i) => (i === idx ? { ...d, rect: { ...d.rect, ...patch } } : d)));
  }, []);

  const scanSection = useCallback(async (idx: number) => {
    if (!calibrateImage) return;
    setRegionBusy(true);
    try {
      const s = sections[idx];
      const band = await recognizeBand(calibrateImage.bitmap, s.rect, calibrateIndex ?? 0);
      const anchor = anchorTitleY(s.spec, band.tokens);
      const picks: FieldPick[] = s.spec.fields.map((f) => {
        const p = pickField(band.tokens, anchor.y, f, calibrateIndex ?? 0);
        return { key: f.key, label: f.label, value: p?.value ?? null, rawText: p?.source.rawText ?? null, confidence: p?.source.confidence ?? null };
      });
      setSections((prev) => prev.map((x, i) => (i === idx ? { ...x, anchor, tokens: band.tokens, picks } : x)));
    } finally {
      setRegionBusy(false);
    }
  }, [calibrateImage, calibrateIndex, sections]);

  const scanSimple = useCallback(async (idx: number) => {
    if (!calibrateImage) return;
    setRegionBusy(true);
    try {
      const s = simple[idx];
      const read = await recognizeRegion(calibrateImage.bitmap, s.rect, calibrateIndex ?? 0);
      setSimple((prev) => prev.map((x, i) => (i === idx ? { ...x, rawText: read.rawText, confidence: read.confidence } : x)));
    } finally {
      setRegionBusy(false);
    }
  }, [calibrateImage, calibrateIndex, simple]);

  const scanDist = useCallback(async (idx: number) => {
    if (!calibrateImage) return;
    setRegionBusy(true);
    try {
      const d = dists[idx];
      const band = await recognizeBand(calibrateImage.bitmap, d.rect, calibrateIndex ?? 0);
      // Production pairing logic, not a re-implementation — so what this shows
      // is exactly what the pipeline will extract.
      const paired = pairLabelsWithPercents(
        d.spec, band.tokens, calibrateImage.bitmap.width, calibrateImage.bitmap.height, calibrateIndex ?? 0,
      );
      const pairs = paired.map((pr) => ({
        label: pr.label.value,
        percent: pr.percent.value,
        rawText: pr.percent.source.rawText,
        confidence: pr.percent.source.confidence,
      }));
      setDists((prev) => prev.map((x, i) => (i === idx ? { ...x, pairs, tokens: band.tokens, scanned: true } : x)));
    } finally {
      setRegionBusy(false);
    }
  }, [calibrateImage, calibrateIndex, dists]);

  const scanAll = useCallback(async () => {
    for (let i = 0; i < sections.length; i++) await scanSection(i); // eslint-disable-line no-await-in-loop
    for (let i = 0; i < simple.length; i++) await scanSimple(i); // eslint-disable-line no-await-in-loop
    for (let i = 0; i < dists.length; i++) await scanDist(i); // eslint-disable-line no-await-in-loop
  }, [sections.length, simple.length, dists.length, scanSection, scanSimple, scanDist]);

  const playerStatsScreenshots = useMemo(
    () => classified.filter((c) => c.type === 'player_stats'),
    [classified],
  );

  /**
   * The REAL score-delta attribution, run with NO match setup.
   *
   * Passing no setup deliberately exercises stage 1 only — the server-relative
   * half, which needs no player names. That is exactly what can be checked
   * against the screenshots while the name OCR ("WF IF" / "Seg Arthur") is still
   * a known-open issue, and it is the half that was never being run here at all.
   *
   * Keyed by point IDENTITY: `attributePoints` walks the very same point objects
   * held in `stitched.games`, so object identity is a safe key and needs no
   * synthetic ids.
   */
  const attributionByPoint = useMemo(() => {
    const map = new Map<TimelinePoint, PointAttribution>();
    if (!stitched) return { map, integrityWarnings: [] as string[], attributed: 0, total: 0 };
    const { attributions, integrityWarnings } = attributePoints(stitched);
    for (const a of attributions) map.set(a.point, a);
    return {
      map,
      integrityWarnings,
      attributed: attributions.filter((a) => a.winnerRelative).length,
      total: attributions.length,
    };
  }, [stitched]);

  return (
    // globals.css sets `body { overflow: hidden; height: 100dvh }` — the analysis
    // app is a fixed-viewport surface, so NOTHING below the fold is reachable
    // unless a page owns its own scroll container. Real pages get one from
    // WorkspaceChrome's <main overflowY:auto>; this dev page had none, so the
    // extracted-stats panels rendered correctly but sat permanently off-screen.
    // Same pattern, applied locally — globals.css is left alone.
    // `position:fixed; inset:0` rather than `height:100dvh` — it pins to the
    // viewport directly instead of inheriting a body box that globals.css has
    // already constrained, so the scroller can't collapse to zero height.
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 120px', fontFamily: 'ui-monospace, monospace', color: '#1A1A1A' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Match Decoder — Phase 1 + 2 harness</h1>
      <p style={{ fontSize: 12, color: '#6E6E73', marginBottom: 8, maxWidth: 780 }}>
        <b>Phase 1 — player stats.</b> Section-band + title-anchored positional picking. Each stat section is ONE
        crop (the colored band below), read as word tokens; the section&apos;s own title anchors where its value rows
        are, and each field is picked by column (left/right) + offset below the title. The dashed line is the fixed
        fallback position (used only when the title token isn&apos;t found); a solid line means the title was
        actually located in this scan.
      </p>
      <p style={{ fontSize: 12, color: '#6E6E73', marginBottom: 20, maxWidth: 780 }}>
        <b>Phase 2 — timeline.</b> Tokens are clustered into ROWS by y, then column decides meaning: score at
        x&lt;0.30, dead zone (dots/avatars) 0.30–0.35, outcome at x≥0.35. A row is emitted as a point only if it
        yields a score/&quot;Finish&quot; or an outcome matching the closed vocabulary. Scrolled captures are stitched
        by the game headers&apos; own running score; gaps and contradictions are reported, never filled in.
      </p>

      <div style={{ border: '2px dashed #d6d3d1', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <input type="file" accept="image/*" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <span style={{ marginLeft: 12, fontSize: 12, color: '#6E6E73' }}>
          {loaded.length} loaded{loaded.length ? ' — runs automatically on upload' : ''}
        </span>
        <button
          type="button"
          disabled={busy || !loaded.length}
          onClick={() => void runPipelineFor(loaded)}
          style={{ marginLeft: 16, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1A1A1A', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? progressLabel || 'Working…' : classified.length ? 'Re-run pipeline' : 'Run pipeline'}
        </button>
      </div>

      {error && <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p>}

      {loaded.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {loaded.map((l, i) => {
            const c = classified.find((x) => x.index === i);
            return (
              <div key={l.file.name + i} style={{ width: 96, fontSize: 10 }}>
                <img src={l.objectUrl} alt={l.file.name} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #E5E5E5' }} />
                <div style={{ marginTop: 4, fontWeight: 700 }}>#{i} {c ? c.type : '—'}</div>
                {c && <div style={{ color: '#6E6E73' }}>conf {c.confidence.toFixed(2)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {trace.rawShapes.length > 0 && (
        <details open style={{ marginBottom: 20, border: '2px solid #AF52DE', borderRadius: 10, padding: 12 }}>
          <summary style={{ fontWeight: 800, fontSize: 13, cursor: 'pointer', color: '#AF52DE' }}>
            BROWSER OCR DIAGNOSTICS — screenshot this panel
          </summary>

          {trace.rawShapes.map((r, i) => (
            <div key={i} style={{ marginTop: 10, fontSize: 11, borderTop: i ? '1px solid #EEE' : undefined, paddingTop: i ? 8 : 0 }}>
              <div><b>{r.label}</b> — image {r.imagePx}</div>
              <div>token source: <b style={{ color: r.tokenSource === 'NONE' ? '#b91c1c' : '#34C759' }}>{r.tokenSource}</b>
                {' · '}flat data.words: {String(r.hasFlatWords)} (len {r.flatWordCount})
                {' · '}data.blocks: {String(r.hasBlocks)} ({r.blockCount} blocks, {r.nestedWordCount} nested words)</div>
              <div style={{ color: '#6E6E73' }}>result keys: {r.resultKeys.join(', ') || '(none)'}</div>
              <div style={{ color: '#6E6E73' }}>first word keys: {r.firstWordKeys.join(', ') || '(no words)'} · bbox: {r.bboxSample}</div>
              <div style={{ marginTop: 4 }}>first tokens:</div>
              <table style={{ fontSize: 10, borderCollapse: 'collapse' }}>
                <tbody>
                  {r.sampleTokens.length === 0 && <tr><td style={{ ...td, color: '#b91c1c' }}>NO TOKENS RETURNED</td></tr>}
                  {r.sampleTokens.map((t, j) => (
                    <tr key={j}>
                      <td style={td}>&quot;{t.text}&quot;</td><td style={td}>x={t.xFrac}</td><td style={td}>y={t.yFrac}</td><td style={td}>conf {t.conf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {trace.sectionTraces.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Per-section anchoring</div>
              <table style={{ fontSize: 10, borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E5E5' }}>
                  <th style={th}>#</th><th style={th}>section</th><th style={th}>title found</th><th style={th}>anchor y</th>
                  <th style={th}>band px</th><th style={th}>band tokens</th><th style={th}>frame tokens</th><th style={th}>picked</th>
                </tr></thead>
                <tbody>
                  {trace.sectionTraces.map((t, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F5F5F5' }}>
                      <td style={td}>{t.screenshotIndex}</td>
                      <td style={td}>{t.section}</td>
                      <td style={{ ...td, color: t.titleFound ? '#34C759' : '#b91c1c', fontWeight: 700 }}>{String(t.titleFound)}</td>
                      <td style={td}>{t.anchorY}</td>
                      <td style={td}>{t.bandPx}</td>
                      <td style={{ ...td, color: t.bandTokenCount ? undefined : '#b91c1c' }}>{t.bandTokenCount}</td>
                      <td style={{ ...td, color: t.frameTokenCount ? undefined : '#b91c1c' }}>{t.frameTokenCount}</td>
                      <td style={{ ...td, color: t.picked.length ? '#34C759' : '#b91c1c' }}>{t.picked.join(', ') || 'NONE'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}

      {classified.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#F5F5F7', fontSize: 12 }}>
          <b>{classified.length}</b> screenshots ·{' '}
          {(['player_stats', 'timeline', 'placement_map', 'unrecognized'] as const)
            .map((t) => ({ t, n: classified.filter((c) => c.type === t).length }))
            .filter(({ n }) => n > 0)
            .map(({ t, n }) => `${n} ${t}`)
            .join(' · ')}
          {' · '}<b>{playerStats.length}</b> stat block(s) extracted
          {stitched && (
            <>
              {' · '}<b>{stitched.games.length}</b> stitched game(s),{' '}
              <b>{stitched.games.reduce((n, g) => n + g.points.length, 0)}</b> point(s)
            </>
          )}
        </div>
      )}

      {classified.length > 0 && playerStats.length === 0 && (
        <div style={{ marginBottom: 28, padding: 12, borderRadius: 8, border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)', fontSize: 12 }}>
          <b>No player-stats extraction ran.</b>{' '}
          {classified.every((c) => c.type !== 'player_stats')
            ? 'No screenshot classified as player_stats — open the "full-frame OCR text" column above to see what the classifier actually read. It needs at least one of: a name + "\u2019s Shots", Overall, Serves, Returns, or Groundstrokes.'
            : 'A screenshot classified as player_stats but extraction returned nothing — check the section calibration panel below.'}
        </div>
      )}

      {playerStats.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Extracted player stats</h2>
          {playerStats.map((p) => (
            <PlayerStatCard
              key={p.screenshotIndex}
              block={p}
              fileName={loaded[p.screenshotIndex]?.file.name}
              imageUrl={loaded[p.screenshotIndex]?.objectUrl}
            />
          ))}
        </div>
      )}

      {stitched && stitched.games.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            Stitched match timeline — {stitched.games.length} game(s)
          </h2>
          <p style={{ fontSize: 11, color: '#6E6E73', marginBottom: 8, maxWidth: 820 }}>
            Ordered by <b>games completed</b> (the two numbers in each header summed) — a value read off the
            screen, so the order is deterministic and independent of upload order. Points run <b>chronologically</b>
            (screen order reversed, since SwingVision lists most-recent-first). <b>server</b> comes from the
            header: <i>holds</i> = the named player served and won, <i>breaks</i> = the named player returned
            and won, so the opponent served. Point winner is never inferred from the coloured dots.
          </p>

          <div style={{ fontSize: 11, marginBottom: 10 }}>
            <b>Players resolved:</b>{' '}
            {stitched.resolution.players.length
              ? stitched.resolution.players.join(' vs ')
              : <span style={{ color: '#b91c1c' }}>none readable</span>}
            <span style={{ color: '#6E6E73' }}>
              {' '}— names are a SEPARATE known issue; the attribution below is server-relative and does not depend on them.
            </span>
          </div>

          <div style={{ border: '2px solid #34C759', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: '#2F7D32', marginBottom: 4 }}>
              SCORE-DELTA ATTRIBUTION — {attributionByPoint.attributed}/{attributionByPoint.total} points attributed
              {attributionByPoint.total > 0 &&
                ` (${Math.round((attributionByPoint.attributed / attributionByPoint.total) * 100)}%)`}
            </div>
            <div style={{ fontSize: 10, color: '#6E6E73', lineHeight: 1.5 }}>
              Score rows are the score the point PRODUCED, server&apos;s score first. Diffing consecutive rows gives
              the point winner; the deciding <b>Finish</b> row comes from the header&apos;s holds/breaks. A
              Winner/Ace is hit by the point WINNER, an Unforced Error/Double Fault by the point LOSER. The 0-0
              row is the game-start <b>service marker</b>, not a point — no point can produce 0-0.
            </div>
            {attributionByPoint.integrityWarnings.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {attributionByPoint.integrityWarnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>{w}</div>
                ))}
              </div>
            )}
          </div>

          {stitched.issues.length > 0 && (
            <div style={{ border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                {stitched.issues.length} stitching issue(s) — reported, not resolved
              </div>
              {stitched.issues.map((iss, i) => (
                <div key={i} style={{ fontSize: 10, marginTop: 4 }}>
                  <b>{iss.kind}</b>{' '}
                  <span style={{ color: '#6E6E73' }}>[#{iss.screenshotIndexes.join(', #')}]</span>{' '}
                  {iss.detail}
                </div>
              ))}
            </div>
          )}

          {stitched.games.map((g) => (
            <div key={g.key} style={{ border: '1px solid #E5E5E5', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                {g.header.raw?.value ?? (
                  <span style={{ color: '#FF9500' }}>
                    UNNAMED GAME{g.gamesPlayed !== undefined ? ` — position ${g.gamesPlayed} recovered from neighbours` : ' — position unknown'}
                  </span>
                )}
                <span style={{ color: '#6E6E73', fontWeight: 400 }}>
                  {' '}— {g.gamesPlayed} games played · from screenshot(s) #{g.sourceScreenshots.join(', #')}
                  {g.overlapConfirmedPoints > 0 && ` · ${g.overlapConfirmedPoints} point(s) confirmed by overlap`}
                </span>
              </div>
              {/* The meta line's own point count is printed ON the screenshot, so it
                  is the independent check on whether stitching produced the right
                  number of points. Disagreement is an error, not a preference. */}
              <div style={{ fontSize: 11, marginTop: 3 }}>
                <b>{g.points.length}</b> point(s) stitched
                {g.expectedPointCount !== undefined ? (
                  <>
                    {' '}vs <b>{g.expectedPointCount}</b> on the meta line{' '}
                    {g.pointCountMatchesMeta ? (
                      <span style={{ color: '#2F7D32', fontWeight: 700 }}>✓ match</span>
                    ) : (
                      <span style={{ color: '#b91c1c', fontWeight: 700 }}>✗ MISMATCH — stitching error</span>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#8E8E93' }}> · meta line unreadable, no cross-check available</span>
                )}
                <span style={{ color: '#8E8E93' }}> · {g.mergeStrategy}</span>
              </div>
              {/* What each capture saw ALONE — this is what says whether any single
                  capture could have been used verbatim, or whether a merge was forced. */}
              {g.perCaptureCounts.length > 1 && (
                <div style={{ fontSize: 10, color: '#6E6E73', marginTop: 2 }}>
                  per capture:{' '}
                  {g.perCaptureCounts.map((c, i) => (
                    <span key={c.screenshotIndex}>
                      {i > 0 && ' · '}
                      #{c.screenshotIndex}: <b style={{ color: c.matchesMeta ? '#2F7D32' : '#1A1A1A' }}>{c.points} pts</b>
                      {c.matchesMeta && ' ✓meta'}
                      {c.sawStart && ' ·start'}
                      {c.sawFinish && ' ·finish'}
                    </span>
                  ))}
                </div>
              )}
              {!g.pointsVerifiedAgainstMeta && g.expectedPointCount !== undefined && (
                <div style={{ fontSize: 10, color: '#b91c1c', fontWeight: 700, marginTop: 2 }}>
                  POINTS UNVERIFIED — no single capture matched the meta count and the captures could not be
                  reconciled. Treat this game&apos;s counts as unreliable.
                </div>
              )}
              <div style={{ fontSize: 10, color: '#6E6E73', marginTop: 2 }}>
                server: <b>{g.serverName ?? 'unknown'}</b> · game won by: <b>{g.gameWinnerName ?? 'unknown'}</b>
                {g.header.meta && ` · meta: ${g.header.meta.raw}`}
              </div>
              {g.flags.length > 0 && (
                <div style={{ fontSize: 10, color: '#FF9500', marginTop: 2 }}>flags: {g.flags.join(' · ')}</div>
              )}
              <PointTable points={g.points} serverName={g.serverName} attributions={attributionByPoint.map} />
            </div>
          ))}
        </div>
      )}

      {timeline.length > 0 && (
        <details style={{ marginBottom: 28 }} open={!stitched || stitched.games.length === 0}>
          <summary style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, cursor: 'pointer' }}>
            Per-screenshot timeline extraction ({timeline.length} capture(s)) — expand to verify against each image
          </summary>
          {timeline.map((shot) => (
            <div key={shot.screenshotIndex} style={{ border: '1px solid #E5E5E5', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                #{shot.screenshotIndex} {loaded[shot.screenshotIndex]?.file.name}
                <span style={{ color: '#6E6E73', fontWeight: 400 }}>
                  {' '}— {shot.games.length} game(s), {shot.games.reduce((n, g) => n + g.points.length, 0)} point(s),{' '}
                  {shot.tokenCount} tokens via <b>{shot.tokenSource}</b>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {loaded[shot.screenshotIndex] && (
                  <img
                    src={loaded[shot.screenshotIndex].objectUrl}
                    alt={loaded[shot.screenshotIndex].file.name}
                    style={{ width: 200, borderRadius: 6, border: '1px solid #E5E5E5', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: '1 1 420px' }}>
                  {shot.games.length === 0 && (
                    <div style={{ fontSize: 11, color: '#b91c1c' }}>
                      No game header parsed on this capture — open the row dump below to see what each row read as.
                    </div>
                  )}
                  {shot.games.map((game) => (
                    <GameCard key={`${game.headerRowY}`} game={game} attributions={attributionByPoint.map} />
                  ))}
                  {shot.orphanPoints.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#FF9500' }}>
                        {shot.orphanPoints.length} orphan point(s) — above the first header, server unknown
                      </div>
                      <PointTable points={shot.orphanPoints} attributions={attributionByPoint.map} />
                    </div>
                  )}
                </div>
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 10, color: '#8E8E93', cursor: 'pointer' }}>
                  all {shot.rows.length} rows — y, left (score) / mid (dead zone) / right (outcome), and what each was read as
                </summary>
                <table style={{ fontSize: 9, borderCollapse: 'collapse', width: '100%', marginTop: 4 }}>
                  <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E5E5' }}>
                    <th style={th}>y</th><th style={th}>kind</th><th style={th}>left x&lt;0.30</th>
                    <th style={th}>mid 0.30–0.35</th><th style={th}>right x≥0.35</th><th style={th}>note</th>
                  </tr></thead>
                  <tbody>
                    {shot.rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F5F5F5' }}>
                        <td style={td}>{r.yFrac.toFixed(3)}</td>
                        <td style={{ ...td, fontWeight: 700, color: r.kind === 'skipped' ? '#C7C7CC' : r.kind === 'point' ? '#34C759' : '#007AFF' }}>{r.kind}</td>
                        <td style={td}>{r.leftText || '—'}</td>
                        <td style={{ ...td, color: '#C7C7CC' }}>{r.midText || '—'}</td>
                        <td style={td}>{r.rightText || '—'}</td>
                        <td style={{ ...td, color: '#8E8E93' }}>{r.reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          ))}
        </details>
      )}

      {timeline.length > 0 && (
        <details style={{ marginBottom: 28 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Outcome vocabulary — the closed set a point label must match
          </summary>
          <div style={{ fontSize: 10, color: '#6E6E73', marginTop: 6, maxWidth: 820 }}>
            Labels are matched compositionally: one <b>stroke</b> term and one <b>result</b> term, each found
            literally in the row text (Levenshtein ≤1, or ≤2 for words of 9+ characters — any fuzzy acceptance
            is flagged <code>outcome-ocr-corrected</code>). A row matching neither axis is reported as
            <code> outcome-unrecognized</code> with its raw text, never mapped to the nearest label.
            <div style={{ marginTop: 6 }}><b>Strokes:</b> {vocabularySummary().shots.join(' · ')}</div>
            <div style={{ marginTop: 2 }}><b>Results:</b> {vocabularySummary().results.join(' · ')}</div>
          </div>
        </details>
      )}

      {classified.length > 0 && (
        <details style={{ marginBottom: 28 }} open={playerStats.length === 0 && timeline.length === 0}>
          <summary style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, cursor: 'pointer' }}>
            Classification ({classified.length}) — expand for per-screenshot OCR text
          </summary>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E5E5' }}>
                <th style={th}>#</th><th style={th}>file</th><th style={th}>type</th><th style={th}>confidence</th><th style={th}>matched markers</th><th style={th}>full-frame OCR text</th>
              </tr>
            </thead>
            <tbody>
              {classified.map((c) => (
                <tr key={c.index} style={{ borderBottom: '1px solid #F0F0F0' }}>
                  <td style={td}>{c.index}</td>
                  <td style={td}>{loaded[c.index]?.file.name}</td>
                  <td style={td}><b>{c.type}</b></td>
                  <td style={td}>{c.confidence.toFixed(2)}</td>
                  <td style={{ ...td, color: '#6E6E73' }}>{c.matchedMarkers.join(', ') || '—'}</td>
                  <td style={td}>
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#8E8E93' }}>
                        {c.rawText ? `${c.rawText.length} chars` : 'EMPTY — OCR read nothing'}
                      </summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 9, maxWidth: 420, maxHeight: 200, overflow: 'auto', margin: '4px 0 0' }}>
                        {c.rawText || '(nothing)'}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}


      {playerStatsScreenshots.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Section calibration</h2>
          <div style={{ marginBottom: 10 }}>
            Calibrate against:{' '}
            <select value={calibrateIndex ?? ''} onChange={(e) => setCalibrateIndex(Number(e.target.value))} style={{ fontSize: 12 }}>
              {playerStatsScreenshots.map((c) => (
                <option key={c.index} value={c.index}>#{c.index} {loaded[c.index]?.file.name}</option>
              ))}
            </select>
            <button type="button" disabled={regionBusy} onClick={() => void scanAll()} style={{ marginLeft: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #E5E5E5', cursor: regionBusy ? 'wait' : 'pointer', fontSize: 11 }}>
              {regionBusy ? 'Scanning…' : 'Scan all'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <canvas ref={canvasRef} style={{ border: '1px solid #E5E5E5', borderRadius: 6, flexShrink: 0 }} />

            <div style={{ flex: '1 1 560px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sections.map((s, i) => (
                <div key={s.spec.title} style={{ border: `1px solid ${SECTION_COLORS[i % SECTION_COLORS.length]}55`, borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: SECTION_COLORS[i % SECTION_COLORS.length], display: 'inline-block' }} />
                    <b style={{ fontSize: 12 }}>{s.spec.title}</b>
                    {(['x', 'y', 'w', 'h'] as const).map((axis) => (
                      <span key={axis} style={{ fontSize: 10 }}>
                        {axis}=<input type="number" step={0.005} value={s.rect[axis]} onChange={(e) => updateSectionRect(i, { [axis]: Number(e.target.value) })} style={{ width: 46, fontSize: 10 }} />
                      </span>
                    ))}
                    <button type="button" disabled={regionBusy} onClick={() => void scanSection(i)} style={{ fontSize: 10, padding: '2px 8px', cursor: regionBusy ? 'wait' : 'pointer' }}>scan</button>
                    {s.anchor && (
                      <span style={{ fontSize: 10, color: s.anchor.matched ? '#34C759' : '#FF9500' }}>
                        {s.anchor.matched ? `title found @ y=${s.anchor.y.toFixed(3)}` : `title NOT found — using fallback y=${s.anchor.y.toFixed(3)}`}
                      </span>
                    )}
                  </div>
                  <table style={{ fontSize: 10, borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {s.picks.map((p) => (
                        <tr key={p.key} style={{ borderBottom: '1px solid #F5F5F5' }}>
                          <td style={{ ...td, color: '#6E6E73' }}>{p.label}</td>
                          <td style={td}>{p.value ?? <span style={{ color: '#C7C7CC' }}>none</span>}</td>
                          <td style={{ ...td, color: '#8E8E93' }}>{p.rawText ? `"${p.rawText}" conf ${p.confidence?.toFixed(0)}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.tokens.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 9, color: '#8E8E93', cursor: 'pointer' }}>all {s.tokens.length} tokens in this band</summary>
                      <div style={{ fontSize: 9, color: '#8E8E93', maxHeight: 100, overflow: 'auto', marginTop: 4 }}>
                        {s.tokens.map((t, ti) => (
                          <div key={ti}>x={t.xFrac.toFixed(3)} y={t.yFrac.toFixed(3)} conf={t.confidence.toFixed(0)} &quot;{t.text}&quot;</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}

              {dists.map((d, i) => (
                <div key={d.spec.key} style={{ border: '1px solid #FF950055', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: '#FF9500', display: 'inline-block' }} />
                    <b style={{ fontSize: 12 }}>{d.spec.title}</b>
                    {(['x', 'y', 'w', 'h'] as const).map((axis) => (
                      <span key={axis} style={{ fontSize: 10 }}>
                        {axis}=<input type="number" step={0.005} value={d.rect[axis]} onChange={(e) => updateDistRect(i, { [axis]: Number(e.target.value) })} style={{ width: 46, fontSize: 10 }} />
                      </span>
                    ))}
                    <button type="button" disabled={regionBusy} onClick={() => void scanDist(i)} style={{ fontSize: 10, padding: '2px 8px', cursor: regionBusy ? 'wait' : 'pointer' }}>scan</button>
                    {d.scanned && (
                      <span style={{ fontSize: 10, color: d.pairs.length ? '#34C759' : '#FF9500' }}>
                        {d.pairs.length ? `${d.pairs.length}/${d.spec.labels.length} slices paired` : 'no label+% pairs found'}
                      </span>
                    )}
                  </div>
                  <table style={{ fontSize: 10, borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {d.spec.labels.map((l) => {
                        const hit = d.pairs.find((pr) => pr.label === l.display);
                        return (
                          <tr key={l.display} style={{ borderBottom: '1px solid #F5F5F5' }}>
                            <td style={{ ...td, color: '#6E6E73' }}>{l.display}</td>
                            <td style={td}>{hit ? `${hit.percent}%` : <span style={{ color: '#C7C7CC' }}>none</span>}</td>
                            <td style={{ ...td, color: '#8E8E93' }}>{hit ? `"${hit.rawText}" conf ${hit.confidence.toFixed(0)}` : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {d.tokens.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 9, color: '#8E8E93', cursor: 'pointer' }}>all {d.tokens.length} tokens in this band</summary>
                      <div style={{ fontSize: 9, color: '#8E8E93', maxHeight: 100, overflow: 'auto', marginTop: 4 }}>
                        {d.tokens.map((t, ti) => (
                          <div key={ti}>x={t.xFrac.toFixed(3)} y={t.yFrac.toFixed(3)} conf={t.confidence.toFixed(0)} &quot;{t.text}&quot;</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}

              {simple.map((s, i) => (
                <div key={s.key} style={{ border: '1px solid #E5E5E5', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <b style={{ fontSize: 12 }}>{s.label}</b>
                    {(['x', 'y', 'w', 'h'] as const).map((axis) => (
                      <span key={axis} style={{ fontSize: 10 }}>
                        {axis}=<input type="number" step={0.005} value={s.rect[axis]} onChange={(e) => updateSimpleRect(i, { [axis]: Number(e.target.value) })} style={{ width: 46, fontSize: 10 }} />
                      </span>
                    ))}
                    <button type="button" disabled={regionBusy} onClick={() => void scanSimple(i)} style={{ fontSize: 10, padding: '2px 8px', cursor: regionBusy ? 'wait' : 'pointer' }}>scan</button>
                  </div>
                  <div style={{ fontSize: 10, color: '#6E6E73' }}>
                    {s.rawText ? `"${s.rawText}" — conf ${s.confidence?.toFixed(0)}` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function PlayerStatCard({ block, fileName, imageUrl }: { block: PlayerStatBlock; fileName?: string; imageUrl?: string }) {
  const row = (label: string, e?: Extracted<number> | Extracted<string>) => (
    <tr>
      <td style={{ ...td, color: '#6E6E73' }}>{label}</td>
      <td style={td}>{e ? String(e.value) : <span style={{ color: '#C7C7CC' }}>not present</span>}</td>
      <td style={{ ...td, fontSize: 9, color: '#8E8E93' }}>{e ? `conf ${e.source.confidence.toFixed(0)} · "${e.source.rawText}"` : ''}</td>
    </tr>
  );
  return (
    <div style={{ border: '1px solid #E5E5E5', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
        #{block.screenshotIndex} {fileName} — player <b>{block.player}</b>
        {block.playerNameRaw && <span style={{ color: '#6E6E73' }}> ({block.playerNameRaw.value})</span>}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt={fileName}
          style={{ width: 200, borderRadius: 6, border: '1px solid #E5E5E5', flexShrink: 0 }}
        />
      )}
      <table style={{ fontSize: 11, borderCollapse: 'collapse', flex: '1 1 380px' }}>
        <tbody>
          {row('shots in %', block.overall?.shotsInPercent)}
          {row('shots/hr', block.overall?.shotsPerHour)}
          {row('longest rally', block.overall?.longestRally)}
          {row('rallies > 5', block.overall?.ralliesOver5)}
          {row('serve % in (ad)', block.serves?.percentInAd)}
          {row('serve % in (deuce)', block.serves?.percentInDeuce)}
          {row('serve speed (ad)', block.serves?.avgSpeedAd)}
          {row('serve speed (deuce)', block.serves?.avgSpeedDeuce)}
          {row('return % in (ad)', block.returns?.percentInAd)}
          {row('return % in (deuce)', block.returns?.percentInDeuce)}
          {row('return speed (ad)', block.returns?.avgSpeedAd)}
          {row('return speed (deuce)', block.returns?.avgSpeedDeuce)}
          {row('FH % in', block.groundstrokes?.forehandPercentIn)}
          {row('FH speed', block.groundstrokes?.forehandAvgSpeed)}
          {row('BH % in', block.groundstrokes?.backhandPercentIn)}
          {row('BH speed', block.groundstrokes?.backhandAvgSpeed)}
        </tbody>
      </table>
      </div>
      {block.shotDistribution.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <b>Shot distribution:</b> {block.shotDistribution.map((s) => `${s.label.value} ${s.percent.value}%`).join(', ')}
        </div>
      )}
      {block.spinDistribution.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 11 }}>
          <b>Spin distribution:</b> {block.spinDistribution.map((s) => `${s.label.value} ${s.percent.value}%`).join(', ')}
        </div>
      )}
    </div>
  );
}

/**
 * One game as read from ONE capture — before stitching, so a per-screenshot read
 * can be checked against that screenshot's own image side by side.
 */
function GameCard({ game, attributions }: { game: TimelineGame; attributions?: Map<TimelinePoint, PointAttribution> }) {
  return (
    <div style={{ border: '1px solid #F0F0F0', borderRadius: 6, padding: 8, marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700 }}>
        {game.header.raw?.value ?? <span style={{ color: '#FF9500' }}>UNNAMED GAME (header did not parse)</span>}
      </div>
      <div style={{ fontSize: 10, color: '#6E6E73' }}>
        parsed: player <b>{game.header.playerRaw ?? '(unreadable)'}</b> · <b>{game.header.outcome ?? '?'}</b> ·{' '}
        score <b>{game.header.gameScoreRaw ?? '?'}</b> · {game.header.gamesPlayed ?? '?'} games played
        {game.header.raw && ` · conf ${game.header.raw.source.confidence.toFixed(0)}`}
      </div>
      <div style={{ fontSize: 10, color: '#6E6E73' }}>
        server: <b>{game.serverName ?? 'unknown'}</b> · won by: <b>{game.gameWinnerName ?? 'unknown'}</b>
        {game.header.meta && (
          <>
            {' · '}meta: {game.header.meta.durationMin ?? '?'} min,{' '}
            {game.header.meta.pointCount ?? '?'} points
            {game.header.meta.breakPointsFaced !== undefined &&
              `, ${game.header.meta.breakPointsSaved}/${game.header.meta.breakPointsFaced} BP`}
          </>
        )}
      </div>
      {(game.flags.length > 0 || game.header.flags.length > 0) && (
        <div style={{ fontSize: 10, color: '#FF9500' }}>
          flags: {[...game.header.flags, ...game.flags].join(' · ')}
        </div>
      )}
      <PointTable points={game.points} serverName={game.serverName} attributions={attributions} />
    </div>
  );
}

/**
 * The points of one game, chronological, with the REAL score-delta attribution.
 *
 * This table used to read `outcome.hitter`, which is the OCR vocabulary's own
 * field and only ever says 'server' or 'unknown' — so every groundstroke showed
 * "unknown" here no matter how well the score-delta attribution worked. It now
 * renders `attributePoints`' output, in SERVER-RELATIVE terms: that half of
 * attribution needs no player names, so it is validatable directly against the
 * screenshots without the name OCR being fixed.
 *
 * `won by` = who took the point (score delta, or the header for the deciding
 * point). `hit by` = whose racket produced the labelled outcome: the point winner
 * for a Winner/Ace, the loser for an Unforced Error/Double Fault.
 */
function PointTable({
  points,
  serverName,
  attributions,
}: {
  points: TimelinePoint[];
  serverName?: string;
  attributions?: Map<TimelinePoint, PointAttribution>;
}) {
  if (!points.length) return <div style={{ fontSize: 10, color: '#C7C7CC', marginTop: 4 }}>no points read</div>;
  const rel = (side?: 'server' | 'returner') =>
    side === 'server' ? (serverName ? `server (${serverName})` : 'server') : side === 'returner' ? 'returner' : null;
  return (
    <table style={{ fontSize: 10, borderCollapse: 'collapse', width: '100%', marginTop: 4 }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E5E5', color: '#8E8E93' }}>
          <th style={th}>#</th><th style={th}>score after</th><th style={th}>outcome</th>
          <th style={th}>won by</th><th style={th}>hit by</th><th style={th}>basis</th>
          <th style={th}>raw / conf</th><th style={th}>flags</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => {
          const a = attributions?.get(p);
          const wonBy = rel(a?.winnerRelative);
          const hitBy = rel(a?.hitterRelative);
          return (
          <tr key={i} style={{ borderBottom: '1px solid #F5F5F5' }}>
            <td style={td}>{i + 1}</td>
            <td style={td}>
              {p.isFinish && <b style={{ color: '#AF52DE' }}>Finish</b>}
              {p.scoreAfter ? <b>{p.scoreAfter.value}</b> : !p.isFinish && <span style={{ color: '#C7C7CC' }}>none</span>}
            </td>
            <td style={td}>
              {p.outcome ? (
                <b>{p.outcome.value.canonical}</b>
              ) : p.unrecognizedOutcomeText ? (
                <span style={{ color: '#b91c1c' }}>unrecognized: &quot;{p.unrecognizedOutcomeText}&quot;</span>
              ) : (
                <span style={{ color: '#C7C7CC' }}>none</span>
              )}
            </td>
            <td style={{ ...td, color: wonBy ? '#34C759' : '#C7C7CC', fontWeight: wonBy ? 700 : 400 }}>
              {wonBy ?? 'unknown'}
            </td>
            <td style={{ ...td, color: hitBy ? '#007AFF' : '#C7C7CC', fontWeight: hitBy ? 700 : 400 }}>
              {hitBy ?? 'unknown'}
            </td>
            <td style={{ ...td, color: '#8E8E93', maxWidth: 150 }}>
              {a?.basis === 'unattributed' ? a?.reason ?? 'unattributed' : a?.basis}
            </td>
            <td style={{ ...td, color: '#8E8E93' }}>
              {p.scoreAfter && `"${p.scoreAfter.source.rawText}" ${p.scoreAfter.source.confidence.toFixed(0)}`}
              {p.outcome && ` | "${p.outcome.source.rawText}" ${p.outcome.source.confidence.toFixed(0)}`}
            </td>
            <td style={{ ...td, color: p.flags.length ? '#FF9500' : undefined }}>{p.flags.join(' · ')}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '4px 6px' };
const td: React.CSSProperties = { padding: '4px 6px' };
