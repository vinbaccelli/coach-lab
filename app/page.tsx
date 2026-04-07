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
import ToolPalette, { type BallTrailMode, type WebcamPipMode } from '@/components/ToolPalette';
import ExportModal from '@/components/ExportModal';
import PlaybackControls from '@/components/PlaybackControls';
import { SidebarSection } from '@/components/SidebarSection';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';
import { useStroMotion } from '@/hooks/useStroMotion';

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
  const [ballTrailMode, setBallTrailMode]  = useState<BallTrailMode>('comet');
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [showExport, setShowExport]       = useState(false);
  const [sidebarWidth, setSidebarWidth]   = useState(240);
  const [isResizing, setIsResizing]       = useState(false);
  const [webcamActive, setWebcamActive]   = useState(false);
  const [isRecording, setIsRecording]     = useState(false);
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
  const [videoBOffset, setVideoBOffset]   = useState(0);
  const [videoBDuration, setVideoBDuration] = useState(0);
  const [circleSpinning, setCircleSpinning] = useState(false);
  const [circleGapMode, setCircleGapMode]   = useState(false);
  const [webcamPipMode, setWebcamPipMode]   = useState<WebcamPipMode>('rectangle');
  const [webcamOpacity, setWebcamOpacity]   = useState(1);
  const [urlInput, setUrlInput]             = useState('');
  const [embedUrl, setEmbedUrl]             = useState<{ type: 'youtube' | 'instagram' | 'mp4'; url: string } | null>(null);

  // StroMotion state
  const [stroMotionEnabled, setStroMotionEnabled] = useState(false);
  const [stroMotionStart, setStroMotionStart]     = useState(0);
  const [stroMotionEnd, setStroMotionEnd]         = useState(3);
  const [stroMotionCount, setStroMotionCount]     = useState(6);
  const [stroMotionOpacity, setStroMotionOpacity] = useState(0.3);

  // Derived: skeleton / ball trail enabled when their tool is active
  const skeletonEnabled  = activeTool === 'skeleton';
  const ballTrailEnabled = activeTool === 'ballShadow';

  // StroMotion hook
  const stroMotionConfig = {
    enabled: stroMotionEnabled,
    startFrame: Math.round(stroMotionStart * 30),
    endFrame: Math.round(stroMotionEnd * 30),
    ghostCount: stroMotionCount,
    opacity: stroMotionOpacity,
  };
  const { ghostFrames, isProcessing: stroMotionProcessing, progress: stroMotionProgress, clearGhosts } = useStroMotion(videoRef, stroMotionConfig);

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

  /** Acceptable drift (seconds) before Video B is hard-seeked to catch up */
  const VIDEO_B_SYNC_DRIFT_THRESHOLD = 0.1;

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
          if (drift > VIDEO_B_SYNC_DRIFT_THRESHOLD) {
            vB.currentTime = targetBTime;
          }
          if (vB.paused) {
            vB.play().catch((err) => {
              console.warn('[VideoB sync] play() rejected:', err);
            });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Racket Multiplier ─────────────────────────────────────────────────────
  const handleRacketMultiplier = useCallback(async () => {
    const swings = canvasRef.current?.getDetectedSwings() ?? [];
    if (swings.length === 0) {
      alert('No swings detected yet. Enable Skeleton tool and play the video first.');
      return;
    }
    const items = swings.map((s, i) =>
      `${i + 1}. ${s.startTime.toFixed(2)}s – ${s.endTime.toFixed(2)}s`
    ).join('\n');
    const choice = window.prompt(`Detected ${swings.length} swing(s):\n${items}\n\nEnter swing number to show racket trail (1–${swings.length}), or 0 to clear:`);
    if (!choice) return;
    const idx = parseInt(choice, 10);
    if (idx === 0) {
      canvasRef.current?.setRacketTrail(null);
      return;
    }
    const swingIdx = idx - 1;
    if (isNaN(swingIdx) || swingIdx < 0 || swingIdx >= swings.length) return;
    const frames = canvasRef.current?.getSkeletonFrames() ?? [];
    if (frames.length === 0) {
      alert('No skeleton frames available. Play the video with Skeleton tool enabled first.');
      return;
    }
    const { extractRacketTrail } = await import('@/lib/racketMultiplier');
    const swing = swings[swingIdx];
    const trail = extractRacketTrail(frames, swing.startTime, swing.endTime);
    if (trail.positions.length === 0) {
      alert('No wrist positions found in this swing segment.');
      return;
    }
    canvasRef.current?.setRacketTrail(trail);
  }, []);

  // ── URL Input handler ────────────────────────────────────────────────────
  const handleUrlSubmit = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw) return;

    const ytMatch = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytMatch) {
      setEmbedUrl({ type: 'youtube', url: `https://www.youtube.com/embed/${ytMatch[1]}` });
      return;
    }
    // Use URL parsing to ensure the hostname is exactly instagram.com
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.replace(/^www\./, '');
      if (host === 'instagram.com') {
        const igMatch = parsed.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)/);
        if (igMatch) {
          setEmbedUrl({ type: 'instagram', url: `https://www.instagram.com/${igMatch[1]}/${igMatch[2]}/embed` });
          return;
        }
      }
    } catch {
      // Not a valid URL — continue to other checks below
    }
    // Only allow safe video URLs (http/https or blob)
    if ((raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('blob:'))
        && raw.match(/\.(mp4|webm|mov)(\?.*)?$/i)) {
      setVideoSrc(raw);
      if (videoRef.current) { videoRef.current.src = raw; videoRef.current.load(); }
      return;
    }
    alert('Supported: YouTube URL, direct .mp4/.webm link, or Instagram (view-only embed).');
  }, [urlInput, videoRef]);

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
        {/* URL Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <input
              type="text"
              placeholder="YouTube / MP4 URL…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
              style={{
                height: '30px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #E8E8ED',
                fontSize: '12px',
                width: '200px',
                outline: 'none',
              }}
            />
            <button onClick={handleUrlSubmit} style={{ ...btnStyle, height: '30px', padding: '0 10px', width: 'auto', fontSize: '12px' }}>
              Load
            </button>
            {embedUrl && (
              <button onClick={() => setEmbedUrl(null)} style={{ ...btnStyle, height: '30px', width: '30px', fontSize: '12px', color: '#EF4444' }}>
                ✕
              </button>
            )}
          </div>

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
              onRacketMultiplier={handleRacketMultiplier}
              circleSpinning={circleSpinning}
              onCircleSpinningChange={setCircleSpinning}
              circleGapMode={circleGapMode}
              onCircleGapModeChange={setCircleGapMode}
              webcamPipMode={webcamPipMode}
              onWebcamPipModeChange={setWebcamPipMode}
              webcamOpacity={webcamOpacity}
              onWebcamOpacityChange={setWebcamOpacity}
              webcamActive={webcamActive}
            />
          </SidebarSection>

          {/* StroMotion section */}
          <SidebarSection title="StroMotion">
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '9px', color: '#6b7280', lineHeight: 1.4 }}>
                Capture ghost frames from a time range for stroboscopic effect.
              </p>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <label style={{ fontSize: '10px', color: '#374151', minWidth: '40px' }}>Start:</label>
                <input type="number" step="0.1" min="0" value={stroMotionStart}
                  onChange={e => setStroMotionStart(parseFloat(e.target.value) || 0)}
                  style={{ width: '60px', padding: '2px 4px', fontSize: '10px', border: '1px solid #E8E8ED', borderRadius: '4px' }} />
                <label style={{ fontSize: '10px', color: '#374151', minWidth: '25px' }}>End:</label>
                <input type="number" step="0.1" min="0" value={stroMotionEnd}
                  onChange={e => setStroMotionEnd(parseFloat(e.target.value) || 0)}
                  style={{ width: '60px', padding: '2px 4px', fontSize: '10px', border: '1px solid #E8E8ED', borderRadius: '4px' }} />
              </div>
              <div>
                <p style={{ fontSize: '10px', color: '#374151', marginBottom: '2px' }}>Ghosts: {stroMotionCount}</p>
                <input type="range" min="3" max="12" step="1" value={stroMotionCount}
                  onChange={e => setStroMotionCount(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <p style={{ fontSize: '10px', color: '#374151', marginBottom: '2px' }}>Opacity: {Math.round(stroMotionOpacity * 100)}%</p>
                <input type="range" min="15" max="50" step="5" value={Math.round(stroMotionOpacity * 100)}
                  onChange={e => setStroMotionOpacity(Number(e.target.value) / 100)} style={{ width: '100%' }} />
              </div>
              <button
                onClick={() => setStroMotionEnabled(true)}
                disabled={stroMotionProcessing}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                  background: stroMotionProcessing ? '#E5E7EB' : '#35679A', color: stroMotionProcessing ? '#9ca3af' : '#fff',
                  border: 'none', cursor: stroMotionProcessing ? 'not-allowed' : 'pointer',
                }}
              >
                {stroMotionProcessing ? `Capturing… ${stroMotionProgress}%` : '▶ Capture Ghosts'}
              </button>
              {ghostFrames.length > 0 && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#16A34A', fontWeight: 600 }}>✓ {ghostFrames.length} ghosts captured</span>
                  <button
                    onClick={() => { setStroMotionEnabled(false); clearGhosts(); }}
                    style={{ marginLeft: 'auto', fontSize: '10px', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
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
                    circleSpinning={circleSpinning}
                    circleGapMode={circleGapMode}
                    webcamPipMode={webcamPipMode}
                    webcamOpacity={webcamOpacity}
                    stroMotionGhosts={ghostFrames}
                    stroMotionOpacity={stroMotionOpacity}
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

          {/* URL Embed iframe (bottom-right overlay) */}
          {embedUrl && (
            <div style={{
              position: 'absolute',
              bottom: 80, right: 16,
              width: '360px', height: '220px',
              zIndex: 30,
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              border: '2px solid #35679A',
              background: '#000',
              resize: 'both',
            }}>
              {embedUrl.type === 'youtube' && (
                <iframe
                  src={embedUrl.url}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="YouTube embed"
                />
              )}
              {embedUrl.type === 'instagram' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#fff', padding: '8px', textAlign: 'center' }}>
                  <iframe
                    src={embedUrl.url}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    scrolling="no"
                    title="Instagram embed"
                    sandbox="allow-scripts allow-same-origin allow-popups"
                  />
                  <p style={{ fontSize: '9px', color: '#9ca3af', marginTop: '4px' }}>
                    Instagram is view-only. To annotate: ··· → Save Video → upload here.
                  </p>
                </div>
              )}
            </div>
          )}

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
