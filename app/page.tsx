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
import ToolPalette from '@/components/ToolPalette';
import ScreenRecorder from '@/components/ScreenRecorder';
import ExportModal from '@/components/ExportModal';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [drawingOptions, setDrawingOptions] = useState<DrawingOptions>({
    color: '#1E40AF',
    lineWidth: 3,
    fontSize: 24,
  });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 450 });
  const [showExport, setShowExport] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'tools' | 'record'>('tools');

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

  // Webcam PiP overlay
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const webcamPipRef = useRef<HTMLVideoElement>(null);
  const [pipPos, setPipPos] = useState({ x: 16, y: 16 });
  const [pipSize, setPipSize] = useState({ w: 240, h: 135 });
  const pipDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pipResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  useEffect(() => {
    const v = webcamPipRef.current;
    if (!v) return;
    if (webcamStream) {
      v.srcObject = webcamStream;
      v.play().catch(() => {});
    } else {
      v.srcObject = null;
    }
  }, [webcamStream]);

  const onPipDragStart = useCallback((e: React.MouseEvent) => {
    pipDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pipPos.x, origY: pipPos.y };
    e.preventDefault();
  }, [pipPos]);

  const onPipResizeStart = useCallback((e: React.MouseEvent) => {
    pipResizeRef.current = { startX: e.clientX, startY: e.clientY, origW: pipSize.w, origH: pipSize.h };
    e.stopPropagation();
    e.preventDefault();
  }, [pipSize]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (pipDragRef.current) {
        const dx = e.clientX - pipDragRef.current.startX;
        const dy = e.clientY - pipDragRef.current.startY;
        setPipPos({ x: Math.max(0, pipDragRef.current.origX + dx), y: Math.max(0, pipDragRef.current.origY + dy) });
      }
      if (pipResizeRef.current) {
        const dx = e.clientX - pipResizeRef.current.startX;
        const newW = Math.max(120, pipResizeRef.current.origW + dx);
        setPipSize({ w: newW, h: Math.round(newW * 9 / 16) });
      }
    };
    const onUp = () => { pipDragRef.current = null; pipResizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Keep composite canvas up to date for screen recording
  const refreshComposite = useCallback(() => {
    const composite = canvasRef.current?.getCompositeCanvas();
    if (composite) compositeCanvasRef.current = composite;
  }, []);

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

  const getCompositeCanvas = useCallback(() => {
    const c = canvasRef.current?.getCompositeCanvas();
    if (c) compositeCanvasRef.current = c;
    return c ?? null;
  }, []);

  // Quick screenshot: capture and immediately download
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current?.getCompositeCanvas();
    if (!canvas) return;
    downloadDataURL(canvas.toDataURL('image/png'), `coach-lab-${Date.now()}.png`);
  }, []);

  // Continuously refresh composite for screen recording
  useEffect(() => {
    const id = setInterval(refreshComposite, 1000 / 30);
    return () => clearInterval(id);
  }, [refreshComposite]);

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
            />
          )}

          {sidebarTab === 'record' && (
            <div className="p-2">
              <ScreenRecorder
                compositeCanvasRef={compositeCanvasRef}
                onWebcamStreamChange={setWebcamStream}
              />
            </div>
          )}

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
              />
            </div>

            {/* Webcam PiP overlay — shown while recording with webcam */}
            {webcamStream && (
              <div
                className="absolute z-30 rounded-xl overflow-hidden shadow-2xl border-2 border-blue-400 select-none"
                style={{ left: pipPos.x, top: pipPos.y, width: pipSize.w, height: pipSize.h, cursor: 'grab' }}
                onMouseDown={onPipDragStart}
              >
                <video
                  ref={webcamPipRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                {/* Resize handle — bottom-right corner */}
                <div
                  className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize bg-blue-500/70 rounded-tl-md flex items-center justify-center"
                  onMouseDown={onPipResizeStart}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                    <path d="M10 10L10 5L5 10Z" />
                    <path d="M10 10L10 0L0 10Z" fillOpacity="0.4" />
                  </svg>
                </div>
                <div className="absolute top-1 left-1.5 text-[9px] text-white/80 font-semibold tracking-wide pointer-events-none select-none bg-black/30 rounded px-1">
                  CAM
                </div>
              </div>
            )}
          </div>

          {/* Hint bar */}
          <div className="shrink-0 flex items-center gap-4 text-[10px] text-gray-400 px-1 flex-wrap">
            <span>Space: play/pause</span>
            <span>Shift+←/→: frame step</span>
            <span>←/→: 5s skip</span>
            <span>Ctrl+Z: undo</span>
            <span>Ctrl+Y: redo</span>
            <span className="text-cyan-500">Skeleton: pause &amp; click joints</span>
            <span className="text-yellow-500">Ball Trail: click ball each frame</span>
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