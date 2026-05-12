'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { Camera, MoreHorizontal, Upload, Menu } from 'lucide-react';
import type { CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode, type WebcamPipMode } from '@/components/ToolPalette';
import PreciseTimeline from '@/components/PreciseTimeline';
import ScreenRecorder from '@/components/ScreenRecorder';
import MobileToolStrip from '@/components/MobileToolStrip';
import WebcamDropdown from '@/components/WebcamDropdown';
import PrecisionDrawInstructions, {
  hasSeenPrecisionInstructions,
  markPrecisionInstructionsSeen,
} from '@/components/PrecisionDrawInstructions';
import YouTubeEmbed from '@/components/YouTubeEmbed';
import EmbedCapturePanel from '@/components/EmbedCapturePanel';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL } from '@/lib/drawingTools';
import { useStroMotion } from '@/hooks/useStroMotion';
import { normalizeWebUrlInput, resolveEmbedTarget } from '@/lib/embedUrl';
import {
  createHtml5VideoController,
  createYoutubeIframeController,
  type VideoController,
} from '@/lib/videoController';
import { resolveYoutubeForAnalysis } from '@/app/actions/youtubeResolve';
import { runEmbedTabCaptureFlow } from '@/lib/embedTabCaptureFlow';
import { getTabCaptureStream, stopAllTracks } from '@/lib/tabCaptureRecording';
import { convertWebmBlobToMp4, disposeFfmpegWasm } from '@/lib/ffmpegWebmToMp4';
import SaveReportModal from '@/components/shared/SaveReportModal';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';

// Dynamic import prevents TensorFlow / Fabric from loading server-side
const CanvasOverlay = dynamic(() => import('@/components/Canvas'), { ssr: false });

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  borderRadius: '12px',
  border: '1px solid #E5E5E5',
  background: '#FFFFFF',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#1A1A1A',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

export default function Home() {
  const LEFT_TOOLBAR_W = 68;
  /** Narrower floating rail in 9:16 preview so more pixels stay on the “phone” */
  const REELS_TOOLBAR_W = 46;

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
  const micStreamRef    = useRef<MediaStream | null>(null);
  // Legacy YouTube iframe player ref removed — URL workflow uses <video>.
  const lastBlobUrlARef = useRef<string | null>(null);
  const lastBlobUrlBRef = useRef<string | null>(null);
  const ytPlayerARef = useRef<any>(null);
  const ytPlayerBRef = useRef<any>(null);
  const playbackControllerARef = useRef<VideoController | null>(null);
  const playbackControllerBRef = useRef<VideoController | null>(null);
  const captureShellRef = useRef<HTMLDivElement | null>(null);
  const captureShellRefB = useRef<HTMLDivElement | null>(null);
  const sessionCaptureBlobRef = useRef<Blob | null>(null);
  /** Converted MP4 for download (original WebM stays in sessionCaptureBlobRef for playback). */
  const sessionMp4BlobRef = useRef<Blob | null>(null);
  const captureMp4ConversionGenRef = useRef(0);

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool]       = useState<ToolType>('pen');
  const [drawingOptions, setDrawingOptions] = useState<DrawingOptions>({
    color: '#F8F8F8',
    lineWidth: 3,
    fontSize: 24,
    dashed: false,
    arrowAtEnd: false,
  });
  const [canvasSize, setCanvasSize]       = useState({ width: 800, height: 450 });
  const [videoSrc, setVideoSrc]           = useState<string | null>(null);
  const [videoSrcB, setVideoSrcB]         = useState<string | null>(null);
  const [canvasSizeB, setCanvasSizeB]     = useState({ width: 800, height: 450 });
  const [ballTrailMode, setBallTrailMode]  = useState<BallTrailMode>('comet');
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [layoutMode, setLayoutMode]       = useState<'youtube' | 'reels'>('youtube');
  const [webcamActive, setWebcamActive]   = useState(false);
  const [micActive, setMicActive]         = useState(false);
  const [isRecording, setIsRecording]     = useState(false);
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
  const [videoBOffset, setVideoBOffset]   = useState(0);
  const [videoBDuration, setVideoBDuration] = useState(0);
  const [playBothEnabled, setPlayBothEnabled] = useState(false);
  const [circleSpinning, setCircleSpinning] = useState(false);
  const [circleGapMode, setCircleGapMode]   = useState(false);
  const [rect3d, setRect3d]                 = useState(false);
  const [triangle3d, setTriangle3d]         = useState(false);
  const [skeletonShowAngles, setSkeletonShowAngles] = useState(true);
  const [skeletonShowHeadLine, setSkeletonShowHeadLine] = useState(false);
  const [skeletonClassicColors, setSkeletonClassicColors] = useState(true);
  const [skeletonShowRightArm, setSkeletonShowRightArm] = useState(true);
  const [skeletonShowLeftArm, setSkeletonShowLeftArm] = useState(true);
  const [skeletonShowRightLeg, setSkeletonShowRightLeg] = useState(true);
  const [skeletonShowLeftLeg, setSkeletonShowLeftLeg] = useState(true);
  const [ballSampleMode, setBallSampleMode] = useState(false);
  const [webcamPipMode, setWebcamPipMode]   = useState<WebcamPipMode>('rectangle');
  const [webcamOpacity, setWebcamOpacity]   = useState(1);
  const [urlInput, setUrlInput]             = useState('');
  const [urlTarget, setUrlTarget]           = useState<'A' | 'B'>('A');
  /** Which stream the unified timeline controls (AB = sync both for uploaded HTML5 pairs). */
  const [playbackTarget, setPlaybackTarget] = useState<'A' | 'B' | 'AB'>('A');
  const [desktopReelsMenuOpen, setDesktopReelsMenuOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Selfie-segmentation cutout for webcam PiP */
  const [webcamCutout, setWebcamCutout]     = useState(false);
  const [panModeEnabled, setPanModeEnabled] = useState(false);
  const [youtubeVideoIdA, setYoutubeVideoIdA] = useState<string | null>(null);
  const [youtubeVideoIdB, setYoutubeVideoIdB] = useState<string | null>(null);
  const [genericEmbedSrcA, setGenericEmbedSrcA] = useState<string | null>(null);
  const [genericEmbedSrcB, setGenericEmbedSrcB] = useState<string | null>(null);

  const hasVideoBContent = useMemo(
    () => !!(videoSrcB || youtubeVideoIdB || genericEmbedSrcB),
    [videoSrcB, youtubeVideoIdB, genericEmbedSrcB],
  );

  /** Embed URL flow: iframe / YouTube API ready before showing Capture */
  const [embedReadyA, setEmbedReadyA] = useState(false);
  const [embedReadyB, setEmbedReadyB] = useState(false);

  /** AB enables dual sync for uploaded HTML5 pairs (embed/YouTube ignore the sync loop). */
  useEffect(() => {
    if (!hasVideoBContent) {
      setPlayBothEnabled(false);
      return;
    }
    setPlayBothEnabled(playbackTarget === 'AB');
  }, [hasVideoBContent, playbackTarget]);

  useEffect(() => {
    if (!hasVideoBContent) setPlaybackTarget('A');
  }, [hasVideoBContent]);

  useEffect(() => {
    setEmbedReadyA(false);
  }, [youtubeVideoIdA, genericEmbedSrcA, videoSrc]);

  useEffect(() => {
    if (videoSrc || (!youtubeVideoIdA && !genericEmbedSrcA)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setEmbedReadyA(true);
    }, 3000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [youtubeVideoIdA, genericEmbedSrcA, videoSrc]);

  useEffect(() => {
    setEmbedReadyB(false);
  }, [youtubeVideoIdB, genericEmbedSrcB, videoSrcB]);

  useEffect(() => {
    if (videoSrcB || (!youtubeVideoIdB && !genericEmbedSrcB)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setEmbedReadyB(true);
    }, 3000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [youtubeVideoIdB, genericEmbedSrcB, videoSrcB]);

  const [embedCaptureRecording, setEmbedCaptureRecording] = useState(false);
  /** Which panel (A/B) is running tab capture — drives Canvas to paint the live capture instead of YouTube thumbnail pose. */
  const [embedCapturePanelId, setEmbedCapturePanelId] = useState<'A' | 'B' | null>(null);
  const [captureProgress01, setCaptureProgress01] = useState(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [showCaptureSaveToast, setShowCaptureSaveToast] = useState(false);
  const [captureYoutubeBusy, setCaptureYoutubeBusy] = useState(false);
  const [captureSaveModalOpen, setCaptureSaveModalOpen] = useState(false);
  const [captureYoutubeUrl, setCaptureYoutubeUrl] = useState<string | null>(null);
  /** Post-capture MP4 prep: button stays disabled until ready_mp4 or ready_webm (fallback). */
  const [captureDownloadStatus, setCaptureDownloadStatus] = useState<
    'idle' | 'preparing' | 'ready_mp4' | 'ready_webm'
  >('idle');
  const [captureToast, setCaptureToast] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureRecordingElapsedSec, setCaptureRecordingElapsedSec] = useState(0);
  const [captureCountdown, setCaptureCountdown] = useState<number | null>(null);
  const [captureStepStatus, setCaptureStepStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!captureBusy || !embedCaptureRecording) {
      setCaptureRecordingElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const iv = window.setInterval(() => {
      setCaptureRecordingElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    return () => window.clearInterval(iv);
  }, [captureBusy, embedCaptureRecording]);
  /** True when Safari (or any browser) blocked video.play() and we need a user-gesture tap */
  const [showTapToPlay, setShowTapToPlay]   = useState(false);
  /** Drag-over state for the two video panels */
  const [isDragOverA, setIsDragOverA]       = useState(false);
  const [isDragOverB, setIsDragOverB]       = useState(false);
  const [isMobile, setIsMobile]             = useState(false);
  /** Large tap targets only on real phones — desktop 9:16 preview keeps compact UI */
  const touchChrome                         = isMobile;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const headerBtnStyle = useMemo((): React.CSSProperties => ({
    ...btnStyle,
    minHeight: touchChrome ? 44 : 36,
    minWidth: touchChrome ? 44 : undefined,
    padding: touchChrome ? '10px 14px' : btnStyle.padding,
    fontSize: touchChrome ? 14 : 13,
    touchAction: 'manipulation',
  }), [touchChrome]);

  // StroMotion state
  const [stroMotionEnabled, setStroMotionEnabled] = useState(false);
  const [stroMotionStart, setStroMotionStart]     = useState(0);
  const [stroMotionEnd, setStroMotionEnd]         = useState(3);
  const [stroMotionCount, setStroMotionCount]     = useState(6);
  const [stroMotionOpacity, setStroMotionOpacity] = useState(0.3);
  const [stroMotionRegion, setStroMotionRegion]   = useState<{ x: number; y: number; w: number; h: number } | undefined>(undefined);

  // Derived: skeleton / ball trail enabled when their tool is active
  const skeletonEnabled  = activeTool === 'skeleton';
  const ballTrailEnabled = activeTool === 'ballShadow';

  const skeletonParts = useMemo(() => ({
    rightArm: skeletonShowRightArm,
    leftArm: skeletonShowLeftArm,
    rightLeg: skeletonShowRightLeg,
    leftLeg: skeletonShowLeftLeg,
  }), [skeletonShowRightArm, skeletonShowLeftArm, skeletonShowRightLeg, skeletonShowLeftLeg]);

  const html5ControllerA = useMemo(() => createHtml5VideoController(videoRef), []);
  const ytIframeControllerA = useMemo(() => createYoutubeIframeController(ytPlayerARef), []);
  const html5ControllerB = useMemo(() => createHtml5VideoController(videoRefB), []);
  const ytIframeControllerB = useMemo(() => createYoutubeIframeController(ytPlayerBRef), []);

  const handleToolChange = useCallback((t: ToolType) => {
    setActiveTool(t);
  }, []);

  // StroMotion hook
  const stroMotionConfig = {
    enabled: stroMotionEnabled && !youtubeVideoIdA && !youtubeVideoIdB && !genericEmbedSrcA && !genericEmbedSrcB,
    startFrame: Math.round(stroMotionStart * 30),
    endFrame: Math.round(stroMotionEnd * 30),
    ghostCount: stroMotionCount,
    opacity: stroMotionOpacity,
    region: stroMotionRegion,
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

  const attachPanelAContainer = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    (captureShellRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, []);

  const attachPanelBContainer = useCallback((el: HTMLDivElement | null) => {
    (containerRefB as React.MutableRefObject<HTMLDivElement | null>).current = el;
    (captureShellRefB as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, []);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  /** Drop FFmpeg WASM when leaving the page so memory does not linger after tab close. */
  useEffect(() => {
    const onBeforeUnload = () => disposeFfmpegWasm();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      disposeFfmpegWasm();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Mobile + tablet: floating tool strip (precision toggle lives here; hidden on desktop). */
  const [showMobileToolStrip, setShowMobileToolStrip] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const fn = () => setShowMobileToolStrip(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const [precisionDrawEnabled, setPrecisionDrawEnabled] = useState(false);
  const [precisionInstructionsOpen, setPrecisionInstructionsOpen] = useState(false);

  const handlePrecisionDrawToggle = useCallback(() => {
    setPrecisionDrawEnabled((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && !hasSeenPrecisionInstructions()) {
        queueMicrotask(() => setPrecisionInstructionsOpen(true));
      }
      return next;
    });
  }, []);

  const dismissPrecisionInstructions = useCallback(() => {
    markPrecisionInstructionsSeen();
    setPrecisionInstructionsOpen(false);
  }, []);

  const showPrecisionInstructionsAgain = useCallback(() => {
    setPrecisionInstructionsOpen(true);
  }, []);

  useEffect(() => {
    if (!showMobileToolStrip) setPrecisionDrawEnabled(false);
  }, [showMobileToolStrip]);

  // Mobile: auto-switch layout based on device orientation (portrait=reels, landscape=youtube)
  useEffect(() => {
    if (!isMobile) return;
    const mq = window.matchMedia('(orientation: portrait)');
    const apply = () => setLayoutMode(mq.matches ? 'reels' : 'youtube');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [isMobile]);

  useEffect(() => {
    updateSizeB();
    const ro = new ResizeObserver(updateSizeB);
    if (containerRefB.current) ro.observe(containerRefB.current);
    return () => ro.disconnect();
  }, [updateSizeB, videoSrcB]);

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

  // ── Safari autoplay: dismiss "Tap to Play" overlay once video actually plays ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setShowTapToPlay(false);
    video.addEventListener('play', onPlay);
    return () => video.removeEventListener('play', onPlay);
  // videoRef is stable (never reassigned), but listing it satisfies the linter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  useEffect(() => {
    if (!youtubeVideoIdA && !youtubeVideoIdB) return;
    const t = window.setInterval(() => {
      const a = ytPlayerARef.current?.getPlayerState?.();
      const b = ytPlayerBRef.current?.getPlayerState?.();
      if (a === 1 || b === 1) setShowTapToPlay(false);
    }, 400);
    return () => window.clearInterval(t);
  }, [youtubeVideoIdA, youtubeVideoIdB]);

  /** Called by PlaybackControls when play() is rejected (e.g. Safari NotAllowedError) */
  const handlePlayBlocked = useCallback(() => {
    setShowTapToPlay(true);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    showControls();
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, [showControls]);

  const cleanupVideoEl = useCallback((v: HTMLVideoElement | null) => {
    if (!v) return;
    try { v.pause(); } catch {}
    try { v.removeAttribute('src'); } catch {}
    try { (v as any).srcObject = null; } catch {}
    try { v.load(); } catch {}
  }, []);

  const revokeBlobUrl = useCallback((url: string | null) => {
    if (!url) return;
    if (!url.startsWith('blob:')) return;
    try { URL.revokeObjectURL(url); } catch {}
  }, []);

  const resetSession = useCallback(() => {
    disposeFfmpegWasm();
    setCaptureBusy(false);
    ytPlayerARef.current = null;
    ytPlayerBRef.current = null;
    revokeBlobUrl(lastBlobUrlARef.current);
    revokeBlobUrl(lastBlobUrlBRef.current);
    lastBlobUrlARef.current = null;
    lastBlobUrlBRef.current = null;
    setVideoSrc(null);
    setVideoSrcB(null);
    setYoutubeVideoIdA(null);
    setYoutubeVideoIdB(null);
    setGenericEmbedSrcA(null);
    setGenericEmbedSrcB(null);
    setEmbedCaptureRecording(false);
    setEmbedCapturePanelId(null);
    setCaptureProgress01(0);
    setShowCaptureSaveToast(false);
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
    captureMp4ConversionGenRef.current += 1;
    setCaptureDownloadStatus('idle');
    setShowTapToPlay(false);
    setProcessingStatus(null);
    setVideoBLoaded(false);
    setStroMotionEnabled(false);
    setStroMotionRegion(undefined);
    clearGhosts();
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current = null;
    setWebcamActive(false);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setMicActive(false);
    setUrlInput('');
    setPlaybackTarget('A');
    setWebcamCutout(false);
    setCaptureError(null);
    cleanupVideoEl(videoRef.current);
    cleanupVideoEl(videoRefB.current);
    canvasRef.current?.clearAll();
    canvasRefB.current?.clearAll();
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl]);

  /** Full page reload should not inherit URL field or stale session state */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type === 'reload') {
        setUrlInput('');
        resetSession();
      }
    } catch {
      const legacy = performance as Performance & { navigation?: { type?: number } };
      if (legacy.navigation?.type === 1) {
        setUrlInput('');
        resetSession();
      }
    }
  }, [resetSession]);

  // ── Video upload ──────────────────────────────────────────────────────────
  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    revokeBlobUrl(lastBlobUrlARef.current);
    const url = URL.createObjectURL(file);
    lastBlobUrlARef.current = url;
    setVideoSrc(url);
    setYoutubeVideoIdA(null);
    setGenericEmbedSrcA(null);
    setShowTapToPlay(false);
    if (videoRef.current) {
      cleanupVideoEl(videoRef.current);
      videoRef.current.src = url;
      videoRef.current.load();
    }
    // Reset AI caches for new video
    setProcessingStatus(null);
    setStroMotionEnabled(false);
    setStroMotionRegion(undefined);
    clearGhosts();
    canvasRef.current?.clearAll();
    // Allow uploading the same file again without needing a page refresh.
    e.target.value = '';
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl]);

  const handleVideoUploadB = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    revokeBlobUrl(lastBlobUrlBRef.current);
    const url = URL.createObjectURL(file);
    lastBlobUrlBRef.current = url;
    setVideoSrcB(url);
    setYoutubeVideoIdB(null);
    setGenericEmbedSrcB(null);
    if (videoRefB.current) {
      cleanupVideoEl(videoRefB.current);
      videoRefB.current.src = url;
      videoRefB.current.load();
    }
    setVideoBLoaded(false);
    canvasRefB.current?.clearAll();
    e.target.value = '';
  }, [cleanupVideoEl, revokeBlobUrl]);

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  const handleDragOverA = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragOverA(true);
  }, []);
  const handleDragLeaveA = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverA(false);
  }, []);
  const handleDropA = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverA(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    revokeBlobUrl(lastBlobUrlARef.current);
    const url = URL.createObjectURL(file);
    lastBlobUrlARef.current = url;
    setVideoSrc(url);
    setYoutubeVideoIdA(null);
    setGenericEmbedSrcA(null);
    setShowTapToPlay(false);
    if (videoRef.current) { cleanupVideoEl(videoRef.current); videoRef.current.src = url; videoRef.current.load(); }
    setProcessingStatus(null);
    setStroMotionEnabled(false);
    setStroMotionRegion(undefined);
    clearGhosts();
    canvasRef.current?.clearAll();
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl]);

  const handleDragOverB = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragOverB(true);
  }, []);
  const handleDragLeaveB = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverB(false);
  }, []);
  const handleDropB = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverB(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    revokeBlobUrl(lastBlobUrlBRef.current);
    const url = URL.createObjectURL(file);
    lastBlobUrlBRef.current = url;
    setVideoSrcB(url);
    setYoutubeVideoIdB(null);
    setGenericEmbedSrcB(null);
    if (videoRefB.current) { cleanupVideoEl(videoRefB.current); videoRefB.current.src = url; videoRefB.current.load(); }
    setVideoBLoaded(false);
    canvasRefB.current?.clearAll();
  }, [cleanupVideoEl, revokeBlobUrl]);

  // ── Video B sync engine (keeps B in lockstep with A) ──────────────────────
  // Two layers:
  //  1. Event listeners on vA (play/pause/seeking/ratechange) fire synchronously
  //     whenever PreciseTimeline or keyboard shortcuts act on Video A, giving
  //     instant mirroring to Video B with zero frame delay.
  //  2. A single rAF drift-correction loop catches any residual timing skew
  //     during continuous playback (threshold: 100 ms).

  useEffect(() => {
    const vA = videoRef.current;
    const vB = videoRefB.current;
    if (youtubeVideoIdA || genericEmbedSrcA) return;
    if (!vA || !vB || !videoBLoaded) return;
    if (!playBothEnabled) return;

    const DRIFT_THRESHOLD = 0.1;
    let playPendingB = false;
    let rafId: number;

    const bTarget = () => vA.currentTime - videoBOffset;
    const bInRange = (t: number) => t >= 0 && t <= videoBDuration;

    // ── Event handlers: respond instantly to user actions on A ──

    const onPlayA = () => {
      const t = bTarget();
      if (bInRange(t) && vB.paused && !playPendingB) {
        playPendingB = true;
        vB.play()
          .then(() => { playPendingB = false; })
          .catch(() => { playPendingB = false; });
      }
    };

    const onPauseA = () => {
      if (!vB.paused) vB.pause();
      playPendingB = false;
    };

    const onSeekingA = () => {
      const t = bTarget();
      if (bInRange(t)) {
        vB.currentTime = t;
      } else if (t < 0) {
        vB.currentTime = 0;
        if (!vB.paused) vB.pause();
      }
    };

    const onRateA = () => {
      vB.playbackRate = vA.playbackRate;
    };

    vA.addEventListener('play', onPlayA);
    vA.addEventListener('pause', onPauseA);
    vA.addEventListener('seeking', onSeekingA);
    vA.addEventListener('ratechange', onRateA);

    // ── Single rAF drift-correction loop ──

    const correctDrift = () => {
      const t = bTarget();

      if (vB.playbackRate !== vA.playbackRate) {
        vB.playbackRate = vA.playbackRate;
      }

      if (!vA.paused) {
        if (bInRange(t)) {
          const drift = Math.abs(vB.currentTime - t);
          if (drift > DRIFT_THRESHOLD) vB.currentTime = t;
          if (vB.paused && !playPendingB) {
            playPendingB = true;
            vB.play()
              .then(() => { playPendingB = false; })
              .catch(() => { playPendingB = false; });
          }
        } else {
          if (!vB.paused) vB.pause();
          playPendingB = false;
          if (t < 0) vB.currentTime = 0;
        }
      } else {
        if (!vB.paused) vB.pause();
        playPendingB = false;
      }

      rafId = requestAnimationFrame(correctDrift);
    };

    // Initial alignment
    vB.playbackRate = vA.playbackRate;
    const t0 = bTarget();
    if (bInRange(t0)) vB.currentTime = t0;

    rafId = requestAnimationFrame(correctDrift);

    return () => {
      cancelAnimationFrame(rafId);
      vA.removeEventListener('play', onPlayA);
      vA.removeEventListener('pause', onPauseA);
      vA.removeEventListener('seeking', onSeekingA);
      vA.removeEventListener('ratechange', onRateA);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoBLoaded, videoBOffset, videoBDuration, playBothEnabled, youtubeVideoIdA, genericEmbedSrcA]);

  // ── Webcam ────────────────────────────────────────────────────────────────
  const stopWebcam = useCallback(() => {
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    setWebcamActive(false);
  }, []);

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

  const toggleWebcam = useCallback(async () => {
    if (webcamActive) stopWebcam();
    else await startWebcam();
  }, [webcamActive, startWebcam, stopWebcam]);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicActive(true);
    } catch (err) {
      console.error('[page] Mic access denied:', err);
      alert('Could not access microphone. Please check browser permissions.');
    }
  }, []);

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setMicActive(false);
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
  const getMicStream     = useCallback(() => micStreamRef.current, []);
  const getCropRegion    = useCallback(() => canvasRef.current?.getCropRegion() ?? null, []);

  // Keep ScreenRecorder informed when recording state changes so Canvas draws PiP
  const handleRecordingChange = useCallback((recording: boolean) => {
    setIsRecording(recording);
  }, []);

  const removeVideoA = useCallback(() => {
    revokeBlobUrl(lastBlobUrlARef.current);
    lastBlobUrlARef.current = null;
    setVideoSrc(null);
    setYoutubeVideoIdA(null);
    setGenericEmbedSrcA(null);
    ytPlayerARef.current = null;
    setShowTapToPlay(false);
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
    setCaptureDownloadStatus('idle');
    cleanupVideoEl(videoRef.current);
    canvasRef.current?.clearAll();
    setCaptureError(null);
  }, [cleanupVideoEl, revokeBlobUrl]);

  const removeVideoB = useCallback(() => {
    revokeBlobUrl(lastBlobUrlBRef.current);
    lastBlobUrlBRef.current = null;
    setVideoSrcB(null);
    setYoutubeVideoIdB(null);
    setGenericEmbedSrcB(null);
    ytPlayerBRef.current = null;
    setVideoBLoaded(false);
    cleanupVideoEl(videoRefB.current);
    canvasRefB.current?.clearAll();
    setCaptureError(null);
  }, [cleanupVideoEl, revokeBlobUrl]);

  const iframeLoadTimerARef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGenericEmbedIframeLoadA = useCallback(() => {
    if (!youtubeVideoIdA && genericEmbedSrcA) {
      if (iframeLoadTimerARef.current) clearTimeout(iframeLoadTimerARef.current);
      iframeLoadTimerARef.current = setTimeout(() => setEmbedReadyA(true), 3000);
    }
  }, [youtubeVideoIdA, genericEmbedSrcA]);

  const iframeLoadTimerBRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGenericEmbedIframeLoadB = useCallback(() => {
    if (!youtubeVideoIdB && genericEmbedSrcB) {
      if (iframeLoadTimerBRef.current) clearTimeout(iframeLoadTimerBRef.current);
      iframeLoadTimerBRef.current = setTimeout(() => setEmbedReadyB(true), 3000);
    }
  }, [youtubeVideoIdB, genericEmbedSrcB]);

  const handleOptionsChange = useCallback((opts: Partial<DrawingOptions>) => {
    setDrawingOptions(prev => ({ ...prev, ...opts }));
  }, []);

  // ── Auto Swing Detection ──────────────────────────────────────────────────
  const handleAutoSwing = useCallback(async () => {
    const video = videoRef.current;
    const ctrl = playbackControllerARef.current;
    const dur = youtubeVideoIdA ? ctrl?.getDuration() : video?.duration;
    if (!Number.isFinite(dur) || !dur || dur <= 0) {
      alert('No video loaded. Upload a video or paste a YouTube URL first.');
      return;
    }

    setProcessingStatus('Analyzing motion…');
    let swings: Array<{ startTime: number; endTime: number; wristPositions: Array<{ time: number; x: number; y: number }> }> = [];
    try {
      if (!youtubeVideoIdA && video && Number.isFinite(video.duration) && video.duration > 0) {
        const { detectSwingsFromVideo } = await import('@/lib/swingDetection');
        swings = await detectSwingsFromVideo(video);
      }
    } catch {
      swings = [];
    } finally {
      setProcessingStatus(null);
    }

    // Fall back to skeleton-based detection if motion detection found nothing
    if (swings.length === 0) {
      swings = canvasRef.current?.getDetectedSwings() ?? [];
    }

    if (swings.length === 0) {
      alert('No swings detected. Play the video first, or enable Skeleton tool for AI-based detection.');
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
  }, [videoRef, youtubeVideoIdA]);

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
  const handleUrlSubmit = useCallback(async () => {
    const raw = normalizeWebUrlInput(urlInput);
    if (!raw) return;

    // Reset current session state before loading a new URL source.
    if (urlTarget === 'A') {
      revokeBlobUrl(lastBlobUrlARef.current);
      lastBlobUrlARef.current = null;
      setVideoSrc(null);
      setYoutubeVideoIdA(null);
      setGenericEmbedSrcA(null);
      if (videoRef.current) cleanupVideoEl(videoRef.current);
    } else {
      revokeBlobUrl(lastBlobUrlBRef.current);
      lastBlobUrlBRef.current = null;
      setVideoSrcB(null);
      setYoutubeVideoIdB(null);
      setGenericEmbedSrcB(null);
      if (videoRefB.current) cleanupVideoEl(videoRefB.current);
      setVideoBLoaded(false);
    }
    setShowTapToPlay(false);
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
    captureMp4ConversionGenRef.current += 1;
    setCaptureDownloadStatus('idle');
    setShowCaptureSaveToast(false);
    setCaptureBusy(false);
    disposeFfmpegWasm();
    setProcessingStatus('Getting your video ready…');
    setStroMotionEnabled(false);
    setStroMotionRegion(undefined);
    clearGhosts();
    (urlTarget === 'A' ? canvasRef.current : canvasRefB.current)?.clearAll();

    // Fast path: direct video URL -> proxy same-origin for Canvas/ML features
    const looksLikeDirectFile = raw.match(/\.(mp4|webm|mov)(\?.*)?$/i);
    // YouTube resolver returns a direct `googlevideo.com/videoplayback?...` URL which often has no extension.
    // Treat those as direct stream URLs too.
    const lowerRaw = raw.toLowerCase();
    const looksLikeYouTubeDirectStream =
      lowerRaw.includes('googlevideo.com/') || lowerRaw.includes('/videoplayback?') || lowerRaw.includes('mime=video');

    if (looksLikeDirectFile || looksLikeYouTubeDirectStream) {
      const streamUrl = `/api/video/stream?url=${encodeURIComponent(raw)}`;
      setProcessingStatus(null);
      if (urlTarget === 'A') {
        setYoutubeVideoIdA(null);
        setGenericEmbedSrcA(null);
        setVideoSrc(streamUrl);
        if (videoRef.current) {
          cleanupVideoEl(videoRef.current);
          videoRef.current.src = streamUrl;
          videoRef.current.load();
        }
      } else {
        setYoutubeVideoIdB(null);
        setGenericEmbedSrcB(null);
        setVideoSrcB(streamUrl);
        if (videoRefB.current) {
          cleanupVideoEl(videoRefB.current);
          videoRefB.current.src = streamUrl;
          videoRefB.current.load();
        }
      }
      return;
    }

    const resolved = resolveEmbedTarget(raw);
    if (!resolved) {
      setProcessingStatus(null);
      alert(
        'We couldn’t open that link here. Try a YouTube address, a social clip link, or paste a direct video link — then tap Load again.',
      );
      return;
    }

    if (resolved.kind === 'youtube') {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(resolved.videoId)}`;
      setProcessingStatus('Connecting to stream…');
      try {
        const streamResult = await resolveYoutubeForAnalysis(watchUrl);
        if (streamResult.ok && streamResult.directUrl) {
          const streamUrl = `/api/video/stream?url=${encodeURIComponent(streamResult.directUrl)}`;
          setProcessingStatus(null);
          setShowTapToPlay(false);
          if (urlTarget === 'A') {
            setYoutubeVideoIdA(null);
            setGenericEmbedSrcA(null);
            setVideoSrc(streamUrl);
            if (videoRef.current) {
              cleanupVideoEl(videoRef.current);
              videoRef.current.src = streamUrl;
              videoRef.current.load();
            }
          } else {
            setYoutubeVideoIdB(null);
            setGenericEmbedSrcB(null);
            setVideoSrcB(streamUrl);
            if (videoRefB.current) {
              cleanupVideoEl(videoRefB.current);
              videoRefB.current.src = streamUrl;
              videoRefB.current.load();
            }
            setVideoBLoaded(false);
          }
          return;
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[analysis] YouTube resolve failed, using embed', e);
      }
      setProcessingStatus(null);
      setShowTapToPlay(true);
      if (urlTarget === 'A') {
        setYoutubeVideoIdA(resolved.videoId);
        setGenericEmbedSrcA(null);
      } else {
        setYoutubeVideoIdB(resolved.videoId);
        setGenericEmbedSrcB(null);
      }
    } else {
      setShowTapToPlay(false);
      if (urlTarget === 'A') {
        setYoutubeVideoIdA(null);
        setGenericEmbedSrcA(resolved.src);
      } else {
        setYoutubeVideoIdB(null);
        setGenericEmbedSrcB(resolved.src);
      }
    }
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl, urlInput, urlTarget, videoBDuration]);

  const handleEmbedCaptureRequest = useCallback(
    async (
      panel: 'A' | 'B',
      opts: { mode: 'full' | 'section'; startSec: number | null; endSec: number | null },
    ) => {
      // Acquire the screen-share stream IMMEDIATELY from the user gesture,
      // before any async work, so the browser doesn't revoke the gesture context.
      let preAcquiredStream: MediaStream | null = null;
      try {
        preAcquiredStream = await getTabCaptureStream();
      } catch (e: unknown) {
        const msg =
          (e as DOMException)?.name === 'NotAllowedError' ||
          (e as DOMException)?.name === 'PermissionDeniedError'
            ? 'Screen sharing was cancelled or blocked by the browser. Tap Capture and choose your browser tab when asked.'
            : `Screen sharing failed: ${(e as Error)?.message || 'Unknown error'}. Try refreshing the page.`;
        setCaptureError(msg);
        return;
      }

      const videoEl = panel === 'A' ? videoRef.current : videoRefB.current;
      if (!videoEl) {
        stopAllTracks(preAcquiredStream);
        setCaptureError(
          'The video player is not ready yet. Wait until the clip appears, then open Capture again.',
        );
        return;
      }

      const yid = panel === 'A' ? youtubeVideoIdA : youtubeVideoIdB;
      if (yid) {
        try {
          setProcessingStatus('Preparing a playable copy (no tab share)…');
          const r = await resolveYoutubeForAnalysis(
            `https://www.youtube.com/watch?v=${encodeURIComponent(yid)}`,
          );
          if (r.ok && r.directUrl) {
            stopAllTracks(preAcquiredStream);
            const streamUrl = `/api/video/stream?url=${encodeURIComponent(r.directUrl)}`;
            setProcessingStatus(null);
            const freshEl = panel === 'A' ? videoRef.current : videoRefB.current;
            if (panel === 'A') {
              setYoutubeVideoIdA(null);
              setGenericEmbedSrcA(null);
              setVideoSrc(streamUrl);
              if (freshEl) {
                cleanupVideoEl(freshEl);
                freshEl.src = streamUrl;
                freshEl.load();
                await freshEl.play().catch(() => {});
              }
            } else {
              setYoutubeVideoIdB(null);
              setGenericEmbedSrcB(null);
              setVideoSrcB(streamUrl);
              if (freshEl) {
                cleanupVideoEl(freshEl);
                freshEl.src = streamUrl;
                freshEl.load();
                await freshEl.play().catch(() => {});
              }
              setVideoBLoaded(false);
            }
            setShowCaptureSaveToast(true);
            setShowTapToPlay(false);
            return;
          }
        } catch (e) {
          if (typeof console !== 'undefined') console.warn('[analysis] YouTube import failed, try tab capture', e);
        }
        setProcessingStatus(null);
      }

      const ready = panel === 'A' ? embedReadyA : embedReadyB;
      const hasEmbedOnly =
        panel === 'A'
          ? !!(youtubeVideoIdA || genericEmbedSrcA) && !videoSrc
          : !!(youtubeVideoIdB || genericEmbedSrcB) && !videoSrcB;
      if (hasEmbedOnly && !ready) {
        stopAllTracks(preAcquiredStream);
        setCaptureError('The video is still loading. Wait until it appears, then try Capture again.');
        return;
      }

      setCaptureError(null);
      setCaptureCountdown(null);
      setCaptureStepStatus(null);
      setEmbedCapturePanelId(panel);
      setCaptureBusy(true);
      setEmbedCaptureRecording(true);
      setCaptureProgress01(0);

      const yt = panel === 'A' ? ytPlayerARef.current : ytPlayerBRef.current;
      const isYt = panel === 'A' ? !!youtubeVideoIdA : !!youtubeVideoIdB;
      const shell = panel === 'A' ? captureShellRef.current : captureShellRefB.current;

      const durHint =
        !isYt &&
        videoEl &&
        typeof videoEl.duration === 'number' &&
        Number.isFinite(videoEl.duration) &&
        videoEl.duration > 0.25
          ? videoEl.duration
          : null;

      const result = await runEmbedTabCaptureFlow({
        opts,
        videoEl,
        ytPlayer: yt,
        isYoutube: isYt,
        captureShellEl: shell,
        onProgress: setCaptureProgress01,
        onCountdown: setCaptureCountdown,
        onStepStatus: setCaptureStepStatus,
        videoDurationHintSec: durHint,
        preAcquiredStream: preAcquiredStream,
      });

      setCaptureBusy(false);
      setEmbedCaptureRecording(false);
      setEmbedCapturePanelId(null);
      setCaptureProgress01(0);
      setCaptureCountdown(null);
      setCaptureStepStatus(null);

      if (!result.ok) {
        setCaptureError(result.message);
        return;
      }

      sessionCaptureBlobRef.current = result.blob;
      sessionMp4BlobRef.current = null;
      setCaptureDownloadStatus('preparing');
      const conversionGen = ++captureMp4ConversionGenRef.current;
      const capturedBlob = result.blob;
      void (async () => {
        const conv = await convertWebmBlobToMp4(capturedBlob);
        if (conversionGen !== captureMp4ConversionGenRef.current) return;
        if (conv.ok) {
          sessionMp4BlobRef.current = conv.blob;
          setCaptureDownloadStatus('ready_mp4');
        } else {
          sessionMp4BlobRef.current = null;
          setCaptureDownloadStatus('ready_webm');
        }
      })();

      const url = URL.createObjectURL(result.blob);
      const postEl = panel === 'A' ? videoRef.current : videoRefB.current;

      if (panel === 'A') {
        revokeBlobUrl(lastBlobUrlARef.current);
        lastBlobUrlARef.current = url;
        setYoutubeVideoIdA(null);
        setGenericEmbedSrcA(null);
        setVideoSrc(url);
        if (postEl) {
          cleanupVideoEl(postEl);
          postEl.src = url;
          postEl.load();
          await postEl.play().catch(() => {});
        }
      } else {
        revokeBlobUrl(lastBlobUrlBRef.current);
        lastBlobUrlBRef.current = url;
        setYoutubeVideoIdB(null);
        setGenericEmbedSrcB(null);
        setVideoSrcB(url);
        if (postEl) {
          cleanupVideoEl(postEl);
          postEl.src = url;
          postEl.load();
          await postEl.play().catch(() => {});
        }
        setVideoBLoaded(false);
      }

      setShowCaptureSaveToast(true);
      setShowTapToPlay(false);
    },
    [
      cleanupVideoEl,
      revokeBlobUrl,
      youtubeVideoIdA,
      youtubeVideoIdB,
      genericEmbedSrcA,
      genericEmbedSrcB,
      videoSrc,
      videoSrcB,
      embedReadyA,
      embedReadyB,
      setProcessingStatus,
    ],
  );

  const handleDownloadCaptureBlob = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (captureDownloadStatus === 'preparing') return;

    const mp4 = sessionMp4BlobRef.current;
    const webm = sessionCaptureBlobRef.current;

    const blob =
      captureDownloadStatus === 'ready_mp4' && mp4
        ? mp4
        : captureDownloadStatus === 'ready_webm' && webm
          ? webm
          : null;

    if (!blob) return;

    const ext = captureDownloadStatus === 'ready_mp4' ? 'mp4' : 'webm';
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = `coach-lab-capture.${ext}`;
    a.click();
    URL.revokeObjectURL(href);
  }, [captureDownloadStatus]);

  const handleYoutubeUploadCapture = useCallback(async () => {
    if (captureYoutubeBusy || captureDownloadStatus === 'preparing') return;
    const mp4 = sessionMp4BlobRef.current;
    const webm = sessionCaptureBlobRef.current;
    const blob =
      captureDownloadStatus === 'ready_mp4' && mp4
        ? mp4
        : captureDownloadStatus === 'ready_webm' && webm
          ? webm
          : null;
    if (!blob) return;

    setCaptureYoutubeBusy(true);
    try {
      const ext = captureDownloadStatus === 'ready_mp4' ? 'mp4' : 'webm';
      const mime = blob.type || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
      const fd = new FormData();
      fd.append('video', new File([blob], `coach-lab-capture.${ext}`, { type: mime }));
      fd.append('title', `Coach Lab analysis ${localDateTimeForFolder()}`);
      const res = await fetch('/api/youtube/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setCaptureYoutubeUrl(typeof data.url === 'string' ? data.url : null);
      setShowCaptureSaveToast(false);
      setCaptureSaveModalOpen(true);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'YouTube upload failed');
    } finally {
      setCaptureYoutubeBusy(false);
    }
  }, [captureDownloadStatus, captureYoutubeBusy]);

  /** During tab capture, paint & pose-use the live MediaRecorder preview stream — not YouTube thumbnail pose. */
  const embedLiveVideoA = embedCapturePanelId === 'A';
  const embedLiveVideoB = embedCapturePanelId === 'B';

  const lockEmbedInteractionA =
    Boolean(
      captureBusy &&
        embedCapturePanelId === 'A' &&
        (youtubeVideoIdA || genericEmbedSrcA) &&
        !videoSrc,
    );
  const lockEmbedInteractionB =
    Boolean(
      captureBusy &&
        embedCapturePanelId === 'B' &&
        (youtubeVideoIdB || genericEmbedSrcB) &&
        !videoSrcB,
    );
  const showUrlLoadingOverlayA = Boolean(
    (youtubeVideoIdA || genericEmbedSrcA) && !videoSrc && !embedReadyA,
  );
  const showUrlLoadingOverlayB = Boolean(
    (youtubeVideoIdB || genericEmbedSrcB) && !videoSrcB && !embedReadyB,
  );

  playbackControllerARef.current = youtubeVideoIdA ? ytIframeControllerA : html5ControllerA;
  playbackControllerBRef.current = youtubeVideoIdB ? ytIframeControllerB : html5ControllerB;

  const panelToolbarInset =
    !isMobile && layoutMode === 'reels'
      ? REELS_TOOLBAR_W + 8
      : !isMobile
        ? LEFT_TOOLBAR_W + 8
        : 0;
  const timelineLeadingInset =
    layoutMode === 'reels' && !isMobile ? REELS_TOOLBAR_W + 12 : LEFT_TOOLBAR_W + 16;

  const reelsDesktop = !isMobile && layoutMode === 'reels';

  const renderTimelineDock = () => (
    <div style={{ width: '100%', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hasVideoBContent && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Playback</span>
          <select
            value={playbackTarget}
            onChange={(e) => setPlaybackTarget(e.target.value as 'A' | 'B' | 'AB')}
            style={{
              height: 32,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)',
              color: '#FFFFFF',
              padding: '0 10px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            aria-label="Playback target"
            title="AB: sync both clips (uploaded MP4/WebM pairs)"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="AB">AB</option>
          </select>
        </div>
      )}

      {hasVideoBContent ? (
        playbackTarget === 'B'
          ? ((videoSrcB || youtubeVideoIdB) && !(genericEmbedSrcB && !videoSrcB)) && (
              <PreciseTimeline
                source={
                  youtubeVideoIdB
                    ? { kind: 'youtube', playerRef: ytPlayerBRef }
                    : { kind: 'html', videoRef: videoRefB }
                }
                defaultFps={30}
                accent="#34C759"
                leadingInsetPx={0}
                compact
                overlay
              />
            )
          : ((videoSrc || youtubeVideoIdA) && !(genericEmbedSrcA && !videoSrc)) && (
              <PreciseTimeline
                source={
                  youtubeVideoIdA
                    ? { kind: 'youtube', playerRef: ytPlayerARef }
                    : { kind: 'html', videoRef }
                }
                defaultFps={30}
                accent={layoutMode === 'reels' ? '#FF3B30' : 'rgba(0,113,227,0.9)'}
                leadingInsetPx={0}
                compact
                overlay
              />
            )
      ) : (
        (videoSrc || youtubeVideoIdA) &&
        !(genericEmbedSrcA && !videoSrc) && (
          <PreciseTimeline
            source={
              youtubeVideoIdA
                ? { kind: 'youtube', playerRef: ytPlayerARef }
                : { kind: 'html', videoRef }
            }
            defaultFps={30}
            accent={layoutMode === 'reels' ? '#FF3B30' : 'rgba(0,113,227,0.9)'}
            leadingInsetPx={0}
            compact
            overlay
          />
        )
      )}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        minHeight: 0,
        overflow: 'hidden',
        background: '#FFFFFF',
        color: '#1A1A1A',
      }}
    >

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
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isMobile ? 'flex-end' : 'flex-end',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        paddingRight: 12,
        paddingBottom: 10,
        paddingLeft: isMobile ? 12 : layoutMode === 'reels' ? 12 : LEFT_TOOLBAR_W + 24,
        pointerEvents: 'none',
      }}>
        {isMobile ? (
          <div style={{ position: 'relative', pointerEvents: 'auto' }}>
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              style={{
                width: 44,
                height: 44,
                borderRadius: layoutMode === 'reels' ? 0 : 14,
                border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                background: layoutMode === 'reels' ? 'rgba(0,0,0,0.4)' : 'rgba(255, 255, 255, 0.85)',
                color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                backdropFilter: 'blur(18px) saturate(1.1)',
                WebkitBackdropFilter: 'blur(18px) saturate(1.1)',
                boxShadow: layoutMode === 'reels' ? 'none' : '0 8px 28px rgba(0,0,0,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Menu"
              aria-label="Menu"
            >
              <Menu size={20} strokeWidth={1.75} />
            </button>

            {mobileMenuOpen && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: 52,
                width: 'min(92vw, 360px)',
                maxHeight: 'min(72dvh, 560px)',
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch',
                borderRadius: layoutMode === 'reels' ? 0 : 16,
                padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))',
                background: layoutMode === 'reels' ? 'rgba(0,0,0,0.75)' : 'rgba(250, 249, 247, 0.97)',
                border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                backdropFilter: 'blur(20px) saturate(1.1)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.1)',
                boxShadow: layoutMode === 'reels' ? 'none' : '0 18px 48px rgba(0,0,0,0.1)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Camera size={14} color="#fff" />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Coach Lab</div>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => setMobileMenuOpen(false)} style={{ ...headerBtnStyle, width: 44, padding: 0 }}>✕</button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <select
                    value={urlTarget}
                    onChange={(e) => setUrlTarget(e.target.value as 'A' | 'B')}
                    style={{
                      height: 40,
                      borderRadius: 10,
                      border: '1px solid #E5E5E5',
                      background: '#FFFFFF',
                      color: '#1A1A1A',
                      padding: '0 10px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title="Load URL into Video A or B"
                    aria-label="URL target"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Paste video URL…"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                    style={{
                      flex: 1,
                      height: 40,
                      padding: '0 10px',
                      borderRadius: 10,
                      border: '1px solid #E5E5E5',
                      fontSize: 14,
                      outline: 'none',
                      background: '#FFFFFF',
                      color: '#1A1A1A',
                      minWidth: 0,
                    }}
                  />
                  <button onClick={handleUrlSubmit} style={{ ...headerBtnStyle, height: 40, padding: '0 14px', width: 'auto' }}>
                    Load
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={() => fileInputRef.current?.click()} style={headerBtnStyle}><Upload size={18} /> Video A</button>
                  <button onClick={() => fileInputRefB.current?.click()} style={headerBtnStyle}><Upload size={18} /> Video B</button>
                  <WebcamDropdown
                    webcamActive={webcamActive}
                    onToggleWebcam={() => void toggleWebcam()}
                    webcamPipMode={webcamPipMode}
                    onWebcamPipModeChange={setWebcamPipMode}
                    webcamOpacity={webcamOpacity}
                    onWebcamOpacityChange={setWebcamOpacity}
                    webcamCutout={webcamCutout}
                    onWebcamCutoutChange={setWebcamCutout}
                    triggerStyle={headerBtnStyle}
                  />
                  {!micActive ? (
                    <button onClick={startMic} style={headerBtnStyle}>Mic</button>
                  ) : (
                    <button onClick={stopMic} style={headerBtnStyle}>Mic off</button>
                  )}
                  <button onClick={handleScreenshot} style={headerBtnStyle}>Screenshot</button>
                  <button type="button" onClick={resetSession} style={headerBtnStyle} title="Start fresh — clears videos and recordings">
                    New
                  </button>
                  <button type="button" onClick={resetSession} style={{ ...headerBtnStyle, borderColor: '#fca5a5', color: '#b91c1c', background: '#fff7f7' }} title="Remove all videos">
                    Clear all
                  </button>
                </div>

                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#6e6e73', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Layout</span>
                  <button type="button" onClick={() => setLayoutMode('youtube')} style={{ ...headerBtnStyle, background: layoutMode === 'youtube' ? '#1A1A1A' : '#FFFFFF', color: layoutMode === 'youtube' ? '#FFFFFF' : '#1A1A1A', border: layoutMode === 'youtube' ? '1px solid #1A1A1A' : '1px solid #E5E5E5' }}>16:9</button>
                  <button type="button" onClick={() => setLayoutMode('reels')} style={{ ...headerBtnStyle, background: layoutMode === 'reels' ? '#1A1A1A' : '#FFFFFF', color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A', border: layoutMode === 'reels' ? '1px solid #1A1A1A' : '1px solid #E5E5E5' }}>9:16</button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <ScreenRecorder
                    getCanvas={getCanvas}
                    getWebcamStream={getWebcamStream}
                    getMicStream={getMicStream}
                    getCropRegion={getCropRegion}
                    layoutMode={layoutMode === 'reels' ? 'reels' : 'youtube'}
                    onRecordingChange={handleRecordingChange}
                  />
                </div>

                {processingStatus && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#6e6e73', lineHeight: 1.45 }}>
                    {processingStatus}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : reelsDesktop ? null : (
          <div
            style={{
              width: '100%',
              maxWidth: layoutMode === 'reels' ? 'min(480px, 100%)' : 'min(1100px, 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: layoutMode === 'reels' ? '6px' : '12px',
              pointerEvents: 'auto',
              padding: layoutMode === 'reels' ? '6px 8px' : '10px 12px',
              borderRadius: layoutMode === 'reels' ? 0 : 16,
              background: layoutMode === 'reels' ? 'rgba(0,0,0,0.5)' : 'rgba(255, 255, 255, 0.72)',
              border: layoutMode === 'reels' ? 'none' : '1px solid rgba(229, 229, 229, 0.95)',
              backdropFilter: 'blur(18px) saturate(1.15)',
              WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
              boxShadow: layoutMode === 'reels' ? 'none' : '0 8px 32px rgba(0,0,0,0.06)',
            }}
          >
            {/* Actions (desktop) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: layoutMode === 'reels' ? '5px' : '8px', flexWrap: 'nowrap', overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <select
                  value={urlTarget}
                  onChange={(e) => setUrlTarget(e.target.value as 'A' | 'B')}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: '1px solid #E5E5E5',
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                    padding: '0 8px',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                  title="Load URL into Video A or B"
                  aria-label="URL target"
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
                <input
                  type="text"
                  placeholder="Paste video URL…"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                  style={{
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #E8E8ED',
                    fontSize: 12,
                    width: layoutMode === 'reels' ? 148 : 240,
                    outline: 'none',
                    minWidth: 0,
                  }}
                />
                <button onClick={handleUrlSubmit} style={{ ...headerBtnStyle, height: layoutMode === 'reels' ? 28 : 30, padding: layoutMode === 'reels' ? '0 10px' : '0 14px', width: 'auto', fontSize: layoutMode === 'reels' ? 11 : 12 }}>
                  Load
                </button>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }}
                title={videoSrc ? 'Replace Video A' : 'Upload Video A'}
              >
                <Upload size={layoutMode === 'reels' ? 12 : 14} />
                {layoutMode === 'reels'
                  ? (videoSrc ? 'A' : '+A')
                  : (videoSrc ? 'Replace A' : 'Upload A')}
              </button>
              <button
                type="button"
                onClick={() => fileInputRefB.current?.click()}
                style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }}
                title={videoSrcB ? 'Replace Video B' : 'Upload Video B'}
              >
                <Upload size={layoutMode === 'reels' ? 12 : 14} />
                {layoutMode === 'reels'
                  ? (videoSrcB ? 'B' : '+B')
                  : (videoSrcB ? 'Replace B' : 'Upload B')}
              </button>

              <WebcamDropdown
                webcamActive={webcamActive}
                onToggleWebcam={() => void toggleWebcam()}
                webcamPipMode={webcamPipMode}
                onWebcamPipModeChange={setWebcamPipMode}
                webcamOpacity={webcamOpacity}
                onWebcamOpacityChange={setWebcamOpacity}
                webcamCutout={webcamCutout}
                onWebcamCutoutChange={setWebcamCutout}
                triggerStyle={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }}
                compact={layoutMode === 'reels'}
              />

              {!micActive ? (
                <button onClick={startMic} style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }} title="Enable microphone (audio in recordings)">Mic</button>
              ) : (
                <button onClick={stopMic} style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}), color: '#EF4444' }} title="Disable microphone">{layoutMode === 'reels' ? 'Mic on' : 'Mic on'}</button>
              )}

              <button onClick={handleScreenshot} style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }} title="Save screenshot">{layoutMode === 'reels' ? 'Shot' : 'Screenshot'}</button>
              <button type="button" onClick={resetSession} style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}) }} title="Start fresh — clears videos and recordings">New</button>
              <button
                type="button"
                onClick={resetSession}
                style={{ ...headerBtnStyle, ...(layoutMode === 'reels' ? { padding: '4px 8px', fontSize: 11 } : {}), borderColor: '#c2410c', color: '#9a3412' }}
                title="Remove all videos and return to the upload screen"
              >
                Clear all
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: layoutMode === 'reels' ? 4 : 6 }} title="Layout">
                <button type="button" onClick={() => setLayoutMode('youtube')} style={{ ...headerBtnStyle, height: layoutMode === 'reels' ? 26 : 30, padding: layoutMode === 'reels' ? '0 8px' : '0 10px', width: 'auto', fontSize: layoutMode === 'reels' ? 11 : 12, background: layoutMode === 'youtube' ? '#1A1A1A' : '#FFFFFF', color: layoutMode === 'youtube' ? '#FFFFFF' : '#1A1A1A', border: layoutMode === 'youtube' ? '1px solid #1A1A1A' : '1px solid #E5E5E5' }}>16:9</button>
                <button type="button" onClick={() => setLayoutMode('reels')} style={{ ...headerBtnStyle, height: layoutMode === 'reels' ? 26 : 30, padding: layoutMode === 'reels' ? '0 8px' : '0 10px', width: 'auto', fontSize: layoutMode === 'reels' ? 11 : 12, background: layoutMode === 'reels' ? '#1A1A1A' : '#FFFFFF', color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A', border: layoutMode === 'reels' ? '1px solid #1A1A1A' : '1px solid #E5E5E5' }}>9:16</button>
              </div>

              <ScreenRecorder
                getCanvas={getCanvas}
                getWebcamStream={getWebcamStream}
                getMicStream={getMicStream}
                getCropRegion={getCropRegion}
                layoutMode={layoutMode === 'reels' ? 'reels' : 'youtube'}
                onRecordingChange={handleRecordingChange}
              />
            </div>
          </div>
        )}
      </header>

      {/* ── Main layout ── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          justifyContent: layoutMode === 'reels' ? 'center' : undefined,
          background: layoutMode === 'reels' ? '#FFFFFF' : undefined,
          position: 'relative',
        }}
      >

        {/* Left toolbar (desktop) — 16:9 layout only; Reels uses floating toolbar on the stage */}
        {!isMobile && layoutMode !== 'reels' && (
        <aside
          className="coachlab-video-toolbar"
          style={{
          width: LEFT_TOOLBAR_W,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.92)',
          overflowY: 'auto',
          position: 'absolute',
          left: 12,
          top: 12,
          bottom: 80,
          zIndex: 80,
          borderRadius: 14,
          boxShadow: '0 10px 40px rgba(0,0,0,0.22)',
          border: '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
        >
          <div style={{ padding: 6 }}>
            <ToolPalette
              activeTool={activeTool}
              onToolChange={handleToolChange}
              compact
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
              rect3d={rect3d}
              onRect3dChange={setRect3d}
              triangle3d={triangle3d}
              onTriangle3dChange={setTriangle3d}
              skeletonShowAngles={skeletonShowAngles}
              onSkeletonShowAnglesChange={setSkeletonShowAngles}
              skeletonShowHeadLine={skeletonShowHeadLine}
              onSkeletonShowHeadLineChange={setSkeletonShowHeadLine}
              skeletonClassicColors={skeletonClassicColors}
              onSkeletonClassicColorsChange={setSkeletonClassicColors}
              skeletonShowRightArm={skeletonShowRightArm}
              onSkeletonShowRightArmChange={setSkeletonShowRightArm}
              skeletonShowLeftArm={skeletonShowLeftArm}
              onSkeletonShowLeftArmChange={setSkeletonShowLeftArm}
              skeletonShowRightLeg={skeletonShowRightLeg}
              onSkeletonShowRightLegChange={setSkeletonShowRightLeg}
              skeletonShowLeftLeg={skeletonShowLeftLeg}
              onSkeletonShowLeftLegChange={setSkeletonShowLeftLeg}
              ballSampleMode={ballSampleMode}
              onBallSampleModeChange={setBallSampleMode}
              onResetCropZoom={() => canvasRef.current?.resetCropZoom()}
              onClearCrop={() => canvasRef.current?.clearCropRegion()}
            />
          </div>

          {/* Resize handle removed in compact mode */}
        </aside>
        )}

        {/* Canvas area */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
            alignItems: layoutMode === 'reels' ? 'center' : undefined,
            paddingTop:
              layoutMode === 'reels'
                ? 0
                : 'calc(env(safe-area-inset-top, 0px) + 52px)',
            width: '100%',
          }}
        >
          <div
            style={{
              flex: layoutMode === 'reels' ? '0 0 auto' : 1,
              position: 'relative',
              minHeight: 0,
              background: '#000',
              display: 'flex',
              flexDirection: layoutMode === 'reels' ? 'column' : 'row',
              justifyContent: layoutMode === 'reels' ? 'center' : undefined,
              alignItems: layoutMode === 'reels' ? 'center' : undefined,
              alignSelf: layoutMode === 'reels' ? 'center' : undefined,
              overflow: reelsDesktop ? 'hidden' : layoutMode === 'reels' ? 'auto' : 'hidden',
              padding: 0,
              ...(layoutMode === 'reels'
                ? isMobile
                  ? {
                      width: '100dvw',
                      height: '100dvh',
                      maxHeight: '100dvh',
                      borderRadius: 0,
                      border: 'none',
                      boxShadow: 'none',
                      margin: 0,
                    }
                  : {
                      width: 'calc(100dvh * 9 / 16)',
                      maxWidth: '100vw',
                      height: '100dvh',
                      maxHeight: '100dvh',
                      aspectRatio: '9 / 16',
                      borderRadius: 0,
                      border: 'none',
                      boxShadow: 'none',
                      margin: '0 auto',
                    }
                : { width: '100%' }),
            }}
          >
            {reelsDesktop && (
              <>
                <button
                  type="button"
                  onClick={() => setDesktopReelsMenuOpen((o) => !o)}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 92,
                    width: 34,
                    height: 34,
                    borderRadius: 0,
                    border: 'none',
                    background: 'rgba(0,0,0,0.4)',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                  aria-expanded={desktopReelsMenuOpen}
                  aria-label="Open actions menu"
                >
                  <MoreHorizontal size={18} strokeWidth={1.5} />
                </button>
                {desktopReelsMenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 46,
                      right: 8,
                      zIndex: 92,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: 8,
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(18px) saturate(1.12)',
                      WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
                      borderRadius: 0,
                      minWidth: 180,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <select
                        value={urlTarget}
                        onChange={(e) => setUrlTarget(e.target.value as 'A' | 'B')}
                        style={{
                          height: 28,
                          borderRadius: 0,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(255,255,255,0.1)',
                          color: '#FFFFFF',
                          padding: '0 6px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title="Load URL into Video A or B"
                        aria-label="URL target"
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Paste URL…"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                        style={{
                          height: 28,
                          width: 120,
                          padding: '0 8px',
                          borderRadius: 0,
                          border: '1px solid rgba(255,255,255,0.2)',
                          fontSize: 11,
                          outline: 'none',
                          background: 'rgba(255,255,255,0.1)',
                          color: '#FFFFFF',
                          minWidth: 0,
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleUrlSubmit}
                        style={{ ...headerBtnStyle, height: 28, padding: '0 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }}
                      >
                        Load
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }}
                        title={videoSrc ? 'Replace Video A' : 'Upload Video A'}
                      >
                        <Upload size={12} />
                        {videoSrc ? 'A' : '+A'}
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRefB.current?.click()}
                        style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }}
                        title={videoSrcB ? 'Replace Video B' : 'Upload Video B'}
                      >
                        <Upload size={12} />
                        {videoSrcB ? 'B' : '+B'}
                      </button>
                      <WebcamDropdown
                        webcamActive={webcamActive}
                        onToggleWebcam={() => void toggleWebcam()}
                        webcamPipMode={webcamPipMode}
                        onWebcamPipModeChange={setWebcamPipMode}
                        webcamOpacity={webcamOpacity}
                        onWebcamOpacityChange={setWebcamOpacity}
                        webcamCutout={webcamCutout}
                        onWebcamCutoutChange={setWebcamCutout}
                        triggerStyle={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }}
                        compact
                      />
                      {!micActive ? (
                        <button type="button" onClick={startMic} style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }} title="Mic">
                          Mic
                        </button>
                      ) : (
                        <button type="button" onClick={stopMic} style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.15)' }} title="Stop mic">
                          Mic on
                        </button>
                      )}
                      <button type="button" onClick={handleScreenshot} style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }} title="Screenshot">
                        Shot
                      </button>
                      <button type="button" onClick={resetSession} style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }} title="New session">
                        New
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLayoutMode('youtube'); setDesktopReelsMenuOpen(false); }}
                        style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, height: 28, borderRadius: 0, background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.2)' }}
                      >
                        16:9
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLayoutMode('reels'); }}
                        style={{ ...headerBtnStyle, padding: '4px 8px', fontSize: 11, height: 28, borderRadius: 0, background: 'rgba(255,255,255,0.3)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.4)' }}
                      >
                        9:16
                      </button>
                      <ScreenRecorder
                        getCanvas={getCanvas}
                        getWebcamStream={getWebcamStream}
                        getMicStream={getMicStream}
                        getCropRegion={getCropRegion}
                        layoutMode="reels"
                        onRecordingChange={handleRecordingChange}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                width: '100%',
                display: 'flex',
                flexDirection: layoutMode === 'reels' ? 'column' : 'row',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
            {showMobileToolStrip && (
              <div
                className="coachlab-video-toolbar"
                style={{
                position: 'absolute',
                left: 8,
                top: 8,
                bottom: 160,
                zIndex: 60,
                overflowY: 'auto',
                maxHeight: 'calc(100% - 180px)',
              }}
              >
                <MobileToolStrip
                  activeTool={activeTool}
                  onToolChange={handleToolChange}
                  drawingOptions={drawingOptions}
                  onOptionsChange={handleOptionsChange}
                  onUndo={() => canvasRef.current?.undo()}
                  onRedo={() => canvasRef.current?.redo()}
                  onClear={() => canvasRef.current?.clearAll()}
                  ballTrailMode={ballTrailMode}
                  onBallTrailModeChange={setBallTrailMode}
                  circleSpinning={circleSpinning}
                  onCircleSpinningChange={setCircleSpinning}
                  circleGapMode={circleGapMode}
                  onCircleGapModeChange={setCircleGapMode}
                  rect3d={rect3d}
                  onRect3dChange={setRect3d}
                  triangle3d={triangle3d}
                  onTriangle3dChange={setTriangle3d}
                  onClearCrop={() => canvasRef.current?.clearCropRegion()}
                  onResetCropZoom={() => canvasRef.current?.resetCropZoom()}
                  precisionDrawEnabled={precisionDrawEnabled}
                  onPrecisionDrawToggle={handlePrecisionDrawToggle}
                  onShowPrecisionInstructions={showPrecisionInstructionsAgain}
                />
              </div>
            )}
            {!isMobile && layoutMode === 'reels' && (
              <aside
                className="coachlab-video-toolbar"
                style={{
                  position: 'absolute',
                  left: 4,
                  top: reelsDesktop ? 8 : 40,
                  bottom: reelsDesktop ? 120 : 8,
                  width: REELS_TOOLBAR_W,
                  zIndex: 84,
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                  borderRadius: 0,
                  border: 'none',
                  backdropFilter: 'blur(20px) saturate(1.15)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                  boxShadow: 'none',
                }}
              >
                <div
                  style={{
                    padding: 4,
                    transform: 'scale(0.88)',
                    transformOrigin: 'top left',
                    width: `${100 / 0.88}%`,
                    maxHeight: 'calc(100% / 0.88)',
                    overflowY: 'auto',
                  }}
                >
                  <ToolPalette
                    activeTool={activeTool}
                    onToolChange={handleToolChange}
                    compact
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
                    rect3d={rect3d}
                    onRect3dChange={setRect3d}
                    triangle3d={triangle3d}
                    onTriangle3dChange={setTriangle3d}
                    skeletonShowAngles={skeletonShowAngles}
                    onSkeletonShowAnglesChange={setSkeletonShowAngles}
                    skeletonShowHeadLine={skeletonShowHeadLine}
                    onSkeletonShowHeadLineChange={setSkeletonShowHeadLine}
                    skeletonClassicColors={skeletonClassicColors}
                    onSkeletonClassicColorsChange={setSkeletonClassicColors}
                    skeletonShowRightArm={skeletonShowRightArm}
                    onSkeletonShowRightArmChange={setSkeletonShowRightArm}
                    skeletonShowLeftArm={skeletonShowLeftArm}
                    onSkeletonShowLeftArmChange={setSkeletonShowLeftArm}
                    skeletonShowRightLeg={skeletonShowRightLeg}
                    onSkeletonShowRightLegChange={setSkeletonShowRightLeg}
                    skeletonShowLeftLeg={skeletonShowLeftLeg}
                    onSkeletonShowLeftLegChange={setSkeletonShowLeftLeg}
                    ballSampleMode={ballSampleMode}
                    onBallSampleModeChange={setBallSampleMode}
                    onResetCropZoom={() => canvasRef.current?.resetCropZoom()}
                    onClearCrop={() => canvasRef.current?.clearCropRegion()}
                  />
                </div>
              </aside>
            )}
            {/* Video A */}
            <div
              style={{
                flex: layoutMode === 'reels' ? (hasVideoBContent ? '1 1 50%' : '1 1 auto') : 1,
                position: 'relative',
                minWidth: 0,
                minHeight: layoutMode === 'reels' ? 0 : undefined,
                overflow: 'hidden',
              }}
            >
              <div
                ref={attachPanelAContainer}
                style={{
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                  paddingLeft: panelToolbarInset,
                }}
                onDragOver={handleDragOverA}
                onDragLeave={handleDragLeaveA}
                onDrop={handleDropA}
              >
                {!(videoSrc || youtubeVideoIdA || genericEmbedSrcA) ? (
                  <div style={{
                    position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: '14px',
                    borderRadius: layoutMode === 'reels' ? 0 : 20,
                    border: layoutMode === 'reels' ? '2px dashed rgba(255,255,255,0.3)' : '2px dashed #E5E5E5',
                    background: layoutMode === 'reels' ? '#000' : '#FFFFFF',
                    color: layoutMode === 'reels' ? 'rgba(255,255,255,0.6)' : '#6e6e73',
                  }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: '14px', background: 'none', border: 'none', cursor: 'pointer', color: '#6e6e73',
                        padding: '8px 24px',
                      }}
                    >
                      <div style={{
                        width: '88px', height: '88px', borderRadius: layoutMode === 'reels' ? 0 : '20px',
                        background: layoutMode === 'reels' ? 'rgba(255,255,255,0.08)' : '#FAF9F7',
                        border: layoutMode === 'reels' ? '1px solid rgba(255,255,255,0.15)' : '1px solid #E5E5E5',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Upload size={36} color={layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A'} strokeWidth={1.5} />
                      </div>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A' }}>Upload Video A</span>
                      <span style={{ fontSize: '12px', color: layoutMode === 'reels' ? 'rgba(255,255,255,0.5)' : '#6e6e73' }}>MP4, WebM, MOV supported</span>
                    </button>
                    <span style={{ fontSize: '11px', color: '#8e8e93' }}>or drag and drop a video here</span>
                  </div>
                ) : (
                  <>
                    {youtubeVideoIdA ? (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            pointerEvents: lockEmbedInteractionA ? 'none' : 'auto',
                            opacity: lockEmbedInteractionA ? 0.96 : 1,
                          }}
                        >
                          <YouTubeEmbed
                            videoId={youtubeVideoIdA}
                            onPlayer={(p) => { ytPlayerARef.current = p; }}
                          />
                        </div>
                        {showUrlLoadingOverlayA ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.72)',
                              color: '#fff',
                              fontSize: 15,
                              fontWeight: 600,
                              pointerEvents: 'none',
                            }}
                          >
                            Loading video…
                          </div>
                        ) : null}
                        {lockEmbedInteractionA ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 6,
                              background: 'transparent',
                              cursor: 'not-allowed',
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {genericEmbedSrcA && !youtubeVideoIdA ? (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <iframe
                          title="Embedded video"
                          src={genericEmbedSrcA}
                          onLoad={onGenericEmbedIframeLoadA}
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            pointerEvents: lockEmbedInteractionA ? 'none' : 'auto',
                          }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                        {showUrlLoadingOverlayA ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.72)',
                              color: '#fff',
                              fontSize: 15,
                              fontWeight: 600,
                              pointerEvents: 'none',
                            }}
                          >
                            Loading video…
                          </div>
                        ) : null}
                        {lockEmbedInteractionA ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 6,
                              background: 'transparent',
                              cursor: 'not-allowed',
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <CanvasOverlay
                      ref={canvasRef}
                      videoRef={videoRef}
                      webcamVideoRef={webcamVideoRef}
                      renderVideo={embedLiveVideoA || (!youtubeVideoIdA && !genericEmbedSrcA)}
                      transparentWhenNoVideo={(!!youtubeVideoIdA || !!genericEmbedSrcA) && !embedLiveVideoA}
                      youtubePose={
                        youtubeVideoIdA && !embedLiveVideoA
                          ? { videoId: youtubeVideoIdA, controllerRef: playbackControllerARef }
                          : undefined
                      }
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
                      webcamActive={webcamActive}
                      stroMotionGhosts={ghostFrames}
                      stroMotionOpacity={stroMotionOpacity}
                      stroMotionRegion={stroMotionRegion}
                      skeletonShowAngles={skeletonShowAngles}
                      skeletonShowHeadLine={skeletonShowHeadLine}
                      skeletonClassicColors={skeletonClassicColors}
                      skeletonParts={skeletonParts}
                      ballSampleMode={ballSampleMode}
                      rect3d={rect3d}
                      triangle3d={triangle3d}
                      suppressTabCaptureMirror={
                        embedLiveVideoA && (!!youtubeVideoIdA || !!genericEmbedSrcA)
                      }
                      webcamCutout={webcamCutout}
                      precisionTouchDraw={precisionDrawEnabled && showMobileToolStrip}
                      poseFrameSkip={hasVideoBContent ? 4 : 0}
                      panModeEnabled={panModeEnabled}
                      onPanModeToggle={() => setPanModeEnabled((p) => !p)}
                    />
                    <EmbedCapturePanel
                      visible={!!(youtubeVideoIdA || genericEmbedSrcA) && !videoSrc}
                      embedReady={embedReadyA}
                      sectionSeekSupported={!!youtubeVideoIdA}
                      genericIframeNote={
                        genericEmbedSrcA && !youtubeVideoIdA
                          ? 'If you don’t see the video, it may be blocked from embedding — keep it playing in this tab, tap Capture, then choose This tab when your browser asks what to share.'
                          : undefined
                      }
                      busy={captureBusy && embedCapturePanelId === 'A'}
                      progress01={embedCapturePanelId === 'A' ? captureProgress01 : 0}
                      recordingElapsedSec={embedCapturePanelId === 'A' ? captureRecordingElapsedSec : 0}
                      errorMessage={embedCapturePanelId === 'A' || !embedCapturePanelId ? captureError : null}
                      countdown={embedCapturePanelId === 'A' ? captureCountdown : null}
                      stepStatus={embedCapturePanelId === 'A' ? captureStepStatus : null}
                      onRetry={() => setCaptureError(null)}
                      onCapture={(o) => void handleEmbedCaptureRequest('A', o)}
                    />
                    <button
                      type="button"
                      onClick={removeVideoA}
                      title="Remove Video A from this session"
                      style={{
                        position: 'absolute',
                        top: reelsDesktop ? 48 : 8,
                        right: 8,
                        zIndex: 92,
                        padding: '6px 10px',
                        borderRadius: layoutMode === 'reels' ? 0 : 10,
                        border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                        background: layoutMode === 'reels' ? 'rgba(0,0,0,0.4)' : 'rgba(250, 249, 247, 0.94)',
                        color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                        boxShadow: layoutMode === 'reels' ? 'none' : '0 6px 20px rgba(0,0,0,0.08)',
                      }}
                    >
                      Remove Video A
                    </button>
                  </>
                )}
                {/* Drag-over overlay for Video A */}
                {isDragOverA && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
                    background: layoutMode === 'reels' ? 'rgba(0,0,0,0.6)' : 'rgba(250, 249, 247, 0.92)',
                    border: layoutMode === 'reels' ? '3px dashed rgba(255,255,255,0.4)' : '3px dashed #E5E5E5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: layoutMode === 'reels' ? 0 : '16px',
                  }}>
                    <span style={{ color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A', fontSize: '17px', fontWeight: 600 }}>
                      Drop Video A here
                    </span>
                  </div>
                )}
                {/* ── Safari "Tap to Play" overlay ─────────────────────────────── */}
                {showTapToPlay && (videoSrc || youtubeVideoIdA) && (
                  <div
                    role="button"
                    aria-label="Tap to play video"
                    style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.55)',
                      zIndex: 10,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      if (youtubeVideoIdA) {
                        try {
                          ytPlayerARef.current?.playVideo?.();
                        } catch (err: unknown) {
                          console.warn('[CoachLab] Tap-to-Play (YouTube) failed:', err);
                        }
                        setShowTapToPlay(false);
                        return;
                      }
                      const v = videoRef.current;
                      if (!v) return;
                      v.play().catch((err: unknown) => {
                        console.warn('[CoachLab] Tap-to-Play failed:', err);
                      });
                      setShowTapToPlay(false);
                    }}
                  >
                    <div style={{
                      background: layoutMode === 'reels' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.92)',
                      borderRadius: layoutMode === 'reels' ? 0 : '14px',
                      padding: '14px 28px',
                      fontSize: '17px',
                      fontWeight: 700,
                      color: layoutMode === 'reels' ? '#FFFFFF' : '#1D1D1F',
                      display: 'flex', alignItems: 'center', gap: '10px',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                      pointerEvents: 'none',
                    }}>
                      ▶ Tap to Play
                    </div>
                  </div>
                )}
                {(videoSrcB || youtubeVideoIdB || genericEmbedSrcB) && (
                  <div style={{
                    position: 'absolute', top: 4, left: !isMobile ? panelToolbarInset + 4 : 8,
                    fontSize: '11px', fontWeight: 700,
                    color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                    background: layoutMode === 'reels' ? 'rgba(0,0,0,0.4)' : 'rgba(250,249,247,0.94)',
                    border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                    padding: '2px 8px',
                    borderRadius: layoutMode === 'reels' ? 0 : '8px',
                    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                  }}>A</div>
                )}
              </div>
            </div>

            {layoutMode === 'reels' && hasVideoBContent && (
              <div
                style={{
                  height: 1,
                  flexShrink: 0,
                  width: '100%',
                  background: 'rgba(255,255,255,0.14)',
                }}
              />
            )}
            {layoutMode !== 'reels' && hasVideoBContent && (
              <div style={{ width: '1px', background: '#333', flexShrink: 0 }} />
            )}
            {hasVideoBContent ? (
              <>
                <div style={{
                  flex: layoutMode === 'reels' ? '1 1 50%' : 1,
                  position: 'relative',
                  minWidth: 0,
                  minHeight: layoutMode === 'reels' ? 0 : undefined,
                  overflow: 'hidden',
                }}>
                  <div
                    ref={attachPanelBContainer}
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      paddingLeft: panelToolbarInset,
                    }}
                    onDragOver={handleDragOverB}
                    onDragLeave={handleDragLeaveB}
                    onDrop={handleDropB}
                  >
                    {youtubeVideoIdB ? (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            pointerEvents: lockEmbedInteractionB ? 'none' : 'auto',
                            opacity: lockEmbedInteractionB ? 0.96 : 1,
                          }}
                        >
                          <YouTubeEmbed
                            videoId={youtubeVideoIdB}
                            onPlayer={(p) => { ytPlayerBRef.current = p; }}
                          />
                        </div>
                        {showUrlLoadingOverlayB ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.72)',
                              color: '#fff',
                              fontSize: 15,
                              fontWeight: 600,
                              pointerEvents: 'none',
                            }}
                          >
                            Loading video…
                          </div>
                        ) : null}
                        {lockEmbedInteractionB ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 6,
                              background: 'transparent',
                              cursor: 'not-allowed',
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {genericEmbedSrcB && !youtubeVideoIdB ? (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <iframe
                          title="Embedded video B"
                          src={genericEmbedSrcB}
                          onLoad={onGenericEmbedIframeLoadB}
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            pointerEvents: lockEmbedInteractionB ? 'none' : 'auto',
                          }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                        {showUrlLoadingOverlayB ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.72)',
                              color: '#fff',
                              fontSize: 15,
                              fontWeight: 600,
                              pointerEvents: 'none',
                            }}
                          >
                            Loading video…
                          </div>
                        ) : null}
                        {lockEmbedInteractionB ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 6,
                              background: 'transparent',
                              cursor: 'not-allowed',
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <CanvasOverlay
                      ref={canvasRefB}
                      videoRef={videoRefB}
                      webcamVideoRef={webcamVideoRef}
                      renderVideo={embedLiveVideoB || (!youtubeVideoIdB && !genericEmbedSrcB)}
                      transparentWhenNoVideo={(!!youtubeVideoIdB || !!genericEmbedSrcB) && !embedLiveVideoB}
                      youtubePose={
                        youtubeVideoIdB && !embedLiveVideoB
                          ? { videoId: youtubeVideoIdB, controllerRef: playbackControllerBRef }
                          : undefined
                      }
                      activeTool={activeTool}
                      drawingOptions={drawingOptions}
                      containerWidth={canvasSizeB.width}
                      containerHeight={canvasSizeB.height}
                      ballTrailMode={ballTrailMode}
                      skeletonEnabled={skeletonEnabled}
                      ballTrailEnabled={ballTrailEnabled}
                      onProcessingStatus={setProcessingStatus}
                      isRecording={isRecording}
                      circleSpinning={circleSpinning}
                      circleGapMode={circleGapMode}
                      webcamPipMode={webcamPipMode}
                      webcamOpacity={webcamOpacity}
                      webcamActive={webcamActive}
                      skeletonShowAngles={skeletonShowAngles}
                      skeletonShowHeadLine={skeletonShowHeadLine}
                      skeletonClassicColors={skeletonClassicColors}
                      skeletonParts={skeletonParts}
                      ballSampleMode={ballSampleMode}
                      rect3d={rect3d}
                      triangle3d={triangle3d}
                      suppressTabCaptureMirror={
                        embedLiveVideoB && (!!youtubeVideoIdB || !!genericEmbedSrcB)
                      }
                      webcamCutout={webcamCutout}
                      precisionTouchDraw={precisionDrawEnabled && showMobileToolStrip}
                      poseFrameSkip={4}
                      panModeEnabled={panModeEnabled}
                      onPanModeToggle={() => setPanModeEnabled((p) => !p)}
                    />
                    <EmbedCapturePanel
                      visible={!!(youtubeVideoIdB || genericEmbedSrcB) && !videoSrcB}
                      embedReady={embedReadyB}
                      sectionSeekSupported={!!youtubeVideoIdB}
                      genericIframeNote={
                        genericEmbedSrcB && !youtubeVideoIdB
                          ? 'If you don’t see the video, it may be blocked from embedding — keep it playing in this tab, tap Capture, then choose This tab when your browser asks what to share.'
                          : undefined
                      }
                      busy={captureBusy && embedCapturePanelId === 'B'}
                      progress01={embedCapturePanelId === 'B' ? captureProgress01 : 0}
                      recordingElapsedSec={embedCapturePanelId === 'B' ? captureRecordingElapsedSec : 0}
                      errorMessage={embedCapturePanelId === 'B' || !embedCapturePanelId ? captureError : null}
                      countdown={embedCapturePanelId === 'B' ? captureCountdown : null}
                      stepStatus={embedCapturePanelId === 'B' ? captureStepStatus : null}
                      onRetry={() => setCaptureError(null)}
                      onCapture={(o) => void handleEmbedCaptureRequest('B', o)}
                    />
                    <button
                      type="button"
                      onClick={removeVideoB}
                      title="Remove Video B from this session"
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 92,
                        padding: '6px 10px',
                        borderRadius: layoutMode === 'reels' ? 0 : 10,
                        border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                        background: layoutMode === 'reels' ? 'rgba(0,0,0,0.4)' : 'rgba(250, 249, 247, 0.94)',
                        color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                        boxShadow: layoutMode === 'reels' ? 'none' : '0 6px 20px rgba(0,0,0,0.08)',
                      }}
                    >
                      Remove Video B
                    </button>
                    <div style={{
                      position: 'absolute', top: 4, left: !isMobile ? panelToolbarInset + 4 : 8,
                      fontSize: '11px', fontWeight: 700,
                      color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A',
                      background: layoutMode === 'reels' ? 'rgba(0,0,0,0.4)' : 'rgba(250,249,247,0.94)',
                      border: layoutMode === 'reels' ? 'none' : '1px solid #E5E5E5',
                      padding: '2px 8px',
                      borderRadius: layoutMode === 'reels' ? 0 : '8px',
                      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                    }}>B</div>
                    {/* Drag-over overlay for Video B */}
                    {isDragOverB && (
                      <div style={{
                        position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
                        background: layoutMode === 'reels' ? 'rgba(0,0,0,0.6)' : 'rgba(250, 249, 247, 0.92)',
                        border: layoutMode === 'reels' ? '3px dashed rgba(255,255,255,0.4)' : '3px dashed #E5E5E5',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: layoutMode === 'reels' ? 0 : '16px',
                      }}>
                        <span style={{ color: layoutMode === 'reels' ? '#FFFFFF' : '#1A1A1A', fontSize: '17px', fontWeight: 600 }}>
                          Drop Video B here
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
            </div>
            {/* Playback controls overlay — positioned inside the video container */}
            <div
              onPointerMove={showControls}
              onPointerDown={showControls}
              onTouchStart={showControls}
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 50,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                padding: isMobile ? `12px 16px calc(16px + env(safe-area-inset-bottom, 0px))` : '12px 16px 16px',
                pointerEvents: 'auto',
                opacity: controlsVisible ? 1 : 0.3,
                transition: 'opacity 0.4s ease',
              }}
            >
              {renderTimelineDock()}
            </div>
          </div>

          {/* Video B offset control */}
          {layoutMode !== 'reels' && (videoSrcB || youtubeVideoIdB || genericEmbedSrcB) && (
            <div
              style={{
                position: 'absolute',
                right: 12,
                bottom: (videoSrcB || youtubeVideoIdB || genericEmbedSrcB) ? 260 : 132,
                zIndex: 80,
                pointerEvents: 'auto',
                padding: '8px 12px',
                borderRadius: 12,
                background: 'rgba(250, 249, 247, 0.96)',
                border: '1px solid #E5E5E5',
                color: '#1A1A1A',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
              }}
              title="Shift Video B start time relative to Video A (seconds)"
            >
              <span style={{ fontWeight: 700 }}>B offset</span>
              <input
                type="number"
                step="0.1"
                value={videoBOffset}
                onChange={e => setVideoBOffset(parseFloat(e.target.value) || 0)}
                style={{
                  width: 76,
                  height: 30,
                  padding: '0 8px',
                  borderRadius: 10,
                  border: '1px solid #E5E5E5',
                  background: '#FFFFFF',
                  color: '#1A1A1A',
                  outline: 'none',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
              <span style={{ color: '#6e6e73' }}>sec</span>
            </div>
          )}

          {/* Hint bar */}
          {false && <div />}
        </main>
      </div>

      {captureError ? (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 205,
            maxWidth: 'min(440px, calc(100vw - 24px))',
            padding: '14px 16px',
            borderRadius: 14,
            background: 'rgba(250, 249, 247, 0.97)',
            border: '1px solid #E5E5E5',
            color: '#1A1A1A',
            boxShadow: '0 16px 44px rgba(0,0,0,0.12)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
            lineHeight: 1.45,
            pointerEvents: 'auto',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <span style={{ flex: '1 1 220px' }}>{captureError}</span>
          <button
            type="button"
            onClick={() => setCaptureError(null)}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              background: '#1A1A1A',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {embedCaptureRecording && (
        <div
          style={{
            position: 'fixed',
            bottom: 132,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            width: 'min(420px, calc(100vw - 32px))',
            pointerEvents: 'none',
            padding: '12px 14px',
            borderRadius: 14,
            background: 'rgba(250, 249, 247, 0.96)',
            border: '1px solid #E5E5E5',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              height: 8,
              borderRadius: 6,
              background: '#E5E5E5',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(Math.min(1, Math.max(0, captureProgress01)) * 100)}%`,
                background: '#1A1A1A',
                transition: 'width 0.15s ease-out',
              }}
            />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: '#1A1A1A', textAlign: 'center', fontWeight: 600 }}>
            Recording your clip… {Math.round(Math.min(1, Math.max(0, captureProgress01)) * 100)}%
          </div>
        </div>
      )}

      {showCaptureSaveToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 210,
            maxWidth: 'min(440px, calc(100vw - 24px))',
            padding: '14px 16px',
            borderRadius: 14,
            background: 'rgba(250, 249, 247, 0.97)',
            border: '1px solid #E5E5E5',
            color: '#1A1A1A',
            boxShadow: '0 16px 44px rgba(0,0,0,0.12)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <span style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Your video is ready to analyse.</span>
            <span style={{ color: '#6e6e73' }}>
              Download a copy, upload to your YouTube as unlisted, or dismiss.
            </span>
            {captureDownloadStatus === 'preparing' && (
              <span style={{ fontSize: 11, color: '#6e6e73', fontWeight: 500 }}>
                Processing your video… almost ready.
              </span>
            )}
            {captureDownloadStatus === 'ready_webm' && (
              <span style={{ fontSize: 11, fontWeight: 500, color: '#b45309' }}>
                We couldn&apos;t prepare the usual save file — your download will still play in most video apps.
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={captureDownloadStatus === 'preparing'}
            onClick={() => {
              handleDownloadCaptureBlob();
              setShowCaptureSaveToast(false);
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              background: captureDownloadStatus === 'preparing' ? '#F5F5F5' : '#1A1A1A',
              color: captureDownloadStatus === 'preparing' ? '#9ca3af' : '#FFFFFF',
              fontWeight: 600,
              cursor: captureDownloadStatus === 'preparing' ? 'not-allowed' : 'pointer',
            }}
          >
            {captureDownloadStatus === 'ready_webm' ? 'Download video' : 'Download MP4'}
          </button>
          <button
            type="button"
            disabled={
              captureDownloadStatus === 'preparing' || captureYoutubeBusy
            }
            onClick={() => void handleYoutubeUploadCapture()}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              background: captureYoutubeBusy ? '#F5F5F5' : '#FFFFFF',
              color: '#1A1A1A',
              fontWeight: 600,
              cursor:
                captureDownloadStatus === 'preparing' || captureYoutubeBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {captureYoutubeBusy ? 'Uploading…' : 'Upload to YouTube (Unlisted)'}
          </button>
          <button
            type="button"
            onClick={() => setShowCaptureSaveToast(false)}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              background: '#FFFFFF',
              color: '#1A1A1A',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Not now
          </button>
        </div>
      )}

      <SaveReportModal
        open={captureSaveModalOpen}
        onClose={() => {
          setCaptureSaveModalOpen(false);
          setCaptureYoutubeUrl(null);
        }}
        folderLabel={`${localDateTimeForFolder()} — Analysis recording`}
        bodyText=""
        youtubeUrl={captureYoutubeUrl}
        source="analysis_capture"
      />

      <PrecisionDrawInstructions
        open={precisionInstructionsOpen}
        onDismiss={dismissPrecisionInstructions}
      />

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
    </div>
  );
}
