'use client';

/**
 * The Match Decoder — the real product flow, replacing the Gemini one.
 *
 * upload → extract (deterministic OCR) → setup → report → save to Docs
 *
 * WHAT CHANGED FROM THE FLOW THIS REPLACES
 * The old client posted the screenshots to Gemini and rendered whatever prose came
 * back. That model invented per-point depth and positioning that was never on
 * screen, because a model asked to write a report will fill gaps plausibly. This
 * flow has no model in it at all: every figure traces to a screenshot region, and
 * anything unreadable is reported as unreadable.
 *
 * The Gemini route (app/api/gemini/decode-match) and its client are left on disk,
 * unreferenced — the flow is swapped, not deleted, so reverting is a one-line
 * import change.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeScreenshotsPhase1 } from '@/lib/matchDecoder/decodeScreenshots';
import { preloadTesseract, disposeTesseractWorker } from '@/lib/matchDecoder/tesseractWorker';
import { computeMatchAnalysis } from '@/lib/matchAnalysis/engine';
import { autoAssignSides, swapAssignment } from '@/lib/matchAnalysis/autoAssign';
import { buildFullReport } from '@/lib/matchAnalysis/reportModel';
import type { MatchSetup, SideId } from '@/lib/matchAnalysis/types';
import type { MatchDecodeResult } from '@/lib/matchDecoder/types';
import { ENABLE_GOOGLE_EXPORTS } from '@/lib/featureFlags';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import MatchSetupPanel from '@/components/decoder/MatchSetupPanel';
import MatchReportView from '@/components/decoder/MatchReportView';
import SaveReportToPlayersModal from '@/components/decoder/SaveReportToPlayersModal';

const MAX_IMAGES = 25;

function emptySetup(): MatchSetup {
  return {
    format: 'singles',
    sides: [
      { id: 'A', playerNames: [''] },
      { id: 'B', playerNames: [''] },
    ],
    serverSideByGameKey: {},
    clusterToSide: {},
    statsScreenshotToSide: {},
    swapSides: false,
  };
}

export default function MatchDecoderClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<MatchDecodeResult | null>(null);
  const [setup, setSetup] = useState<MatchSetup>(emptySetup);
  const [saveOpen, setSaveOpen] = useState(false);
  /** Rare manual corrections layered on top of the automatic assignment. */
  const [overrides, setOverrides] = useState<{
    clusters: Record<string, SideId | null>;
    stats: Record<number, SideId | null>;
  }>({ clusters: {}, stats: {} });
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    preloadTesseract();
    return () => {
      void disposeTesseractWorker();
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_IMAGES));
  }, []);

  const runDecode = useCallback(async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setDecoded(null);
    try {
      const thumbs: Record<number, string> = {};
      files.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        urlsRef.current.push(url);
        thumbs[i] = url;
      });
      setThumbnails(thumbs);

      const result = await decodeScreenshotsPhase1(files, (done, total, label) =>
        setProgress(`${label} (${done}/${total})`),
      );
      setDecoded(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the screenshots');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [files]);

  /**
   * EVERYTHING THE APP CAN WORK OUT ITSELF.
   *
   * Recomputed whenever the decoded data or the typed names change: the names
   * are what orient Side A vs Side B, so editing one re-derives the mapping
   * rather than invalidating a pile of manual choices.
   */
  const auto = useMemo(() => {
    if (!decoded) return null;
    const base = autoAssignSides(decoded.stitchedTimeline, decoded.playerStats, {
      A: setup.sides[0].playerNames,
      B: setup.sides[1].playerNames,
    });
    return setup.swapSides ? swapAssignment(base) : base;
  }, [decoded, setup.sides, setup.swapSides]);

  /** The automatic assignment with any manual override laid over the top. */
  const effectiveSetup = useMemo<MatchSetup>(() => {
    if (!auto) return setup;
    return {
      ...setup,
      serverSideByGameKey: auto.serverSideByGameKey,
      clusterToSide: { ...auto.clusterToSide, ...pruneNulls(overrides.clusters) },
      statsScreenshotToSide: { ...auto.statsScreenshotToSide, ...pruneNulls(overrides.stats) },
    };
  }, [auto, setup, overrides]);

  const analysis = useMemo(() => {
    if (!decoded) return null;
    return computeMatchAnalysis(decoded.stitchedTimeline, decoded.playerStats, effectiveSetup);
  }, [decoded, effectiveSetup]);

  const reports = useMemo(() => (analysis ? buildFullReport(analysis) : null), [analysis]);

  const folderLabel = useMemo(() => `${localDateTimeForFolder()} — Match report`, []);

  const summaryText = useMemo(() => {
    if (!reports) return '';
    return reports
      .map((r) => {
        const summary = r.sections.find((s) => s.id === 'summary');
        const lines = summary?.rows.map((row) => `• ${row.value}`).join('\n') ?? '';
        return `${r.label}\n${lines}`;
      })
      .join('\n\n');
  }, [reports]);

  const counts = useMemo(() => {
    if (!decoded) return null;
    const byType = (t: string) => decoded.classified.filter((c) => c.type === t).length;
    return {
      total: decoded.classified.length,
      stats: byType('player_stats'),
      timeline: byType('timeline'),
      placement: byType('placement_map'),
      unrecognized: byType('unrecognized'),
      games: decoded.stitchedTimeline.games.length,
      points: decoded.stitchedTimeline.games.reduce((n, g) => n + g.points.length, 0),
    };
  }, [decoded]);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* ── Upload ─────────────────────────────────────────────────────── */}
      {!decoded && (
        <div style={card}>
          <h2 style={h2}>Upload your SwingVision screenshots</h2>
          <p style={hint}>
            Add the match&apos;s stats and point-by-point screenshots — up to {MAX_IMAGES}. Everything is read
            on this device with OCR; no AI is involved and nothing is estimated. Scrolled captures of the same
            screen are fine, they get stitched.
          </p>
          <label style={dropzone}>
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
            />
            Tap to add screenshots ({files.length}/{MAX_IMAGES})
          </label>
          {files.length > 0 && (
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#44403c' }}>
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} style={{ marginBottom: 5 }}>
                  {f.name}{' '}
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    style={linkBtn}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={busy || !files.length}
            onClick={() => void runDecode()}
            style={{ ...btnPrimary, marginTop: 16, width: '100%' }}
          >
            {busy ? progress || 'Reading…' : 'Read screenshots'}
          </button>
          {error && <p style={{ color: '#b91c1c', marginTop: 12, fontSize: 13 }}>{error}</p>}
        </div>
      )}

      {/* ── What was read ──────────────────────────────────────────────── */}
      {counts && (
        <div style={{ ...card, paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ fontSize: 12.5, color: 'var(--cl-text-secondary)' }}>
            Read <b style={{ color: 'var(--cl-text-primary)' }}>{counts.total}</b> screenshots — {counts.stats} stats,{' '}
            {counts.timeline} timeline
            {counts.placement > 0 && `, ${counts.placement} placement map`}
            {counts.unrecognized > 0 && `, ${counts.unrecognized} unrecognized`}. Found{' '}
            <b style={{ color: 'var(--cl-text-primary)' }}>{counts.games}</b> games and{' '}
            <b style={{ color: 'var(--cl-text-primary)' }}>{counts.points}</b> points.
          </div>
          <button
            type="button"
            onClick={() => { setDecoded(null); setFiles([]); setSetup(emptySetup()); }}
            style={{ ...linkBtn, marginTop: 8, color: 'var(--cl-text-secondary)' }}
          >
            Start over with different screenshots
          </button>
        </div>
      )}

      {/* ── Setup ──────────────────────────────────────────────────────── */}
      {decoded && (
        <MatchSetupPanel
          setup={effectiveSetup}
          onChange={setSetup}
          auto={auto}
          timeline={decoded.stitchedTimeline}
          playerStats={decoded.playerStats}
          thumbnails={thumbnails}
          overrides={overrides}
          onOverridesChange={setOverrides}
        />
      )}

      {/* ── Report ─────────────────────────────────────────────────────── */}
      {reports && analysis && (
        <div style={{ ...card, padding: '28px 26px 32px' }}>
          <h2 style={{ ...h2, marginBottom: 4 }}>2 · Match report</h2>
          <p style={{ ...hint, marginBottom: 28 }}>
            Every number below was read from your screenshots. Where something could not be read, the report
            says so instead of filling the gap.
          </p>
          <MatchReportView reports={reports} analysis={analysis} />

          {ENABLE_GOOGLE_EXPORTS && (
            <button type="button" onClick={() => setSaveOpen(true)} style={{ ...btnPrimary, width: '100%', marginTop: 12 }}>
              Save to Google Docs
            </button>
          )}
        </div>
      )}

      {reports && (
        <SaveReportToPlayersModal
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          reports={reports}
          folderLabel={folderLabel}
          summaryText={summaryText}
        />
      )}
    </div>
  );
}

/** Drop unset override entries so they fall through to the automatic value. */
function pruneNulls<K extends string | number>(r: Record<K, SideId | null>): Record<K, SideId> {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)) as Record<K, SideId>;
}

const card: React.CSSProperties = {
  background: 'var(--cl-bg-panel)',
  border: '1px solid var(--cl-border)',
  borderRadius: 14,
  padding: 22,
  marginBottom: 18,
  color: 'var(--cl-text-primary)',
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: '0 0 10px' };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--cl-text-secondary)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 640 };
const dropzone: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 150,
  border: '2px dashed #d6d3d1', borderRadius: 12, cursor: 'pointer',
  fontSize: 14, fontWeight: 600, color: '#57534e',
};
const btnPrimary: React.CSSProperties = {
  minHeight: 48, borderRadius: 12, border: 'none', background: 'var(--cl-action-primary)',
  color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: 12, padding: 0,
};
