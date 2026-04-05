'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Camera, Download, GripVertical } from 'lucide-react';
import VideoPlayer from '@/components/VideoPlayer';
import CanvasOverlay, { type CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode } from '@/components/ToolPalette';
import ScreenRecorder from '@/components/ScreenRecorder';
import ExportModal from '@/components/ExportModal';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';
import { useRecording } from '@/contexts/RecordingContext';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  const { registerCompositeCanvas } = useRecording();

  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [drawingOptions, setDrawingOptions] = useState<DrawingOptions>({
    color: '#1E40AF',
    lineWidth: 3,
    fontSize: 24,
  });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 450 });
  const [showExport, setShowExport] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'tools' | 'record'>('tools');
  const [ballTrailMode, setBallTrailMode] = useState<BallTrailMode>('short-tail');

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(160);
  const sidebarResizingRef = useRef(false);
  const sidebarResizeStartXRef = useRef(0);
  const sidebarResizeStartWRef = useRef(160);

  const onSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    sidebarResizingRef.current = true;
    sidebarResizeStartXRef.current = e.clientX;
    sidebarResizeStartWRef.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!sidebarResizingRef.current) return;
      const delta = e.clientX - sidebarResizeStartXRef.current;
      setSidebarWidth(Math.max(120, Math.min(320, sidebarResizeStartWRef.current + delta)));
    };
    const onMouseUp = () => { sidebarResizingRef.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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

  const handleVideoReady = useCallback(() => {
    updateSize();
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

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 bg-white z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Camera size={14} className="text-white" />
          </div>
          <span className="text-base font-bold text-gray-800 tracking-tight">
            Coach Lab
          </span>
          <span className="text-xs text-gray-400 font-medium hidden sm:block">
            Video Analysis Tool
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleScreenshot}
            className="btn-outline gap-1.5 text-sm"
            title="Save screenshot of current frame with drawings"
          >
            <Camera size={14} />
            Screenshot
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="btn-outline gap-1.5 text-sm"
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: tools / record */}
        <aside
          className="shrink-0 flex flex-col border-r border-gray-100 bg-gray-50 overflow-y-auto relative"
          style={{ width: sidebarWidth }}
        >
          {/* Tab switcher */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setSidebarTab('tools')}
              className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                sidebarTab === 'tools'
                  ? 'bg-white text-blue-600 border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Tools
            </button>
            <button
              onClick={() => setSidebarTab('record')}
              className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                sidebarTab === 'record'
                  ? 'bg-white text-blue-600 border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Rec
            </button>
          </div>

          {sidebarTab === 'tools' && (
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
          )}

          {/* ScreenRecorder is always mounted to preserve recording state across tab switches */}
          <div className={`${sidebarTab === 'record' ? 'block' : 'hidden'} p-2`}>
            <ScreenRecorder />
          </div>

          {/* Resize handle */}
          <div
            className="absolute top-0 right-0 h-full w-2 cursor-col-resize flex items-center justify-center hover:bg-blue-100/60 z-20 group"
            onMouseDown={onSidebarMouseDown}
            title="Drag to resize panel"
          >
            <GripVertical size={12} className="text-gray-300 group-hover:text-blue-400" />
          </div>
        </aside>

        {/* Centre: video + canvas overlay */}
        <main className="flex-1 flex flex-col overflow-hidden p-3 gap-2 min-w-0">
          {/* Canvas area */}
          <div className="flex-1 relative min-h-0">
            <VideoPlayer
              videoRef={videoRef}
              containerRef={containerRef}
              onVideoReady={handleVideoReady}
            />
            {/* Canvas overlay positioned exactly over the video container (excludes controls bar) */}
            <div
              className="absolute inset-x-0 top-0 z-10"
              style={{ height: canvasSize.height }}
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
          </div>

          {/* Hint bar */}
          <div className="shrink-0 flex items-center gap-4 text-[10px] text-gray-400 px-1 flex-wrap">
            <span>Space: play/pause</span>
            <span>Shift+←/→: frame step</span>
            <span>←/→: 5s skip</span>
            <span>Ctrl+Z: undo</span>
            <span>Ctrl+Y: redo</span>
            <span className="text-cyan-500">Skeleton: AI auto-detects pose</span>
            <span className="text-yellow-500">Ball Trail: auto-tracks + click to add</span>
            <span className="text-purple-400">Swing Path: dbl-click or long-press to end</span>
            <span className="text-amber-400">Angle: drag 3rd point for live preview</span>
          </div>
        </main>
      </div>

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