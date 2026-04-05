'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { Camera, Upload, GripVertical } from 'lucide-react';
import type { CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode } from '@/components/ToolPalette';
import ExportModal from '@/components/ExportModal';
import PlaybackControls from '@/components/PlaybackControls';
import { SidebarSection } from '@/components/SidebarSection';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';

// Dynamic import prevents TensorFlow / Fabric from loading server-side
const CanvasOverlay = dynamic(() => import('@/components/Canvas'), { ssr: false });

export default function Home() {
  // ── Refs that must never unmount ─────────────────────────────────────────
  const videoRef      = useRef<HTMLVideoElement>(null);
  const videoRefB     = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<CanvasHandle>(null);
  const canvasRefB    = useRef<CanvasHandle>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const fileInputRefB = useRef<HTMLInputElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const containerRefB = useRef<HTMLDivElement>(null);

  // Webcam stream held here so ScreenRecorder can get audio
  const webcamStreamRef = useRef<MediaStream | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool]       = useState<ToolType>('pen');
  const [drawingOptions, setDrawingOptions] = useState<DrawingOptions>({
    color: '#F8F8F8',
    lineWidth: 3,
    fontSize: 24,
    dashed: false,
  });
  const [canvasSize, setCanvasSize]       = useState({ width: 800, height: 450 });
  const [videoSrc, setVideoSrc]           = useState<string | null>(null);
  const [videoSrcB, setVideoSrcB]         = useState<string | null>(null);
  const [canvasSizeB, setCanvasSizeB]     = useState({ width: 800, height: 450 });
  const [ballTrailMode, setBallTrailMode]  = useState<BallTrailMode>('short-tail');
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [showExport, setShowExport]       = useState(false);
  const [sidebarWidth, setSidebarWidth]   = useState(240);
  const [isResizing, setIsResizing]       = useState(false);
  const [webcamActive, setWebcamActive]   = useState(false);
  const [isRecording, setIsRecording]     = useState(false);
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
  const [videoBOffset, setVideoBOffset]   = useState(0);
  const [videoBDuration, setVideoBDuration] = useState(0);

  // Derived: skeleton / ball trail enabled when their tool is active
  const skeletonEnabled  = activeTool === 'skeleton';
  const ballTrailEnabled = activeTool === 'ballShadow';

  // ── Container size measurement ────────────────────────────────────────────
  const updateSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
  }, []);

  const updateSizeB = useCallback(() => {
    const el = containerRefB.current;
    if (!el) return;
    setCanvasSizeB({ width: el.clientWidth, height: el.clientHeight });
  }, []);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  useEffect(() => {
    updateSizeB();
    const ro = new ResizeObserver(updateSizeB);
    if (containerRefB.current) ro.observe(containerRefB.current);
    return () => ro.disconnect();
  }, [updateSizeB, videoSrcB]);

  // ── Sidebar resize ────────────────────────────────────────────────────────
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(240);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - resizeStartX.current;
      setSidebarWidth(Math.max(160, Math.min(360, resizeStartW.current + delta)));
    };
    const onUp = () => setIsResizing(false);
    if (isResizing) {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    }
  }, [isResizing]);

  // ── Keyboard shortcuts (undo / redo) ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        canvasRef.current?.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        canvasRef.current?.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Video upload ──────────────────────────────────────────────────────────
  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
    }
    // Reset AI caches for new video
    setProcessingStatus(null);
    canvasRef.current?.resetSkeleton();
    canvasRef.current?.resetBallTrail();
  }, []);

  const handleVideoUploadB = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrcB(url);
    if (videoRefB.current) {
      videoRefB.current.src = url;
      videoRefB.current.load();
    }
    setVideoBLoaded(false);
    canvasRefB.current?.resetSkeleton();
    canvasRefB.current?.resetBallTrail();
  }, []);

  // ── Video B sync loop (keeps B in sync with A + offset) ───────────────────
  useEffect(() => {
    const vA = videoRef.current;
    const vB = videoRefB.current;
    if (!vA || !vB || !videoBLoaded) return;

    let rafId: number;
    const syncLoop = () => {
      if (!vA.paused) {
        const targetBTime = vA.currentTime - videoBOffset;
        if (targetBTime >= 0 && targetBTime <= videoBDuration) {
          const drift = Math.abs(vB.currentTime - targetBTime);
          if (drift > 0.1) {
            vB.currentTime = targetBTime;
          }
          if (vB.paused) {
            vB.play().catch(() => {});
          }
        } else if (targetBTime < 0) {
          if (!vB.paused) vB.pause();
          vB.currentTime = 0;
        }
      }
      rafId = requestAnimationFrame(syncLoop);
    };

    rafId = requestAnimationFrame(syncLoop);
    return () => cancelAnimationFrame(rafId);
  }, [videoBLoaded, videoBOffset, videoBDuration]);

  // ── Webcam ────────────────────────────────────────────────────────────────
  const startWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        await webcamVideoRef.current.play().catch(() => {});
      }
      setWebcamActive(true);
    } catch (err) {
      console.error('[page] Webcam access denied:', err);
      alert('Could not access webcam. Please check browser permissions.');
    }
  }, []);

  // ── Screenshot ────────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    downloadDataURL(canvas.toDataURL('image/png'), `coach-lab-${Date.now()}.png`);
  }, []);

  // ── getCanvas / getWebcamStream for ScreenRecorder ────────────────────────
  const getCanvas        = useCallback(() => canvasRef.current?.getCanvas() ?? null, []);
  const getWebcamStream  = useCallback(() => webcamStreamRef.current, []);

  // Keep ScreenRecorder informed when recording state changes so Canvas draws PiP
  const handleRecordingChange = useCallback((recording: boolean) => {
    setIsRecording(recording);
  }, []);

  const handleOptionsChange = useCallback((opts: Partial<DrawingOptions>) => {
    setDrawingOptions(prev => ({ ...prev, ...opts }));
  }, []);

  // ── Auto Swing Detection ──────────────────────────────────────────────────
  const handleAutoSwing = useCallback(async () => {
    const swings = canvasRef.current?.getDetectedSwings() ?? [];
    if (swings.length === 0) {
      alert('No swings detected yet. Enable Skeleton tool and play the video first.');
      return;
    }
    const items = swings.map((s, i) =>
      `${i + 1}. ${s.startTime.toFixed(2)}s – ${s.endTime.toFixed(2)}s`
    ).join('\n');
    const choice = window.prompt(`Detected ${swings.length} swing(s):\n${items}\n\nEnter swing number to draw (1–${swings.length}):`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= swings.length) return;
    canvasRef.current?.drawSwingFromSegment(swings[idx], '#FF8C00');
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#F8F8F8', color: '#1D1D1F' }}>

      {/* ── Two hidden video elements at root — never unmount ── */}
      <video
        ref={videoRef}
        playsInline
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, top: -9999, left: -9999 }}
      />
      <video
        ref={videoRefB}
        playsInline
        muted
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, top: -9999, left: -9999 }}
        onLoadedMetadata={() => {
          const v = videoRefB.current;
          if (v) {
            setVideoBDuration(v.duration);
            setVideoBLoaded(true);
          }
        }}
      />
      <video
        ref={webcamVideoRef}
        playsInline
        muted
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, top: -9999, left: -9999 }}
      />

      {/* ── Header ── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '48px',
        borderBottom: '1px solid #E8E8ED',
        background: '#F8F8F8',
        flexShrink: 0,
        zIndex: 10,
        gap: '12px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '6px',
            background: '#35679A', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Camera size={14} color="#fff" />
          </div>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#1D1D1F', letterSpacing: '-0.02em' }}>
            Coach Lab
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={btnStyle}
          >
            <Upload size={14} />
            {videoSrc ? 'Replace A' : 'Upload Video A'}
          </button>

          <button
            onClick={() => fileInputRefB.current?.click()}
            style={btnStyle}
          >
            <Upload size={14} />
            {videoSrcB ? 'Replace B' : 'Upload Video B'}
          </button>

          {!webcamActive ? (
            <button onClick={startWebcam} style={btnStyle} title="Enable webcam overlay">
              <span>&#128247;</span> Webcam
            </button>
          ) : (
            <span style={{ fontSize: '12px', color: '#35679A', fontWeight: 500 }}>&#9679; Webcam on</span>
          )}

          {processingStatus && (
            <span style={{ fontSize: '11px', color: '#35679A', fontStyle: 'italic', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {processingStatus}
            </span>
          )}

          <ScreenRecorderWithTracking
            getCanvas={getCanvas}
            getWebcamStream={getWebcamStream}
            onRecordingChange={handleRecordingChange}
          />

          <button onClick={handleScreenshot} style={btnStyle} title="Save screenshot">
            <Camera size={14} /> Screenshot
          </button>

          <button
            onClick={() => setShowExport(true)}
            style={{ ...btnStyle, background: '#35679A', color: '#fff', border: 'none' }}
          >
            Export
          </button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left sidebar */}
        <aside style={{
          width: sidebarWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #E8E8ED',
          background: '#fff',
          overflowY: 'auto',
          position: 'relative',
        }}>
          <SidebarSection title="Tools">
            <ToolPalette
              activeTool={activeTool}
              onToolChange={setActiveTool}
              drawingOptions={drawingOptions}
              onOptionsChange={handleOptionsChange}
              onUndo={() => canvasRef.current?.undo()}
              onRedo={() => canvasRef.current?.redo()}
              onClear={() => canvasRef.current?.clearAll()}
              onResetSkeleton={() => canvasRef.current?.resetSkeleton()}
              onResetBallTrail={() => canvasRef.current?.resetBallTrail()}
              ballTrailMode={ballTrailMode}
              onBallTrailModeChange={setBallTrailMode}
              onAutoSwing={handleAutoSwing}
            />
          </SidebarSection>

          {/* Resize handle */}
          <div
            style={{
              position: 'absolute',
              top: 0, right: 0,
              height: '100%',
              width: '4px',
              cursor: 'col-resize',
              background: isResizing ? '#35679A22' : 'transparent',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPointerDown={onResizePointerDown}
            title="Drag to resize"
          >
            <GripVertical size={12} style={{ color: '#9ca3af', pointerEvents: 'none' }} />
          </div>
        </aside>

        {/* Canvas area */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0, background: '#000', display: 'flex' }}>
            {/* Video A */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
              <div
                ref={containerRef}
                style={{ width: '100%', height: '100%', position: 'relative' }}
              >
                {!videoSrc ? (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: '12px', color: '#9ca3af',
                  }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: '12px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
                      }}
                    >
                      <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        background: '#1f2937',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Upload size={36} color="#9ca3af" />
                      </div>
                      <span style={{ fontSize: '14px', fontWeight: 500 }}>Upload Video A</span>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>MP4, WebM, MOV supported</span>
                    </button>
                  </div>
                ) : (
                  <CanvasOverlay
                    ref={canvasRef}
                    videoRef={videoRef}
                    webcamVideoRef={webcamVideoRef}
                    activeTool={activeTool}
                    drawingOptions={drawingOptions}
                    containerWidth={canvasSize.width}
                    containerHeight={canvasSize.height}
                    ballTrailMode={ballTrailMode}
                    skeletonEnabled={skeletonEnabled}
                    ballTrailEnabled={ballTrailEnabled}
                    onProcessingStatus={setProcessingStatus}
                    isRecording={isRecording}
                  />
                )}
                {videoSrcB && (
                  <div style={{
                    position: 'absolute', top: 4, left: 8,
                    fontSize: '11px', fontWeight: 700, color: '#fff',
                    background: 'rgba(0,0,0,0.5)', padding: '1px 6px', borderRadius: '4px',
                  }}>A</div>
                )}
              </div>
            </div>

            {/* Video B (only shown when videoSrcB is set) */}
            {videoSrcB && (
              <>
                <div style={{ width: '1px', background: '#333', flexShrink: 0 }} />
                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                  <div
                    ref={containerRefB}
                    style={{ width: '100%', height: '100%', position: 'relative' }}
                  >
                    <CanvasOverlay
                      ref={canvasRefB}
                      videoRef={videoRefB}
                      activeTool={activeTool}
                      drawingOptions={drawingOptions}
                      containerWidth={canvasSizeB.width}
                      containerHeight={canvasSizeB.height}
                      ballTrailMode={ballTrailMode}
                      skeletonEnabled={skeletonEnabled}
                      ballTrailEnabled={ballTrailEnabled}
                      onProcessingStatus={setProcessingStatus}
                      isRecording={isRecording}
                    />
                    <div style={{
                      position: 'absolute', top: 4, left: 8,
                      fontSize: '11px', fontWeight: 700, color: '#fff',
                      background: 'rgba(0,0,0,0.5)', padding: '1px 6px', borderRadius: '4px',
                    }}>B</div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Playback controls */}
          <PlaybackControls videoRef={videoRef} videoRefB={videoSrcB ? videoRefB : undefined} />

          {/* Video B offset control */}
          {videoSrcB && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '4px 16px', fontSize: '11px', color: '#6b7280',
              background: '#F8F8F8', borderTop: '1px solid #E8E8ED',
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, color: '#1D1D1F' }}>B offset:</span>
              <input
                type="number"
                step="0.1"
                value={videoBOffset}
                onChange={e => setVideoBOffset(parseFloat(e.target.value) || 0)}
                style={{
                  width: '70px', padding: '2px 6px', borderRadius: '4px',
                  border: '1px solid #E8E8ED', fontSize: '11px',
                }}
                title="Shift Video B start time relative to Video A (seconds)"
              />
              <span style={{ color: '#9ca3af' }}>sec (positive = B starts later)</span>
            </div>
          )}

          {/* Hint bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '16px',
            padding: '4px 16px', fontSize: '10px', color: '#6b7280',
            background: '#F8F8F8', borderTop: '1px solid #E8E8ED',
            flexWrap: 'wrap', flexShrink: 0,
          }}>
            <span>Space: play/pause</span>
            <span>J/K/L: 0.5×/1×/2×</span>
            <span>&#x2190;/&#x2192;: frame step</span>
            <span>Ctrl+Z: undo</span>
            <span>Ctrl+Y: redo</span>
            <span style={{ color: '#35679A' }}>Skeleton: auto-detects pose</span>
            <span style={{ color: '#CCFF00', textShadow: '0 0 4px #0008' }}>Ball Trail: auto-tracks ball</span>
            <span style={{ color: '#FFD700' }}>Angle: 3-click with live preview</span>
          </div>
        </main>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        style={{ display: 'none' }}
        onChange={handleVideoUpload}
      />
      <input
        ref={fileInputRefB}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        style={{ display: 'none' }}
        onChange={handleVideoUploadB}
      />

      {/* Export modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        getCompositeCanvas={() => canvasRef.current?.getCanvas() ?? null}
        videoRef={videoRef}
      />
    </div>
  );
}

// ── Button style constant ──────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #E8E8ED',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#1D1D1F',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

// ── ScreenRecorder that tracks isRecording state for Canvas PiP ───────────

function ScreenRecorderWithTracking({
  getCanvas,
  getWebcamStream,
  onRecordingChange,
}: {
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  onRecordingChange: (v: boolean) => void;
}) {
  const [recState, setRecState] = useState<'idle' | 'recording' | 'stopped'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef    = useRef<MediaStream | null>(null);
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef  = useRef('video/webm');

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setElapsed(0);

    const canvas = getCanvas();
    if (!canvas) { setError('Load a video first.'); return; }

    if (!streamRef.current) {
      streamRef.current = (canvas as unknown as { captureStream(f: number): MediaStream }).captureStream(30);
    }

    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];
    const wcStream = getWebcamStream();
    if (wcStream) wcStream.getAudioTracks().forEach(t => tracks.push(t));

    const combined  = new MediaStream(tracks);
    const mimeType  = getBestMimeType();
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combined, { mimeType: mimeType || undefined, videoBitsPerSecond: 5_000_000 });
    } catch (err) {
      setError('MediaRecorder not supported.');
      console.error(err);
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      const duration = Date.now() - startTimeRef.current;
      const rawBlob  = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });

      let finalBlob: Blob;
      try {
        const { webmFixDuration } = await import('webm-fix-duration');
        finalBlob = await webmFixDuration(rawBlob, duration, mimeTypeRef.current || 'video/webm');
      } catch {
        finalBlob = rawBlob;
      }

      const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const url = URL.createObjectURL(finalBlob);
      const a   = document.createElement('a');
      a.href = url; a.download = `coach-lab-${ts}.webm`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setRecState('idle');
      onRecordingChange(false);
    };

    recorder.start(1000);
    recorderRef.current  = recorder;
    startTimeRef.current = Date.now();
    setRecState('recording');
    onRecordingChange(true);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [getCanvas, getWebcamStream, onRecordingChange]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { rec.stop(); setRecState('stopped'); }
  }, []);

  const fmt = (s: number) => [Math.floor(s/3600), Math.floor((s%3600)/60), s%60]
    .map(v => String(v).padStart(2,'0')).join(':');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {recState === 'idle' && (
        <button onClick={startRecording} style={btnStyle} title="Start screen recording">
          <span style={{ color: '#FF3B30' }}>&#9210;</span> Record
        </button>
      )}
      {recState === 'recording' && (
        <>
          <span style={{
            width: '9px', height: '9px', borderRadius: '50%', background: '#FF3B30',
            animation: 'recPulse 1.2s ease-in-out infinite', flexShrink: 0,
          }} />
          <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#FF3B30', fontWeight: 700 }}>
            {fmt(elapsed)}
          </span>
          <button onClick={stopRecording} style={{ ...btnStyle, background: '#FF3B30', color: '#fff', border: 'none' }}>
            &#9632; Stop
          </button>
        </>
      )}
      {recState === 'stopped' && (
        <span style={{ fontSize: '12px', color: '#35679A' }}>Saving\u2026</span>
      )}
      {error && <span style={{ fontSize: '11px', color: '#FF3B30' }}>{error}</span>}
      <style>{`@keyframes recPulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}

function getBestMimeType(): string {
  const c = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  for (const t of c) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}
