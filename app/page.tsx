'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Camera, Download, GripVertical, Upload } from 'lucide-react';
import CanvasOverlay, { type CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode } from '@/components/ToolPalette';
import ScreenRecorder from '@/components/ScreenRecorder';
import ExportModal from '@/components/ExportModal';
import PlaybackControls from '@/components/PlaybackControls';
import { SidebarSection } from '@/components/SidebarSection';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';
import { useRecording } from '@/contexts/RecordingContext';
import { useCoachingStore } from '@/stores/coachingStore';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { registerCompositeCanvas } = useRecording();
  const isRecording = useCoachingStore((s) => s.isRecording);

  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [drawingOptions, setDrawingOptions] = useState<DrawingOptions>({
    color: '#1E40AF',
    lineWidth: 3,
    fontSize: 24,
  });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 450 });
  const [showExport, setShowExport] = useState(false);
  const [ballTrailMode, setBallTrailMode] = useState<BallTrailMode>('short-tail');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(240);

  const onSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - resizeStartXRef.current;
      setSidebarWidth(Math.max(180, Math.min(360, resizeStartWRef.current + delta)));
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  // Register the composite canvas getter with the RecordingContext
  const getCompositeCanvas = useCallback(() => {
    return canvasRef.current?.getCompositeCanvas() ?? null;
  }, []);

  useEffect(() => {
    registerCompositeCanvas(getCompositeCanvas);
  }, [registerCompositeCanvas, getCompositeCanvas]);

  // Measure container and update canvas size
  const updateSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
  }, []);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  const handleOptionsChange = useCallback((opts: Partial<DrawingOptions>) => {
    setDrawingOptions((prev) => ({ ...prev, ...opts }));
  }, []);

  // Undo / redo keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        canvasRef.current?.undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.shiftKey && e.key === 'z'))
      ) {
        e.preventDefault();
        canvasRef.current?.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quick screenshot: capture and immediately download
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current?.getCompositeCanvas();
    if (!canvas) return;
    downloadDataURL(canvas.toDataURL('image/png'), `coach-lab-${Date.now()}.png`);
  }, []);

  // Video upload handler
  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      if (videoRef.current) {
        videoRef.current.src = url;
      }
      // Reset canvas size after video loads
      setTimeout(updateSize, 100);
    }
  }, [updateSize]);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* ── Header ── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '48px',
        borderBottom: 'var(--border)',
        background: 'var(--bg-primary)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Camera size={14} color="#fff" />
          </div>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Coach Lab
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500 }} className="hidden sm:block">
            Video Analysis Tool
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'var(--border)',
              background: 'var(--bg-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text-primary)',
              transition: 'var(--transition)',
            }}
          >
            <Upload size={14} />
            {videoSrc ? 'Replace Video' : 'Upload Video'}
          </button>
          <button
            onClick={handleScreenshot}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'var(--border)',
              background: 'var(--bg-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text-primary)',
              transition: 'var(--transition)',
            }}
            title="Save screenshot of current frame with drawings"
          >
            <Camera size={14} />
            Screenshot
          </button>
          <button
            onClick={() => setShowExport(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#fff',
              transition: 'var(--transition)',
            }}
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left sidebar */}
        <aside
          style={{
            width: sidebarWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: 'var(--border)',
            background: 'var(--bg-secondary)',
            overflowY: 'auto',
            position: 'relative',
          }}
        >
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
            />
          </SidebarSection>

          <SidebarSection title="Record" defaultOpen={false}>
            {/* ScreenRecorder is always mounted to preserve recording state */}
            <ScreenRecorder />
          </SidebarSection>

          {/* Resize handle */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              height: '100%',
              width: '8px',
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
            }}
            onMouseDown={onSidebarMouseDown}
            title="Drag to resize panel"
          >
            <GripVertical size={12} style={{ color: 'var(--text-tertiary)' }} />
          </div>
        </aside>

        {/* Centre: video + canvas overlay + controls */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Video + canvas area */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0, background: '#000' }}>
            <div
              ref={containerRef}
              style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {!videoSrc ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#9ca3af',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    background: '#1f2937',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Upload size={36} color="#9ca3af" />
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>Click to upload video</span>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>MP4, WebM, MOV supported</span>
                </button>
              ) : (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  onLoadedMetadata={updateSize}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                  playsInline
                />
              )}
            </div>

            {/* Canvas overlay */}
            {videoSrc && (
              <div
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: canvasSize.height, zIndex: 10 }}
              >
                <CanvasOverlay
                  ref={canvasRef}
                  videoRef={videoRef}
                  activeTool={activeTool}
                  drawingOptions={drawingOptions}
                  containerWidth={canvasSize.width}
                  containerHeight={canvasSize.height}
                  ballTrailMode={ballTrailMode}
                />
              </div>
            )}
          </div>

          {/* Playback controls */}
          <PlaybackControls videoRef={videoRef} />

          {/* Hint bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '4px 16px',
            fontSize: '10px',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-secondary)',
            borderTop: 'var(--border)',
            flexWrap: 'wrap',
            flexShrink: 0,
          }}>
            <span>Space: play/pause</span>
            <span>J/K/L: 0.5×/1×/2×</span>
            <span>←/→: frame step</span>
            <span>Ctrl+Z: undo</span>
            <span>Ctrl+Y: redo</span>
            <span style={{ color: '#06b6d4' }}>Skeleton: AI auto-detects pose</span>
            <span style={{ color: '#eab308' }}>Ball Trail: auto-tracks + click to add</span>
            <span style={{ color: '#a855f7' }}>Swing Path: dbl-click or long-press to end</span>
            <span style={{ color: '#f59e0b' }}>Angle: drag 3rd point for live preview</span>
          </div>
        </main>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        style={{ display: 'none' }}
        onChange={handleVideoUpload}
      />

      {/* Export modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        getCompositeCanvas={getCompositeCanvas}
        videoRef={videoRef}
      />
    </div>
  );
}