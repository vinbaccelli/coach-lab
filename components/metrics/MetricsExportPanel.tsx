'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TrimRangeBar, { formatClock } from '@/components/TrimRangeBar';
import { exportEditedVideo } from '@/lib/cropExport';
import { drawVideoWatermark } from '@/lib/videoWatermark';
import {
  estimateExportBytes, EXPORT_AUDIO_BPS, exportQualityOptions, formatMegabytes, type ExportQuality,
} from '@/lib/exportEstimate';
import {
  analysisCleanup, analysisFailedText, analysisProgress, analysisSampleTimes, checkAnalyzedTrack, dockAnalysisBar, drawingsExportStatus,
  FOLLOW_STEP_SEC, includesLabel, meanAbsDiff, parsePassProgress, poseRegion, poseShift, skeletonExportStatus,
  skeletonFollowsVideo, toGrey, trackedFraction, untrackedIntervals, type FollowStep, type Rect,
} from '@/lib/exportOverlay';
import type { CanvasHandle, ExportOverlayFrozen } from '@/components/Canvas';

/**
 * Metrics → Generate: export the loaded video (whole or a trimmed section),
 * with the LIVE drawings and the AI-tracked skeleton drawn on when the coach
 * includes them (Canvas drawExportOverlay, called from the export loop). AI
 * measurement overlays, the data column and snapshot drawings are never
 * exported. The skeleton is drawn from the stored AI Track: when the coach
 * includes it and part of the range is untracked, Export first runs the
 * existing AI Track pass (runPrecisionPass, 'fast', unchanged) on the untracked
 * parts only, with its own progress and Cancel, then renders. No live pose runs
 * while rendering.
 *
 * Opening does no work: no seek of the analysis video, no frame capture, no
 * snapshot writes. Snapshots and angle data are not needed and never touched;
 * the old snapshot flow stays one tap away behind "Snapshot report".
 *
 * The preview is this panel's OWN <video> on the same source. The export
 * renders through lib/cropExport.ts exportEditedVideo (one hidden video →
 * canvas → MediaRecorder at real time). While it runs the analysis video and
 * the preview are paused and the preview's source is unloaded, so only one
 * video decodes (iOS decoder limit). No pose work is started here.
 */

export interface MetricsExportPanelProps {
  /** The analysis video's source (blob: URL for an upload, or a file URL). */
  videoSrc: string | null;
  /** Set when the source cannot be exported (YouTube/embed); shown as the reason. */
  exportBlockedReason: string | null;
  /** Metrics section handles, read-only ("Use section"). */
  sectionStart: number | null;
  sectionEnd: number | null;
  snapshotCount: number;
  /** Runs the existing snapshot Generate flow (handleGenerateSnapshots). */
  onSnapshotReport: () => void;
  /** Pauses the analysis video (called on open and when an export starts). */
  pauseAnalysisVideo: () => void;
  onClose: () => void;
  isMobile?: boolean;
  /**
   * Skeleton + drawings for the export (read-only Canvas calls). Null: the
   * export is video only and the toggles are hidden.
   */
  overlay?: {
    /** An AI Track started from the toolbar is running (the export must wait for it). */
    trackRunning: boolean;
    /** The pass's own status line (page processingStatus): "AI-tracking… 42% (…)". */
    passStatus: string | null;
    /** Runs the existing AI Track pass on [start, end] ('fast'); resolves to the poses kept (0 if cancelled). */
    analyzeRange: (start: number, end: number) => Promise<number>;
    /** Stops a running analyzeRange pass. */
    cancelAnalysis: () => void;
    /** SNAPSHOT mode: the canvas drawings belong to a snapshot and are not exported. */
    snapshotMode: boolean;
    getBakedPoseAt: CanvasHandle['getBakedPoseAt'];
    isRangeBaked: CanvasHandle['isRangeBaked'];
    drawExportOverlay: CanvasHandle['drawExportOverlay'];
    /**
     * The analysis video's picture on screen (CSS px), or null. While the
     * skeleton is analyzed the panel shrinks to a bar docked outside it: the
     * pass seeks that video, and iOS Safari may not hand the detector fresh
     * frames of a covered video.
     */
    getVideoRect?: () => Rect | null;
    /** Any AI Track stored right now (Canvas getBakedTrackInfo() !== null). */
    hasBakedTrack: () => boolean;
    /** Clears every AI Track (Canvas clearBakedTrack) and returns the toolbar to idle. */
    clearBakedTrack: () => void;
  } | null;
}

type Phase = 'idle' | 'analyzing' | 'reading' | 'exporting' | 'done' | 'error';

const NO_SNAPSHOT_MESSAGE = 'Create a snapshot first (Create Snapshot or AI Detect)';
/** No render progress for this long (tab visible) → show the stalled state. */
const STALL_MS = 3000;
/** Shown (disabled) until the preview has read the video's size. */
const PLACEHOLDER_OPTIONS: Array<{ id: ExportQuality; label: string; width?: number; height?: number; disabled?: boolean }> = [
  { id: '720p', label: '720p' }, { id: '1080p', label: '1080p' }, { id: 'original', label: 'Original' },
];

export default function MetricsExportPanel({
  videoSrc, exportBlockedReason, sectionStart, sectionEnd, snapshotCount,
  onSnapshotReport, pauseAnalysisVideo, onClose, isMobile = false, overlay = null,
}: MetricsExportPanelProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [quality, setQuality] = useState<ExportQuality | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; ext: string; name: string } | null>(null);
  const [tabHidden, setTabHidden] = useState(false);
  const [stalled, setStalled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressAtRef = useRef(0);
  const pctRef = useRef(0);
  const resultUrlRef = useRef<string | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);
  // The export's own skeleton analysis while it runs (untracked parts, current one, start time).
  const analysisRef = useRef<{ intervals: Array<{ start: number; end: number }>; index: number; startedAt: number } | null>(null);
  // Latest cancelAnalysis, for the unmount cleanup (which only sees the first render).
  const cancelAnalysisRef = useRef<(() => void) | null>(null);
  cancelAnalysisRef.current = overlay?.cancelAnalysis ?? null;
  const markCancelled = useCallback(() => { setPhase('idle'); setNotice('Export cancelled.'); }, []);

  const blockedReason = exportBlockedReason ?? (videoSrc ? null : 'Load a video first.');
  const busy = phase === 'analyzing' || phase === 'reading' || phase === 'exporting';

  // Open: pause the analysis video (no seek, nothing else). Pausing here, not
  // at export start, keeps the one pose detection a pause triggers out of the
  // export itself.
  useEffect(() => { pauseAnalysisVideo(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close/unmount: stop any export and free the result's object URL.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (analysisRef.current) { analysisRef.current = null; cancelAnalysisRef.current?.(); }
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
  }, []);

  const clearResult = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  }, []);

  // ── Preview: own <video>, latest-seek-wins scrubbing ────────────────────
  const pendingSeekRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const seekGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pumpSeek = useCallback(() => {
    const v = previewRef.current;
    if (!v || seekingRef.current || pendingSeekRef.current == null) return;
    const t = pendingSeekRef.current;
    pendingSeekRef.current = null;
    seekingRef.current = true;
    // A seek that never reports back must not wedge the scrubber.
    if (seekGuardRef.current) clearTimeout(seekGuardRef.current);
    seekGuardRef.current = setTimeout(() => { seekingRef.current = false; pumpSeek(); }, 1000);
    try { v.pause(); v.currentTime = t; } catch { seekingRef.current = false; }
  }, []);
  const onPreviewSeeked = useCallback(() => {
    if (seekGuardRef.current) clearTimeout(seekGuardRef.current);
    seekingRef.current = false;
    pumpSeek();
  }, [pumpSeek]);
  const scrubTo = useCallback((t: number) => { pendingSeekRef.current = t; pumpSeek(); }, [pumpSeek]);
  useEffect(() => () => { if (seekGuardRef.current) clearTimeout(seekGuardRef.current); }, []);

  // MediaRecorder files can report an infinite duration until the end is
  // reached: probe it on the PREVIEW element (never the analysis video).
  const probingRef = useRef(false);
  const metaReadRef = useRef(false);
  const onPreviewMeta = useCallback(() => {
    const v = previewRef.current;
    if (!v || !v.videoWidth) return;
    if (!Number.isFinite(v.duration)) {
      if (probingRef.current) return;
      probingRef.current = true;
      const onDur = () => {
        if (!Number.isFinite(v.duration)) return;
        v.removeEventListener('durationchange', onDur);
        probingRef.current = false;
        try { v.currentTime = 0; } catch { /* noop */ }
        onPreviewMeta();
      };
      v.addEventListener('durationchange', onDur);
      try { v.currentTime = 1e101; } catch { /* noop */ }
      return;
    }
    if (metaReadRef.current) return; // a reload after an export keeps the coach's trim
    metaReadRef.current = true;
    setMeta({ w: v.videoWidth, h: v.videoHeight, duration: v.duration });
    setRange({ start: 0, end: v.duration });
  }, []);

  const options = useMemo(() => (meta ? exportQualityOptions(meta.w, meta.h) : []), [meta]);
  useEffect(() => {
    if (!options.length || quality) return;
    const p1080 = options.find((o) => o.id === '1080p');
    setQuality(p1080 && !p1080.disabled ? '1080p' : 'original');
  }, [options, quality]);
  const selected = options.find((o) => o.id === quality) ?? null;
  const spanSec = Math.max(0, range.end - range.start);
  const estimateBytes = selected ? estimateExportBytes(spanSec, selected.videoBitsPerSecond, EXPORT_AUDIO_BPS) : 0;

  // ── Skeleton + drawings (read-only probes; nothing is drawn until Export) ──
  // Drawings cannot change while this modal is open, so count them once.
  const drawingCount = useMemo(
    () => (overlay ? overlay.drawExportOverlay(null, 0, 1, 1, { skeleton: false, drawings: false }).drawingCount : 0),
    [overlay],
  );
  // Bumped after the export's own analysis so the coverage is read again.
  const [trackVersion, setTrackVersion] = useState(0);
  const trackedFrac = useMemo(() => {
    if (!overlay || !meta || !(range.end > range.start)) return 0;
    if (overlay.isRangeBaked(range.start, range.end)) return 1;
    return trackedFraction(range.start, range.end, (t) => overlay.getBakedPoseAt(t) !== null);
  }, [overlay, meta, range.start, range.end, trackVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Our own analysis also runs as an AI Track: only someone else's pass makes it wait.
  // Set when this panel's own analysis failed its self-check (frozen or too sparse).
  const [analysisFailed, setAnalysisFailed] = useState(false);
  // Cancel was pressed during our own analysis and its pass is still finishing
  // the frame it is on: from Cancel until analyzeRange settles (KNOWN_ISSUES 054).
  const [stopping, setStopping] = useState(false);
  const skStatus = skeletonExportStatus(Boolean(overlay?.trackRunning) && phase !== 'analyzing', trackedFrac, analysisFailed, stopping);
  const drStatus = drawingsExportStatus(Boolean(overlay?.snapshotMode), drawingCount);
  const skAvailable = skStatus.state !== 'busy' && skStatus.state !== 'failed' && skStatus.state !== 'stopping';
  const drAvailable = drStatus.state === 'ready';
  // Unset until the coach flips it: on by default when some of the range is tracked.
  const [skeletonChoice, setSkeletonChoice] = useState<boolean | null>(null);
  const skeletonWanted = skeletonChoice ?? trackedFrac > 0;
  const setSkeletonWanted = (v: boolean) => setSkeletonChoice(v);
  const [drawingsWanted, setDrawingsWanted] = useState(true);
  const includeSkeleton = Boolean(overlay) && skAvailable && skeletonWanted;
  const needsAnalysis = includeSkeleton && skStatus.state === 'analyze';

  // Analysis progress (0..1 over all untracked parts) and a remaining-time
  // estimate MEASURED from this run's own progress (shown once it is reliable).
  const [analysis, setAnalysis] = useState<{ frac: number; leftSec: number | null }>({ frac: 0, leftSec: null });
  const passStatus = overlay?.passStatus ?? null;
  useEffect(() => {
    const a = analysisRef.current;
    if (phase !== 'analyzing' || !a) return;
    const frac = analysisProgress(a.intervals, a.index, parsePassProgress(passStatus) ?? 0);
    const elapsed = (performance.now() - a.startedAt) / 1000;
    const leftSec = frac >= 0.05 && elapsed >= 3 ? (elapsed / frac) * (1 - frac) : null;
    lastProgressAtRef.current = performance.now();
    setAnalysis({ frac, leftSec });
  }, [passStatus, phase]);
  const includeDrawings = Boolean(overlay) && drAvailable && drawingsWanted;

  const onTrimChange = useCallback((next: { start: number; end: number }, moved: 'start' | 'end') => {
    setRange(next);
    clearResult();
    scrubTo(moved === 'start' ? next.start : next.end);
  }, [clearResult, scrubTo]);

  const setWhole = () => { if (meta) { setRange({ start: 0, end: meta.duration }); clearResult(); scrubTo(0); } };
  const sectionAvailable = sectionStart != null && sectionEnd != null && sectionEnd > sectionStart;
  const useSection = () => {
    if (!meta || sectionStart == null || sectionEnd == null) return;
    const start = Math.max(0, Math.min(sectionStart, meta.duration - 0.1));
    const end = Math.min(meta.duration, Math.max(sectionEnd, start + 0.1));
    setRange({ start, end });
    clearResult();
    scrubTo(start);
  };

  // ── Background / stall state while exporting ────────────────────────────
  useEffect(() => {
    if (!busy) { setTabHidden(false); setStalled(false); return; }
    const onVis = () => {
      setTabHidden(document.visibilityState === 'hidden');
      lastProgressAtRef.current = performance.now(); // returning is not a stall
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    const iv = window.setInterval(() => {
      setStalled(phase === 'exporting' && document.visibilityState === 'visible'
        && performance.now() - lastProgressAtRef.current > STALL_MS);
    }, 1000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(iv); };
  }, [busy, phase]);

  /**
   * The skeleton analysis failed a check: say why (with its numbers) and leave
   * the skeleton off. `after`: what happened to the analysis's track — cleared
   * (the switch is usable again: nothing bad is stored) or left with an earlier
   * AI Track (the switch stays on "could not be analyzed").
   */
  const failSkeleton = useCallback((text: string, after?: { cleared: boolean; note: string }) => {
    setAnalysisFailed(!after?.cleared);
    setSkeletonChoice(false);
    setPhase('error');
    setError(`${text} Skeleton is now off: export again to save the video without it.${after ? ` ${after.note}` : ''}`);
  }, []);

  // The watermark's logo loads lazily on first draw: warm it now, so the first
  // exported frame already carries it (the analysis canvas usually has).
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const x = c.getContext('2d');
      if (x) drawVideoWatermark(x, 1, 1);
    } catch { /* noop */ }
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────
  const startExport = useCallback(async () => {
    if (!videoSrc || !meta || !selected || selected.disabled || busy || stopping) return;
    clearResult();
    setError(null);
    setNotice(null);
    pauseAnalysisVideo();
    const ac = new AbortController();
    abortRef.current = ac;

    // One decoder only: pause the preview and unload its source for the run.
    const pv = previewRef.current;
    const resumeAt = range.start;
    if (pv) {
      try { pv.pause(); pv.removeAttribute('src'); pv.load(); } catch { /* noop */ }
    }
    let restored = false;
    const restorePreview = () => {
      if (restored) return;
      restored = true;
      const v = previewRef.current;
      if (!v || !videoSrc) return;
      try { v.src = videoSrc; v.load(); } catch { /* noop */ }
      pendingSeekRef.current = resumeAt;
      seekingRef.current = false;
      v.addEventListener('loadedmetadata', () => pumpSeek(), { once: true });
    };
    // Cancel answers at once: the UI returns to idle without waiting for the
    // render (or an in-flight MP4 conversion) to wind down.
    restoreRef.current = restorePreview;

    pctRef.current = 0;
    setPct(0);
    lastProgressAtRef.current = performance.now();
    // The pre-render check's numbers, repeated if the render check fails later.
    let analyzed: { check: ReturnType<typeof checkAnalyzedTrack>; kept: number; span: number } | null = null;
    // Was any AI Track stored before our analysis? Decides whether a failed or
    // cancelled analysis can be cleaned up (analysisCleanup).
    let hadTrackBefore: boolean | null = null;
    const cleanUpAnalysis = () => {
      const c = analysisCleanup(hadTrackBefore !== false);
      if (c.clear) { overlay?.clearBakedTrack(); setTrackVersion((v) => v + 1); }
      return { cleared: c.clear, note: c.note };
    };
    try {
      // ── 1. Skeleton analysis (only the untracked parts of the range) ──
      // The existing AI Track pass, unchanged ('fast'). It seeks the analysis
      // video; meanwhile this panel is a bar docked outside that video's picture
      // (phase 'analyzing'), so the video is on screen as with the toolbar's AI
      // Track. The preview is unloaded.
      if (overlay && needsAnalysis) {
        const intervals = untrackedIntervals(range.start, range.end, (t) => overlay.getBakedPoseAt(t) !== null);
        analysisRef.current = { intervals, index: 0, startedAt: performance.now() };
        setAnalysis({ frac: 0, leftSec: null });
        setPhase('analyzing');
        setStage('Analyzing skeleton…');
        hadTrackBefore = overlay.hasBakedTrack();
        let kept = 0;
        let cancelled = false;
        try {
          for (let i = 0; i < intervals.length; i++) {
            analysisRef.current = { ...analysisRef.current, index: i };
            kept += await overlay.analyzeRange(intervals[i].start, intervals[i].end);
            if (ac.signal.aborted) { cancelled = true; break; }
          }
        } finally {
          // The pass has settled (finished, cancelled or thrown): no longer "stopping".
          setStopping(false);
        }
        if (cancelled) {
          // Cancel already reset the UI ("Export cancelled."); the pass has now
          // stopped, so its parts can be cleaned up.
          const after = cleanUpAnalysis();
          setNotice(`Export cancelled. ${after.note}`);
          return;
        }
        analysisRef.current = null;
        setTrackVersion((v) => v + 1);
        const covered = overlay.isRangeBaked(range.start, range.end)
          ? 1 : trackedFraction(range.start, range.end, (t) => overlay.getBakedPoseAt(t) !== null);
        if (covered <= 0) {
          const after = cleanUpAnalysis();
          setPhase('error');
          setError(`The skeleton analysis found no player in this range. Turn Skeleton off to export without it, or run AI Track from the Skeleton menu. ${after.note}`);
          return;
        }
        // Self-check before rendering: enough poses, a pose that moves, and not
        // the same pose frame after frame (sampled once per pass frame). A pass
        // that read the same picture again and again would export a frozen skeleton.
        const span = intervals.reduce((sum, r) => sum + (r.end - r.start), 0);
        const check = checkAnalyzedTrack(kept, span, analysisSampleTimes(intervals, 1 / 30, 3600).map((t) => overlay.getBakedPoseAt(t)));
        if (!check.ok) {
          failSkeleton(analysisFailedText(check, kept, span, null), cleanUpAnalysis());
          return;
        }
        analyzed = { check, kept, span };
      }
      setPhase('reading');
      setStage('Reading video…');
      const src = await (await fetch(videoSrc, { signal: ac.signal })).blob();
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      setPhase('exporting');
      const whole = range.start <= 0.01 && range.end >= meta.duration - 0.01;
      // Overlays: capture the video box, strokes and angles NOW (export start),
      // then reuse that capture for every frame so a resize cannot move them.
      let drawOverlays: ((ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void) | undefined;
      // Render-time check (skeleton only): every FOLLOW_STEP_SEC of media time,
      // compare the picture around the skeleton with the previous step's (same
      // region) and the skeleton's own move. Read BEFORE the overlay is drawn, so
      // it is the video frame alone. A skeleton that stays put while the picture
      // moves stops the export (KNOWN_ISSUES 052).
      type FollowLast = { kps: NonNullable<ReturnType<CanvasHandle['getBakedPoseAt']>>; region: Rect; grey: Uint8Array };
      const follow = {
        steps: [] as FollowStep[],
        nextAt: -Infinity,
        last: null as FollowLast | null,
        verdict: null as { moved: number; still: number } | null,
      };
      if (overlay && (includeSkeleton || includeDrawings)) {
        const flags = { skeleton: includeSkeleton, drawings: includeDrawings };
        const frozen: ExportOverlayFrozen = overlay.drawExportOverlay(null, range.start, 1, 1, flags);
        const thumb = includeSkeleton ? document.createElement('canvas') : null;
        if (thumb) { thumb.width = 32; thumb.height = 32; }
        const tctx = thumb?.getContext('2d', { willReadFrequently: true }) ?? null;
        const grab = (src: CanvasRenderingContext2D, r: Rect) => {
          tctx!.drawImage(src.canvas, r.x, r.y, r.w, r.h, 0, 0, 32, 32);
          return toGrey(tctx!.getImageData(0, 0, 32, 32).data);
        };
        const probe = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => {
          if (t < follow.nextAt || follow.verdict || !(frozen.videoW > 0) || !(frozen.videoH > 0)) return;
          follow.nextAt = t + FOLLOW_STEP_SEC;
          const kps = overlay.getBakedPoseAt(t);
          const region = poseRegion(kps, w / frozen.videoW, h / frozen.videoH, w, h);
          if (!kps || !region) { follow.last = null; return; }
          const last = follow.last;
          if (last) {
            const shift = poseShift(last.kps, kps);
            if (shift !== null) follow.steps.push({ image: meanAbsDiff(last.grey, grab(ctx, last.region)), pose: shift });
            const v = skeletonFollowsVideo(follow.steps, 6);
            if (v.ok === false) { follow.verdict = v; ac.abort(); return; }
          }
          follow.last = { kps, region, grey: grab(ctx, region) };
        };
        drawOverlays = (ctx, t, w, h) => {
          if (tctx) { try { probe(ctx, t, w, h); } catch { /* the check must never stop the export */ } }
          overlay.drawExportOverlay(ctx, t, w, h, { ...flags, frozen });
        };
      }
      // Every export carries the AngleMotion watermark (lib/videoWatermark.ts),
      // bottom-left of the frame, LAST: after the render check has read the bare
      // frame and after the skeleton and drawings (KNOWN_ISSUES 046).
      const drawOverlay = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => {
        drawOverlays?.(ctx, t, w, h);
        drawVideoWatermark(ctx, w, h);
      };
      const res = await exportEditedVideo(src, {
        trim: whole ? null : { start: range.start, end: range.end },
        maxHeight: selected.maxHeight,
        videoBitsPerSecond: selected.videoBitsPerSecond,
        signal: ac.signal,
        pauseWhenHidden: true,
        drawOverlay,
        onProgress: (msg) => {
          if (ac.signal.aborted) return;
          lastProgressAtRef.current = performance.now();
          // The renderer names its pass after the Recording Hub ("Rendering crop/edit…").
          setStage(msg.startsWith('Rendering') ? 'Exporting…' : msg);
        },
        onRenderProgress: (f) => {
          if (ac.signal.aborted) return;
          lastProgressAtRef.current = performance.now();
          const p = Math.round(Math.max(0, Math.min(1, f)) * 100);
          if (p !== pctRef.current) { pctRef.current = p; setPct(p); }
        },
      });
      // The render check stopped it, or it finished frozen: no file with a frozen skeleton.
      const finalFollow = follow.verdict ?? (() => {
        const v = skeletonFollowsVideo(follow.steps);
        return v.ok === false ? v : null;
      })();
      if (finalFollow && abortRef.current === ac) {
        // Only the export's own analysis is cleaned up; a toolbar AI Track that
        // fails the render check is left to the coach.
        failSkeleton(
          analysisFailedText(analyzed?.check ?? null, analyzed?.kept ?? 0, analyzed?.span ?? 0, finalFollow),
          analyzed ? cleanUpAnalysis() : undefined,
        );
        return;
      }
      // Cancelled (or closed): the UI was already reset by cancelExport.
      if (ac.signal.aborted) return;
      if (res.ok) {
        const url = URL.createObjectURL(res.blob);
        resultUrlRef.current = url;
        setResult({ url, blob: res.blob, ext: res.ext, name: `anglemotion-export-${selected.id}-${Date.now()}.${res.ext}` });
        setPhase('done');
      } else {
        setPhase('error');
        setError(res.error);
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setStage(null);
      }
      restorePreview();
      if (restoreRef.current === restorePreview) restoreRef.current = null;
    }
  }, [videoSrc, meta, selected, busy, stopping, range, clearResult, pauseAnalysisVideo, pumpSeek, overlay, includeSkeleton, includeDrawings, needsAnalysis, failSkeleton]);

  const cancelExport = useCallback(() => {
    const ac = abortRef.current;
    if (!ac) return;
    abortRef.current = null;
    ac.abort();
    if (analysisRef.current) { analysisRef.current = null; overlay?.cancelAnalysis(); setStopping(true); }
    setStage(null);
    markCancelled();
    restoreRef.current?.();
  }, [markCancelled, overlay]);

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.name;
    a.click();
  };
  const shareFile = useMemo(() => {
    if (!result || typeof navigator === 'undefined' || typeof File === 'undefined') return null;
    try {
      const f = new File([result.blob], result.name, { type: result.blob.type || `video/${result.ext}` });
      return typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }) ? f : null;
    } catch {
      return null;
    }
  }, [result]);
  const share = async () => {
    if (!shareFile) return;
    try { await navigator.share({ files: [shareFile], title: 'AngleMotion video' }); } catch { /* dismissed */ }
  };

  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const snapshotReport = () => {
    if (snapshotCount === 0) setSnapshotMsg(NO_SNAPSHOT_MESSAGE);
    onSnapshotReport();
  };

  const close = useCallback(() => {
    abortRef.current?.abort();
    if (analysisRef.current) { analysisRef.current = null; overlay?.cancelAnalysis(); }
    onClose();
  }, [onClose, overlay]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, close]);

  const btn = (primary = false, disabled = false): React.CSSProperties => ({
    minHeight: 44, padding: '10px 16px', borderRadius: 10,
    border: primary ? 'none' : '1px solid rgba(255,255,255,0.22)',
    background: primary ? 'var(--cl-accent)' : 'rgba(255,255,255,0.10)',
    color: primary ? 'var(--cl-text-on-accent, #fff)' : 'var(--cl-text-on-fill)',
    fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
  });
  const muted: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.7)' };

  // ── Analysis: the panel collapses to a bar docked outside the video's picture ──
  const collapsed = phase === 'analyzing';
  const barRef = useRef<HTMLDivElement | null>(null);
  const getVideoRectRef = useRef(overlay?.getVideoRect);
  getVideoRectRef.current = overlay?.getVideoRect;
  const [dock, setDock] = useState<ReturnType<typeof dockAnalysisBar> | null>(null);
  // No room for the full bar outside the picture: drop its note (and stay compact, so it cannot flip back).
  const [barCompact, setBarCompact] = useState(false);
  useEffect(() => { if (dock && dock.overlap > 0) setBarCompact(true); }, [dock]);
  useLayoutEffect(() => {
    if (!collapsed) { setDock(null); setBarCompact(false); return; }
    const place = () => {
      const next = dockAnalysisBar({ w: window.innerWidth, h: window.innerHeight }, getVideoRectRef.current?.() ?? null, barRef.current?.offsetHeight || 110);
      setDock((d) => (d && d.left === next.left && d.top === next.top && d.width === next.width ? d : next));
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' && barRef.current ? new ResizeObserver(place) : null;
    if (ro && barRef.current) ro.observe(barRef.current);
    window.addEventListener('resize', place);
    // The page can move the video under the bar (layout, zoom): follow it.
    const iv = window.setInterval(place, 1000);
    return () => { ro?.disconnect(); window.removeEventListener('resize', place); window.clearInterval(iv); };
  }, [collapsed]);

  let status: string | null = null;
  if (busy) {
    if (tabHidden) {
      status = phase === 'analyzing'
        ? 'The skeleton analysis slows down while this tab is in the background. Come back to continue, or Cancel.'
        : 'Paused — this tab is in the background. Come back to continue, or Cancel.';
    }
    else if (stalled) status = 'Waiting for the video… the export has not moved for a few seconds. You can Cancel.';
    else if (phase === 'analyzing') {
      const left = analysis.leftSec;
      status = `Analyzing skeleton… ${Math.round(analysis.frac * 100)}%`
        + (left != null ? ` · about ${left >= 90 ? `${Math.round(left / 60)} min` : `${Math.max(5, Math.round(left / 5) * 5)} s`} left` : '');
    } else status = stage ?? 'Exporting…';
  }

  const analysisBar = collapsed ? (
    <div
      ref={barRef}
      role="region"
      aria-label="Skeleton analysis"
      data-testid="analysis-bar"
      data-dock-side={dock?.side}
      data-dock-overlap={dock?.overlap}
      data-compact={barCompact || undefined}
      style={{
        position: 'fixed', zIndex: 10050, left: dock?.left ?? 8, top: dock?.top ?? 8, width: dock?.width ?? 'calc(100% - 16px)',
        // Hidden until placed, and for the one layout before it turns compact.
        visibility: dock && !(dock.overlap > 0 && !barCompact) ? 'visible' : 'hidden', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
        background: 'rgba(18,18,22,0.96)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        color: 'var(--cl-text-on-fill)', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div aria-label="Skeleton analysis progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(analysis.frac * 100)}
        data-testid="analysis-progress"
        style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(analysis.frac * 100)}%`, height: '100%', background: '#F5B800' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span data-testid="export-status" style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{status}</span>
        <button type="button" style={btn(false)} onClick={cancelExport}>Cancel</button>
      </div>
      {barCompact ? null : (
        <span style={muted}>Step 1 of 2: the video stays in view while its skeleton is analyzed. Then it is exported in real time.</span>
      )}
    </div>
  ) : null;

  return (
    <>
    {analysisBar}
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export video"
      aria-hidden={collapsed || undefined}
      onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.85)',
        // While the skeleton is analyzed the panel is the bar above: nothing covers the video.
        display: collapsed ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 8 : 16,
      }}
    >
      <div
        data-testid="metrics-export-panel"
        style={{
          width: isMobile ? 'min(480px, 100%)' : 'min(720px, 100%)', maxHeight: '92vh',
          overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch',
          boxSizing: 'border-box', padding: 16, borderRadius: 14,
          background: 'rgba(18,18,22,0.98)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--cl-text-on-fill)', display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, flex: 1 }}>Export video</h2>
          <button type="button" aria-label="Close" onClick={close} style={{ ...btn(false), minWidth: 44, padding: '8px 12px' }}>✕</button>
        </div>

        {blockedReason ? (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{blockedReason}</p>
        ) : (
          <>
            <video
              ref={previewRef}
              src={videoSrc ?? undefined}
              muted
              playsInline
              controls={!busy}
              preload="metadata"
              onLoadedMetadata={onPreviewMeta}
              onSeeked={onPreviewSeeked}
              style={{
                width: '100%', maxHeight: isMobile ? '30vh' : '34vh', background: '#000',
                borderRadius: 10, objectFit: 'contain', display: 'block',
              }}
            />

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Range</span>
                <button type="button" style={btn(false, !meta || busy)} disabled={!meta || busy} onClick={setWhole}>Whole video</button>
                <button
                  type="button"
                  style={btn(false, !meta || busy || !sectionAvailable)}
                  disabled={!meta || busy || !sectionAvailable}
                  title={sectionAvailable ? 'Use the Metrics section handles' : 'No Metrics section set'}
                  onClick={useSection}
                >
                  Use section
                </button>
              </div>
              <TrimRangeBar
                duration={meta?.duration ?? 0}
                start={range.start}
                end={range.end}
                onChange={onTrimChange}
                getPlayhead={() => previewRef.current?.currentTime ?? null}
                disabled={busy || !meta}
              />
            </section>

            {overlay ? (
              <section aria-label="Include" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Include</span>
                {([
                  { key: 'drawings', title: 'Drawings', label: 'Include drawings', on: includeDrawings, avail: drAvailable, text: drStatus.text, set: setDrawingsWanted },
                  { key: 'skeleton', title: 'Skeleton', label: 'Include skeleton', on: includeSkeleton, avail: skAvailable, text: skStatus.text, set: setSkeletonWanted },
                ] as const).map((row) => {
                  const off = !row.avail || busy;
                  return (
                    <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.on}
                        aria-label={row.label}
                        disabled={off}
                        onClick={() => { row.set(!row.on); clearResult(); }}
                        style={{
                          flex: '0 0 auto', width: 48, height: 28, borderRadius: 14, padding: 2, border: 'none',
                          background: row.on ? 'var(--cl-accent)' : 'rgba(255,255,255,0.22)',
                          cursor: off ? 'default' : 'pointer', opacity: off ? 0.45 : 1,
                          display: 'flex', justifyContent: row.on ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <span style={{ width: 24, height: 24, borderRadius: 12, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                      </button>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{row.title}</span>
                        <span data-testid={`export-${row.key}-status`} style={muted}>{row.text}</span>
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : null}

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Quality</span>
              <span data-testid="export-includes" style={muted}>{includesLabel(includeSkeleton, includeDrawings)}</span>
              <div role="radiogroup" aria-label="Quality" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {(options.length ? options : PLACEHOLDER_OPTIONS).map((o) => {
                  const on = o.id === quality;
                  const off = !meta || busy || Boolean(o.disabled);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={off}
                      onClick={() => { setQuality(o.id); clearResult(); }}
                      style={{
                        ...btn(false, off), padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        border: on ? '2px solid var(--cl-accent)' : '1px solid rgba(255,255,255,0.22)',
                        background: on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
                      }}
                    >
                      <span>{o.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>
                        {o.width && o.height ? `${o.width}×${o.height}` : '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {options.some((o) => o.disabled) ? <span style={muted}>Sizes larger than the video are off (no upscaling).</span> : null}
            </section>

            <div data-testid="export-estimate" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>
                {selected ? `≈ ${formatMegabytes(estimateBytes)}` : '≈ — MB'}
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.75 }}> estimated (approximate)</span>
              </span>
              <span style={muted}>
                {selected
                  ? `${formatClock(spanSec)} · ${selected.width}×${selected.height} · ${(selected.videoBitsPerSecond / 1_000_000).toFixed(0)} Mbps`
                  : 'Reading video…'}
              </span>
            </div>

            {busy ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div aria-label="Export progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                  style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                  <div style={{ width: `${phase === 'reading' ? 0 : pct}%`, height: '100%', background: 'var(--cl-accent)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span data-testid="export-status" style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{status}{phase === 'exporting' && !tabHidden ? ` ${pct}%` : ''}</span>
                  <button type="button" style={btn(false)} onClick={cancelExport}>Cancel</button>
                </div>
                <span style={muted}>Exports in real time: a {formatClock(spanSec)} range takes about that long.</span>
              </div>
            ) : result ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span data-testid="export-final-size" style={{ fontSize: 14, fontWeight: 700, color: '#34D399' }}>
                  Ready — {formatMegabytes(result.blob.size)} ({result.ext.toUpperCase()})
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={btn(true)} onClick={download}>Download</button>
                  {shareFile ? <button type="button" style={btn(false)} onClick={() => { void share(); }}>Share</button> : null}
                  <button type="button" style={btn(false)} onClick={clearResult}>Export again</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  style={btn(true, !selected || selected.disabled || stopping)}
                  disabled={!selected || selected.disabled || stopping}
                  onClick={() => { void startExport(); }}
                >
                  {needsAnalysis ? 'Analyze skeleton + export' : 'Export'}
                </button>
                {needsAnalysis ? (
                  <span data-testid="export-analysis-note" style={muted}>
                    Skeleton will be analyzed first, this adds time. Then the {formatClock(spanSec)} range is exported in real time.
                  </span>
                ) : null}
                {error ? <span style={{ fontSize: 13, color: 'var(--cl-destructive-text)' }}>{error}</span> : null}
                {notice ? <span style={muted}>{notice}</span> : null}
              </div>
            )}
          </>
        )}

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={btn(false, busy)} disabled={busy} onClick={snapshotReport}>Snapshot report</button>
          <span style={{ ...muted, flex: 1, minWidth: 160 }}>
            {snapshotMsg ?? (snapshotCount > 0
              ? `Images and report from your ${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'}.`
              : 'Images and report from your snapshots.')}
          </span>
        </div>
      </div>
    </div>
    </>
  );
}
