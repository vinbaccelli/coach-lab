'use client';

/**
 * PostRecordingCropModal — the post-recording workbench.
 *
 * The screen is always recorded full. After it stops this modal opens on the
 * "Recording complete" chooser and the coach can apply any combination of:
 *   - Crop   (spatial — draggable region with Free / 9:16 / 16:9 presets)
 *   - Trim   (time — in/out points on the clip)
 * and THEN choose an output: download, or upload to YouTube.
 *
 * WHY THE MODAL OWNS THE EDITED BLOB.
 * Cropping used to be terminal: the one crop button was "Crop & download MP4",
 * it handed the region to the parent, and the parent downloaded the result and
 * closed the modal. So the coach got exactly one edit and exactly one output —
 * picking YouTube after cropping was impossible because the modal was gone, and
 * chaining a trim onto a crop had nowhere to happen. The modal now keeps a
 * WORKING blob: each edit re-renders it in place, and the output row (Download /
 * Upload to YouTube) stays available the whole time, whatever edits were or
 * weren't applied. Nothing closes the modal except Close/Cancel.
 *
 * Crop and trim are applied in ONE render pass each (exportEditedVideo), and a
 * second edit re-renders the already-edited working blob.
 *
 * Icon semantics (V1): Crop = crop/region tool; Trim = scissors; Background
 * removal (hub) = landscape cut-out icon — keep meanings distinct.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Youtube, Loader2, Crop as CropIcon, Scissors, Download } from 'lucide-react';
import type { YouTubeConnection } from '@/hooks/useYouTubeConnection';
import { exportEditedVideo } from '@/lib/cropExport';

export type CropAspect = 'free' | '9:16' | '16:9';
export type PixelRegion = { x: number; y: number; w: number; h: number };
/** Crop seed expressed as fractions (0..1) of the full screen, from the optional pre-record area. */
export type RegionFraction = { x: number; y: number; w: number; h: number };

interface Props {
  blob: Blob;
  ext: string;
  /** Optional seed from the pre-record "Set Recording Area" metadata. */
  seedRegionFrac?: RegionFraction | null;
  seedAspect?: CropAspect;
  /** Open straight into the crop phase (used when an area was pre-selected). */
  startInCrop?: boolean;
  onCancel: () => void;
  /**
   * Same connection state the Metrics/StroMotion export panels and the analysis
   * capture toast share — one grant, one status, everywhere in the app.
   * Omit to hide the YouTube option entirely (e.g. behind a feature flag).
   */
  youtube?: YouTubeConnection;
  /**
   * Uploads whatever the coach currently has — the original recording, or the
   * cropped/trimmed working copy. The modal passes the blob, so one handler
   * covers every combination of edits.
   */
  onUploadYouTube?: (blob: Blob) => Promise<{ ok: boolean; url?: string; error?: string; needsConnect?: boolean }>;

  /**
   * @deprecated Downloading is owned by the modal now (it must not close the
   * modal, or the YouTube option would vanish after a download). Unused.
   */
  onDownloadFull?: () => void;
  /**
   * @deprecated Cropping is applied to the modal's working blob via
   * exportEditedVideo; the parent no longer renders or downloads it. Unused.
   */
  onExportCrop?: (region: PixelRegion, aspect: CropAspect) => Promise<void> | void;
  /**
   * @deprecated Superseded by `onUploadYouTube`, which now receives the edited
   * blob. Unused.
   */
  onUploadYoutubeCropped?: (
    region: PixelRegion,
    aspect: CropAspect,
  ) => Promise<{ ok: boolean; url?: string; error?: string; needsConnect?: boolean }>;
}

type Rect = { x: number; y: number; w: number; h: number };
type ContentBox = { left: number; top: number; w: number; h: number };
type Phase = 'choose' | 'crop' | 'trim';

function aspectRatioValue(a: CropAspect): number | null {
  if (a === '9:16') return 9 / 16;
  if (a === '16:9') return 16 / 9;
  return null;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function PostRecordingCropModal({
  blob,
  ext,
  seedRegionFrac,
  seedAspect = 'free',
  startInCrop = false,
  onCancel,
  youtube,
  onUploadYouTube,
}: Props) {
  // ── The working copy ─────────────────────────────────────────────────────
  // Starts as the untouched recording; each applied edit replaces it. Every
  // output action (download, YouTube) reads THIS, so edits compose and the
  // output choice is never spent by making an edit.
  const [work, setWork] = useState<{ blob: Blob; ext: string }>({ blob, ext });
  const [cropped, setCropped] = useState(false);
  const [trimmed, setTrimmed] = useState<{ start: number; end: number } | null>(null);

  // One object URL per working blob, revoked when it is replaced or the modal closes.
  const [previewUrl, setPreviewUrl] = useState<string>('');
  useEffect(() => {
    const u = URL.createObjectURL(work.blob);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [work.blob]);

  const [phase, setPhase] = useState<Phase>(startInCrop ? 'crop' : 'choose');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const [ytBusy, setYtBusy] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytUrl, setYtUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [content, setContent] = useState<ContentBox | null>(null);
  const [aspect, setAspect] = useState<CropAspect>(seedAspect);
  const [crop, setCrop] = useState<Rect | null>(null);
  const seededRef = useRef(false);

  // Trim in/out points, in seconds on the working clip's timeline.
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const cropRef = useRef<Rect | null>(null);
  cropRef.current = crop;
  const contentRef = useRef<ContentBox | null>(null);
  contentRef.current = content;

  /** Applies a finished edit: the render output becomes the new working copy. */
  const adoptEdited = useCallback((next: { blob: Blob; ext: string }) => {
    setWork(next);
    // Everything measured from the old blob is now wrong.
    setIntrinsic(null);
    setContent(null);
    setCrop(null);
    setDuration(0);
    seededRef.current = false;
    setDownloaded(false);
    // The previous upload described a different cut — don't leave its link up.
    setYtUrl(null);
    setYtError(null);
  }, []);

  const recomputeContent = useCallback(() => {
    const v = videoRef.current;
    if (!v || !intrinsic) return;
    const r = v.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const ar = intrinsic.w / intrinsic.h;
    let dispW = r.width;
    let dispH = r.width / ar;
    if (dispH > r.height) { dispH = r.height; dispW = r.height * ar; }
    setContent({ left: (r.width - dispW) / 2, top: (r.height - dispH) / 2, w: dispW, h: dispH });
  }, [intrinsic]);

  useLayoutEffect(() => { recomputeContent(); }, [recomputeContent, phase]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeContent());
    ro.observe(v);
    window.addEventListener('resize', recomputeContent);
    return () => { ro.disconnect(); window.removeEventListener('resize', recomputeContent); };
  }, [recomputeContent]);

  const reshapeForAspect = useCallback((box: ContentBox, a: CropAspect, prev: Rect | null): Rect => {
    const ratio = aspectRatioValue(a);
    if (ratio == null) {
      if (prev) {
        const x = Math.min(prev.x, box.w);
        const y = Math.min(prev.y, box.h);
        return { x, y, w: Math.min(prev.w, box.w - x), h: Math.min(prev.h, box.h - y) };
      }
      const w = box.w * 0.6;
      const h = box.h * 0.6;
      return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
    }
    let w = box.w * 0.7;
    let h = w / ratio;
    if (h > box.h) { h = box.h * 0.9; w = h * ratio; }
    if (w > box.w) { w = box.w; h = w / ratio; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }, []);

  // Seed the crop box once content is measured (uses pre-record area if present).
  // Re-seeds after an edit, because the working blob's frame has changed.
  useEffect(() => {
    if (phase !== 'crop' || !content) return;
    if (seededRef.current) return;
    seededRef.current = true;
    if (seedRegionFrac && !cropped && !trimmed) {
      const x = Math.max(0, Math.min(content.w, seedRegionFrac.x * content.w));
      const y = Math.max(0, Math.min(content.h, seedRegionFrac.y * content.h));
      const w = Math.max(40, Math.min(content.w - x, seedRegionFrac.w * content.w));
      const h = Math.max(40, Math.min(content.h - y, seedRegionFrac.h * content.h));
      setCrop({ x, y, w, h });
    } else {
      setCrop(reshapeForAspect(content, aspect, null));
    }
  }, [phase, content, seedRegionFrac, aspect, reshapeForAspect, cropped, trimmed]);

  const onAspectChange = useCallback((a: CropAspect) => {
    setAspect(a);
    setCrop((prev) => (content ? reshapeForAspect(content, a, prev) : prev));
  }, [content, reshapeForAspect]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const box = contentRef.current;
    const c = cropRef.current;
    if (!box || !c) return;
    if (dragRef.current) {
      const d = dragRef.current;
      const nx = Math.max(0, Math.min(box.w - c.w, d.ox + (e.clientX - d.sx)));
      const ny = Math.max(0, Math.min(box.h - c.h, d.oy + (e.clientY - d.sy)));
      setCrop({ ...c, x: nx, y: ny });
    } else if (resizeRef.current) {
      const rz = resizeRef.current;
      const ratio = aspectRatioValue(aspect);
      let nw = Math.max(40, rz.ow + (e.clientX - rz.sx));
      let nh = ratio == null ? Math.max(40, rz.oh + (e.clientY - rz.sy)) : nw / ratio;
      nw = Math.min(nw, box.w - c.x);
      nh = Math.min(nh, box.h - c.y);
      if (ratio != null) { nw = Math.min(nw, nh * ratio); nh = nw / ratio; }
      setCrop({ ...c, w: nw, h: nh });
    }
  }, [aspect]);

  const onPointerUp = useCallback(() => { dragRef.current = null; resizeRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  /**
   * MediaRecorder files routinely report duration Infinity until they are
   * seeked. Without this the trim sliders would have no range at all, so force
   * the browser to resolve it by seeking far past the end.
   */
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setIntrinsic({ w: v.videoWidth, h: v.videoHeight });
    if (Number.isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
      return;
    }
    const onTimeUpdate = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        v.removeEventListener('timeupdate', onTimeUpdate);
        setDuration(v.duration);
        try { v.currentTime = 0; } catch { /* noop */ }
      }
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    try { v.currentTime = 1e101; } catch { /* noop */ }
  }, []);

  // Default the trim handles to the whole clip whenever a new duration lands.
  useEffect(() => {
    if (duration > 0) { setTrimStart(0); setTrimEnd(duration); }
  }, [duration]);

  const computeCropRegion = useCallback((): PixelRegion | null => {
    if (!crop || !content || !intrinsic) return null;
    const scale = intrinsic.w / content.w;
    return { x: crop.x * scale, y: crop.y * scale, w: crop.w * scale, h: crop.h * scale };
  }, [crop, content, intrinsic]);

  const handleApplyCrop = useCallback(async () => {
    if (busy) return;
    const region = computeCropRegion();
    if (!region) return;
    setError(null);
    setBusy(true);
    setProgress('Applying crop…');
    try {
      const result = await exportEditedVideo(work.blob, { region, onProgress: setProgress });
      if (!result.ok) { setError(result.error); return; }
      adoptEdited({ blob: result.blob, ext: result.ext });
      setCropped(true);
      setPhase('choose');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the crop.');
    } finally {
      // Always cleared — the old code left busy=true on the success path, which
      // froze every remaining button (YouTube included) behind a disabled state.
      setBusy(false);
      setProgress(null);
    }
  }, [busy, computeCropRegion, work.blob, adoptEdited]);

  const handleApplyTrim = useCallback(async () => {
    if (busy) return;
    if (!(trimEnd - trimStart > 0.1)) { setError('Trimmed clip is too short.'); return; }
    // Trimming nothing off would still cost a full re-encode.
    if (trimStart <= 0.01 && duration > 0 && trimEnd >= duration - 0.01) {
      setPhase('choose');
      return;
    }
    setError(null);
    setBusy(true);
    setProgress('Applying trim…');
    try {
      const result = await exportEditedVideo(work.blob, {
        trim: { start: trimStart, end: trimEnd },
        onProgress: setProgress,
      });
      if (!result.ok) { setError(result.error); return; }
      const span = { start: trimStart, end: trimEnd };
      adoptEdited({ blob: result.blob, ext: result.ext });
      setTrimmed(span);
      setPhase('choose');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the trim.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, trimStart, trimEnd, duration, work.blob, adoptEdited]);

  /**
   * Downloads the WORKING copy and deliberately leaves the modal open, so
   * "download it AND put it on YouTube" is one session rather than a choice.
   */
  const handleDownload = useCallback(() => {
    const u = URL.createObjectURL(work.blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `angle-motion-recording-${Date.now()}.${work.ext}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(u), 10_000);
    setDownloaded(true);
  }, [work]);

  const handleUploadYoutube = useCallback(async () => {
    if (!onUploadYouTube || ytBusy) return;
    setYtBusy(true);
    setYtError(null);
    try {
      const result = await onUploadYouTube(work.blob);
      if (!result.ok) {
        if (result.needsConnect) await youtube?.refresh();
        setYtError(result.error ?? 'Upload failed — try again.');
        return;
      }
      setYtUrl(result.url ?? null);
    } catch (e) {
      setYtError(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setYtBusy(false);
    }
  }, [onUploadYouTube, ytBusy, work.blob, youtube]);

  const tabBtn = (selected: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 8,
    border: 'none',
    background: selected ? 'var(--cl-accent)' : 'rgba(255,255,255,0.14)',
    color: 'var(--cl-text-on-fill)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  // `isDisabled` is the SAME expression passed to the button's `disabled` prop —
  // pass it explicitly per button. It used to default to the shared `busy` flag,
  // which made every other button's disabled state (e.g. "no crop box yet")
  // invisible: cursor stayed `pointer` and opacity stayed 1 even though a real
  // click would do nothing, and conversely a button disabled for its OWN reason
  // could still look fully active. Cursor/opacity must track the actual prop.
  const bigBtn = (bg: string, isDisabled = busy): React.CSSProperties => ({
    padding: '12px 20px',
    borderRadius: 12,
    border: 'none',
    background: bg,
    color: 'var(--cl-text-on-fill)',
    fontSize: 15,
    fontWeight: 700,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  });

  const sliderStyle: React.CSSProperties = { flex: 1, minWidth: 120, accentColor: 'var(--cl-accent)' };
  const smallBtn: React.CSSProperties = {
    padding: '5px 10px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.12)',
    color: 'var(--cl-text-on-fill)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const title = phase === 'choose' ? 'Recording complete' : phase === 'crop' ? 'Crop recording' : 'Trim recording';
  const editSummary = [
    cropped ? 'cropped' : null,
    trimmed ? `trimmed ${formatClock(trimmed.start)}–${formatClock(trimmed.end)}` : null,
  ].filter(Boolean).join(' · ');

  /** Seeks the preview so dragging a trim handle shows the frame it lands on. */
  const scrubTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    try { v.pause(); v.currentTime = t; } catch { /* noop */ }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200010,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px 16px',
        gap: 12,
        touchAction: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: 'var(--cl-text-on-fill)' }}>
        <strong style={{ fontSize: 16 }}>{title}</strong>
        {editSummary ? (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Edits applied: {editSummary}</span>
        ) : null}
        {phase === 'crop' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {(['free', '9:16', '16:9'] as CropAspect[]).map((a) => (
              <button key={a} type="button" style={tabBtn(aspect === a)} onClick={() => onAspectChange(a)} disabled={busy}>
                {a === 'free' ? 'Free' : a}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <video
            ref={videoRef}
            src={previewUrl}
            controls={phase !== 'crop'}
            loop={phase === 'choose'}
            autoPlay={phase === 'choose'}
            muted
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', borderRadius: 8 }}
          />
          {phase === 'crop' && content && crop ? (
            <div
              style={{
                position: 'absolute',
                left: content.left + crop.x,
                top: content.top + crop.y,
                width: crop.w,
                height: crop.h,
                border: '2px solid var(--cl-success)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                borderRadius: 4,
                cursor: 'move',
                touchAction: 'none',
              }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).dataset.resize) return;
                dragRef.current = { sx: e.clientX, sy: e.clientY, ox: crop.x, oy: crop.y };
                e.currentTarget.setPointerCapture(e.pointerId);
                e.preventDefault();
              }}
            >
              <div
                data-resize="1"
                style={{
                  position: 'absolute',
                  right: -14,
                  bottom: -14,
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'nwse-resize',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: crop.w, oh: crop.h };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.preventDefault();
                }}
              >
                <div style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--cl-success)', border: '2px solid #fff', pointerEvents: 'none' }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {phase === 'trim' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--cl-text-on-fill)',
            touchAction: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 42 }}>Start</span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.05}
              value={trimStart}
              disabled={busy || duration <= 0}
              style={sliderStyle}
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), trimEnd - 0.1);
                setTrimStart(Math.max(0, v));
                scrubTo(Math.max(0, v));
              }}
            />
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', minWidth: 56 }}>{formatClock(trimStart)}</span>
            <button
              type="button"
              style={smallBtn}
              disabled={busy}
              onClick={() => {
                const t = videoRef.current?.currentTime ?? 0;
                setTrimStart(Math.max(0, Math.min(t, trimEnd - 0.1)));
              }}
            >
              Use playhead
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 42 }}>End</span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.05}
              value={trimEnd}
              disabled={busy || duration <= 0}
              style={sliderStyle}
              onChange={(e) => {
                const v = Math.max(Number(e.target.value), trimStart + 0.1);
                setTrimEnd(Math.min(Math.max(duration, 0.1), v));
                scrubTo(Math.min(Math.max(duration, 0.1), v));
              }}
            />
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', minWidth: 56 }}>{formatClock(trimEnd)}</span>
            <button
              type="button"
              style={smallBtn}
              disabled={busy}
              onClick={() => {
                const t = videoRef.current?.currentTime ?? duration;
                setTrimEnd(Math.min(Math.max(duration, 0.1), Math.max(t, trimStart + 0.1)));
              }}
            >
              Use playhead
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
            {duration > 0
              ? `Keeping ${formatClock(Math.max(0, trimEnd - trimStart))} of ${formatClock(duration)}`
              : 'Reading clip length…'}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {error ? <span style={{ color: 'var(--cl-destructive-text)', fontSize: 12, marginRight: 'auto' }}>{error}</span> : null}
        {busy ? <span style={{ color: 'var(--cl-text-on-fill)', fontSize: 13, marginRight: 'auto' }}>{progress ?? 'Working…'}</span> : null}
        {!busy && !error && downloaded ? (
          <span style={{ color: '#34D399', fontSize: 13, fontWeight: 600, marginRight: 'auto' }}>Downloaded ✓</span>
        ) : null}

        {phase === 'choose' ? (
          <>
            {/* Output options. Present on every visit to this phase, whatever
                edits have or haven't been applied — that is the whole point of
                keeping the working blob in the modal. */}
            {onUploadYouTube && youtube && !youtube.loading ? (
              ytUrl ? (
                <a
                  href={ytUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#34D399', fontSize: 13, fontWeight: 600 }}
                >
                  Uploaded — open on YouTube ↗
                </a>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {ytError ? <span style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{ytError}</span> : null}
                  <button
                    type="button"
                    style={bigBtn('#CC0000', busy || ytBusy || youtube.connecting)}
                    disabled={busy || ytBusy || youtube.connecting}
                    onClick={() => { if (youtube.connected) void handleUploadYoutube(); else void youtube.connect(); }}
                    title={youtube.connected
                      ? 'Upload this recording (with any crop/trim applied) to your YouTube channel as Unlisted'
                      : 'Authorize AngleMotion to upload to your YouTube channel. Opens a Google window; your recording is not affected.'}
                  >
                    {ytBusy || youtube.connecting ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={14} />}
                    {ytBusy ? 'Uploading…' : youtube.connecting ? 'Connecting…' : youtube.connected ? 'Upload to YouTube' : 'Connect YouTube'}
                  </button>
                </span>
              )
            ) : null}
            <button type="button" style={bigBtn('rgba(255,255,255,0.16)')} onClick={onCancel} disabled={busy}>
              {downloaded || ytUrl ? 'Close' : 'Cancel'}
            </button>
            <button type="button" style={bigBtn('var(--cl-accent)')} onClick={() => setPhase('crop')} disabled={busy}>
              <CropIcon size={15} />{cropped ? 'Crop again' : 'Crop'}
            </button>
            <button
              type="button"
              style={bigBtn('var(--cl-accent)', busy || duration <= 0)}
              onClick={() => setPhase('trim')}
              disabled={busy || duration <= 0}
              title={duration > 0 ? 'Cut the start and/or end off this recording' : 'Reading clip length…'}
            >
              <Scissors size={15} />{trimmed ? 'Trim again' : 'Trim'}
            </button>
            <button type="button" style={bigBtn('var(--cl-success-text)')} onClick={handleDownload} disabled={busy}>
              <Download size={15} />Download ({work.ext.toUpperCase()})
            </button>
          </>
        ) : phase === 'crop' ? (
          <>
            <button type="button" style={bigBtn('rgba(255,255,255,0.16)')} onClick={() => setPhase('choose')} disabled={busy}>Back</button>
            <button type="button" style={bigBtn('var(--cl-success-text)', busy || !crop)} onClick={handleApplyCrop} disabled={busy || !crop}>
              <CropIcon size={15} />Apply crop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              style={bigBtn('rgba(255,255,255,0.16)')}
              onClick={() => { setTrimStart(0); setTrimEnd(duration); setPhase('choose'); }}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="button"
              style={bigBtn('var(--cl-success-text)', busy || duration <= 0 || trimEnd - trimStart <= 0.1)}
              onClick={handleApplyTrim}
              disabled={busy || duration <= 0 || trimEnd - trimStart <= 0.1}
            >
              <Scissors size={15} />Apply trim
            </button>
          </>
        )}
      </div>
    </div>
  );
}
