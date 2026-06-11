'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import { Camera, Plus, Trash2, Upload } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode, type WebcamPipMode } from '@/components/ToolPalette';
import PreciseTimeline from '@/components/PreciseTimeline';
import { RecordingHubContent, type RecordingArea } from '@/components/RecordingHub';
import PostRecordingCropModal, { type CropAspect, type PixelRegion } from '@/components/PostRecordingCropModal';
import { exportCroppedVideo } from '@/lib/cropExport';
import GuidedTour from '@/components/GuidedTour';
import { terminateGlobalPoseWorker, warmupMoveNetWorker } from '@/lib/poseWorkerBridge';
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
import {
  captureLog,
  destroyYouTubeEmbedHard,
  flushCaptureIsolationMs,
  handleCaptureError,
  isolateYouTubePlayerSync,
} from '@/lib/embedCaptureSession';
import { getTabCaptureStream, stopAllTracks } from '@/lib/tabCaptureRecording';
import { convertWebmBlobToMp4, disposeFfmpegWasm } from '@/lib/ffmpegWebmToMp4';
import SaveReportModal from '@/components/shared/SaveReportModal';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';

// Dynamic import prevents TensorFlow / Fabric from loading server-side
const CanvasOverlay = dynamic(() => import('@/components/Canvas'), { ssr: false });

// Tools that draw on the canvas and own the draw "context" (style controls).
const DRAW_CONTEXT_TOOLS: ToolType[] = [
  'pen', 'line', 'arrow', 'arrowAngle', 'circle', 'rect', 'triangle',
  'bodyCircle', 'text', 'angle', 'manualSwing', 'swingPath', 'jointChain',
];

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

/** YouTube iframe API getDuration can throw minified errors (e.g. this.g.src) during teardown. */
function safeYoutubePlayerDuration(player: unknown): number | null {
  try {
    const d = (player as { getDuration?: () => unknown })?.getDuration?.();
    return typeof d === 'number' && Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

/** Desktop reels: letterboxed true 9:16 frame with toolbar inside. */
function ReelsDesktopShell({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#000',
      }}
    >
      <div
        style={{
          // Fill the flex slot's height (not the raw viewport) so the frame can
          // never overflow its parent and clip the bottom controls; derive the
          // 9:16 width from that height via aspect-ratio.
          height: '100%',
          maxHeight: '100%',
          aspectRatio: '9 / 16',
          width: 'auto',
          maxWidth: '100vw',
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          flexShrink: 0,
          background: '#000',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

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
  /** Black embed frame (YouTube or generic iframe) — used to crop tab capture to video pixels only. */
  const embedCaptureCropTargetRefA = useRef<HTMLDivElement | null>(null);
  const embedCaptureCropTargetRefB = useRef<HTMLDivElement | null>(null);
  const genericEmbedIframeRefA = useRef<HTMLIFrameElement | null>(null);
  const genericEmbedIframeRefB = useRef<HTMLIFrameElement | null>(null);
  /** Measured height of the pinned playback dock — toolbars sit above this + gap. */
  const playbackDockRef = useRef<HTMLDivElement | null>(null);
  // Callback ref so the ResizeObserver re-attaches whenever the dock (re)mounts,
  // even when it appears after the first effect run (e.g. once a video loads).
  const [playbackDockEl, setPlaybackDockEl] = useState<HTMLDivElement | null>(null);
  const setPlaybackDock = useCallback((el: HTMLDivElement | null) => {
    playbackDockRef.current = el;
    setPlaybackDockEl(el);
  }, []);
  const sessionCaptureBlobRef = useRef<Blob | null>(null);
  /** Converted MP4 for download (original WebM stays in sessionCaptureBlobRef for playback). */
  const sessionMp4BlobRef = useRef<Blob | null>(null);
  const captureMp4ConversionGenRef = useRef(0);
  const embedCaptureRetryPayloadRef = useRef<{
    panel: 'A' | 'B';
    opts: { mode: 'full' | 'section'; startSec: number | null; endSec: number | null };
  } | null>(null);

  type EmbedCaptureShareBundle = {
    panel: 'A' | 'B';
    opts: { mode: 'full' | 'section'; startSec: number | null; endSec: number | null };
    isoRestore: (() => void) | null;
    ytSnap: any;
    nulledYtRef: boolean;
    isYt: boolean;
    /** YouTube iframe was destroyed before capture — never pass ytSnap to the recorder. */
    ytHardDestroyed: boolean;
    youtubeDurationHintSec: number | null;
  };
  const embedCaptureShareBundleRef = useRef<EmbedCaptureShareBundle | null>(null);
  /**
   * Capture cancellation flag. Set to `true` from `resetSession()` or any other
   * intentional teardown path; the flow polls this at every await checkpoint and
   * exits cleanly with `cancelled: true`. Reset to `false` at the start of each
   * new capture attempt. Avoids a stale-error toast after the user pressed "New".
   */
  const embedCaptureCancelRef = useRef(false);
  /**
   * Guard against double-firing of `shareEmbedDisplayMediaFromUserGesture`.
   * Without this, a double-tap on the share button can spawn two
   * `getTabCaptureStream()` calls, only one of which we can clean up.
   */
  const embedShareInFlightRef = useRef(false);
  /** Fallback embed-ready timer (ms) when onReady / iframe onLoad does not fire. */
  const EMBED_READY_FALLBACK_MS = 1200;
  const HUB_EMBED_READY_MS = 100;

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool]       = useState<ToolType>('select');
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
  const [micMuted, setMicMuted]           = useState(false);
  const screenRecordBlobRef               = useRef<{ blob: Blob; ext: string } | null>(null);
  const [screenRecordDownloadPending, setScreenRecordDownloadPending] = useState(false);
  // Phase 3: recording is always captured full screen; cropping (if any) is
  // chosen afterward in the post-recording modal and applied via post-processing.
  // `recordingArea` is UI-only metadata from the optional "Set recording area".
  const [recordingArea, setRecordingArea] = useState<RecordingArea | null>(null);
  const [recordingSession, setRecordingSession] = useState<{
    videoBlob: Blob | null;
    ext: string;
    mode: 'full' | 'selected-area';
    cropRegion: null | { x: number; y: number; width: number; height: number; aspectRatio?: CropAspect };
  } | null>(null);
  const [isRecording, setIsRecording]     = useState(false);
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
  const [videoBOffset, setVideoBOffset]   = useState(0);
  const [videoBDuration, setVideoBDuration] = useState(0);
  const [playBothEnabled, setPlayBothEnabled] = useState(false);
  const [circleSpinning, setCircleSpinning] = useState(false);
  const [outlineEraserSize, setOutlineEraserSize] = useState(0);
  const [skeletonShowAngles, setSkeletonShowAngles] = useState(true);
  const [skeletonShowHeadLine, setSkeletonShowHeadLine] = useState(false);
  const [skeletonClassicColors, setSkeletonClassicColors] = useState(true);
  const [skeletonShowRightArm, setSkeletonShowRightArm] = useState(true);
  const [skeletonShowLeftArm, setSkeletonShowLeftArm] = useState(true);
  const [skeletonShowRightLeg, setSkeletonShowRightLeg] = useState(true);
  const [skeletonShowLeftLeg, setSkeletonShowLeftLeg] = useState(true);
  const [ballSampleMode, setBallSampleMode] = useState(false);
  const [webcamPipMode, setWebcamPipMode]   = useState<WebcamPipMode>('rectangle');
  const [webcamOpacity]                     = useState(1);
  const [urlInput, setUrlInput]             = useState('');
  const [urlTarget, setUrlTarget]           = useState<'A' | 'B'>('A');
  /** Which stream the unified timeline controls (AB = sync both for uploaded HTML5 pairs). */
  const [playbackTarget, setPlaybackTarget] = useState<'A' | 'B' | 'AB'>('A');
  /** Which video panel receives undo / clear / new drawings when comparing. */
  const [markupTarget, setMarkupTarget] = useState<'A' | 'B' | 'both'>('A');
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Distance from bottom of video stage to reserve for playback UI + 16px gap (px). */
  const [toolbarBottomReservePx, setToolbarBottomReservePx] = useState(166);
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
    }, EMBED_READY_FALLBACK_MS);
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
    }, EMBED_READY_FALLBACK_MS);
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
  /** Non-blocking coach banner during embed capture (countdown + record) — video stays visible */
  const [captureCoachBanner, setCaptureCoachBanner] = useState(false);
  /** True only from the moment MediaRecorder.startCapture() fires — drives the recording timer. */
  const [captureActuallyRecording, setCaptureActuallyRecording] = useState(false);
  /**
   * Post-recording banner phase so the coach sees "Processing your video…" and
   * "Your video is ready" without abruptly switching to just the download toast.
   * 'hidden'     → banner not shown (before capture or after dismiss)
   * 'processing' → recording finished, MP4 conversion in flight
   * 'ready'      → blob available, transitioning to download toast
   */
  const [capturePostPhase, setCapturePostPhase] = useState<'hidden' | 'processing' | 'ready'>('hidden');
  /** Recording Studio side panel open/closed. */
  const hubAltStreamRef = useRef<MediaStream | null>(null);
  const [altScreenRecordMessage, setAltScreenRecordMessage] = useState<string | null>(null);
  const [embedCaptureConsecutiveFailures, setEmbedCaptureConsecutiveFailures] = useState(0);
  const [captureFallbackStreamUrl, setCaptureFallbackStreamUrl] = useState<string | null>(null);
  /** Step 2 of embed capture: isolation done; coach must tap Share Screen (Safari gesture) */
  const [embedCaptureAwaitingShare, setEmbedCaptureAwaitingShare] = useState<'A' | 'B' | null>(null);
  /** YouTube embed removed for capture — show placeholder until cancel (remount) or success (blob). */
  const [embedYtKilledA, setEmbedYtKilledA] = useState(false);
  const [embedYtKilledB, setEmbedYtKilledB] = useState(false);
  const [ytPlayerRemountNonceA, setYtPlayerRemountNonceA] = useState(0);
  const [ytPlayerRemountNonceB, setYtPlayerRemountNonceB] = useState(0);
  /** Panel that started capture (isolation / GDM) before embedCapturePanelId is set for live canvas */
  const [capturePrepPanel, setCapturePrepPanel] = useState<'A' | 'B' | null>(null);
  /** True while the hub is waiting for the embed to mount after loading a URL. */
  const [hubCaptureLoading, setHubCaptureLoading] = useState(false);
  /** Which slot the hub's screen-record flow is targeting. */
  const [hubCaptureTarget, setHubCaptureTarget] = useState<'A' | 'B' | null>(null);

  useEffect(() => {
    if (!captureActuallyRecording) {
      setCaptureRecordingElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const iv = window.setInterval(() => {
      setCaptureRecordingElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    return () => window.clearInterval(iv);
  }, [captureActuallyRecording]);

  // Transition banner from "processing" → "ready" once the blob is prepared.
  useEffect(() => {
    if (captureDownloadStatus === 'ready_mp4' || captureDownloadStatus === 'ready_webm') {
      setCapturePostPhase((p) => (p === 'processing' ? 'ready' : p));
    }
  }, [captureDownloadStatus]);

  // Auto-dismiss the "Your video is ready" banner after 4 s so the download toast
  // (showCaptureSaveToast) takes over without needing an explicit dismiss tap.
  useEffect(() => {
    if (capturePostPhase !== 'ready') return;
    const id = window.setTimeout(() => setCapturePostPhase('hidden'), 4_000);
    return () => window.clearTimeout(id);
  }, [capturePostPhase]);

  /** True when Safari (or any browser) blocked video.play() and we need a user-gesture tap */
  const [showTapToPlay, setShowTapToPlay]   = useState(false);
  /** Drag-over state for the two video panels */
  const [isDragOverA, setIsDragOverA]       = useState(false);
  const [isDragOverB, setIsDragOverB]       = useState(false);
  const [drawContextActive, setDrawContextActive] = useState(false);
  const [isMobile, setIsMobile]             = useState(false);
  /** Large tap targets only on real phones — desktop 9:16 preview keeps compact UI */
  const touchChrome                         = isMobile;

  // StroMotion state
  const [stroMotionEnabled, setStroMotionEnabled] = useState(false);
  const [stroMotionStart, setStroMotionStart]     = useState(0);
  const [stroMotionEnd, setStroMotionEnd]         = useState(3);
  const [stroMotionCount, setStroMotionCount]     = useState(6);
  const [stroMotionOpacity, setStroMotionOpacity] = useState(0.3);
  const [stroMotionRegion, setStroMotionRegion]   = useState<{ x: number; y: number; w: number; h: number } | undefined>(undefined);

  // Object Multiplier state
  const [objMultiplierFrameCount, setObjMultiplierFrameCount] = useState(5);
  const [objMultiplierHasRegion, setObjMultiplierHasRegion] = useState(false);
  const [objMultiplierProgress, setObjMultiplierProgress] = useState<string | null>(null);

  // Derived: skeleton / ball trail enabled when their tool is active
  const skeletonEnabled  = activeTool === 'skeleton';
  /** When false, pose still runs but overlay is hidden (coach can turn off drawing without Clear All). */
  const [skeletonOverlayPaused, setSkeletonOverlayPaused] = useState(false);
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
    setDrawContextActive(DRAW_CONTEXT_TOOLS.includes(t));
    if (t === 'objectMultiplier') {
      setObjMultiplierHasRegion(false);
      setObjMultiplierProgress(null);
    }
  }, []);

  const exitDrawContext = useCallback(() => {
    setDrawContextActive(false);
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
    const onBeforeUnload = () => {
      disposeFfmpegWasm();
      terminateGlobalPoseWorker();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      disposeFfmpegWasm();
      terminateGlobalPoseWorker();
    };
  }, []);

  /** Preload MoveNet in a worker once per analysis session (no UI toggle required). */
  useEffect(() => {
    warmupMoveNetWorker();
  }, []);

  useEffect(() => {
    if (activeTool === 'objectMultiplier') {
      canvasRef.current?.startObjMultiplierRegionSelect?.();
    }
  }, [activeTool]);

  useEffect(() => {
    // Width-only detection misclassified landscape phones (wider than 768px) as
    // desktop, so they missed mobile chrome, precision draw, the mobile timeline
    // and webcam insets. Also treat coarse-pointer (touch) devices up to 1024px
    // as mobile so landscape phones get the touch layout.
    const mq = window.matchMedia(
      '(max-width: 768px), ((hover: none) and (pointer: coarse) and (max-width: 1024px))',
    );
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Icon-only tool rail below 768px (narrow width); desktop keeps labels */
  const [toolbarIconOnlyLayout, setToolbarIconOnlyLayout] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setToolbarIconOnlyLayout(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  /** Mobile + tablet: in-flow tool rail (precision toggle lives here). */
  const [showMobileToolStrip, setShowMobileToolStrip] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const fn = () => setShowMobileToolStrip(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const TOOLBAR_EXPANDED_W = 208;
  const TOOLBAR_COLLAPSED_W = 56;
  const TOOLBAR_MOBILE_W = 40;
  const TOOLBAR_MOBILE_FIXED_W = 48;
  const TOOLBAR_COMPACT_EXPANDED_W = 112;
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('coachlab-toolbar-collapsed') === '1') {
        setToolbarCollapsed(true);
      }
    } catch {
      /* noop */
    }
  }, []);

  const toggleToolbarCollapsed = useCallback(() => {
    setToolbarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('coachlab-toolbar-collapsed', next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const reelsDesktopEarly = !isMobile && layoutMode === 'reels';
  const phoneToolbarLayout = isMobile || showMobileToolStrip || reelsDesktopEarly;

  const [toolbarLabelsExpanded, setToolbarLabelsExpanded] = useState(false);

  const compactToolbarRail = phoneToolbarLayout || (!isMobile && toolbarCollapsed);

  const toolbarWidthPx = useMemo(() => {
    if (isMobile) return TOOLBAR_MOBILE_FIXED_W;
    if (compactToolbarRail) {
      return toolbarLabelsExpanded ? TOOLBAR_COMPACT_EXPANDED_W : TOOLBAR_MOBILE_W;
    }
    if (toolbarCollapsed) return TOOLBAR_COLLAPSED_W;
    return TOOLBAR_EXPANDED_W;
  }, [isMobile, compactToolbarRail, toolbarCollapsed, toolbarLabelsExpanded]);

  const showToolbarRail = isMobile ? showMobileToolStrip : true;

  const [precisionDrawEnabled, setPrecisionDrawEnabled] = useState(false);
  const [precisionInstructionsOpen, setPrecisionInstructionsOpen] = useState(false);

  useEffect(() => {
    if (!isMobile && precisionDrawEnabled) setPrecisionDrawEnabled(false);
  }, [isMobile, precisionDrawEnabled]);

  const handlePrecisionDrawToggle = useCallback(() => {
    setPrecisionDrawEnabled((prev) => {
      const next = !prev;
      if (next) {
        const nonDraw =
          activeTool === 'zoom' ||
          activeTool === 'skeleton' ||
          activeTool === 'select' ||
          activeTool === 'ballShadow' ||
          activeTool === 'objectMultiplier';
        if (nonDraw) setActiveTool('pen');
        if (typeof window !== 'undefined' && !hasSeenPrecisionInstructions()) {
          queueMicrotask(() => setPrecisionInstructionsOpen(true));
        }
      }
      return next;
    });
  }, [activeTool]);

  const dismissPrecisionInstructions = useCallback(() => {
    markPrecisionInstructionsSeen();
    setPrecisionInstructionsOpen(false);
  }, []);

  const showPrecisionInstructionsAgain = useCallback(() => {
    setPrecisionInstructionsOpen(true);
  }, []);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    const bump = () => {
      try {
        if (video.readyState >= 1) video.currentTime = 0.001;
      } catch {
        /* noop */
      }
    };
    video.addEventListener('loadeddata', bump, { once: true });
    bump();
    return () => video.removeEventListener('loadeddata', bump);
  }, [videoSrc]);

  useEffect(() => {
    const video = videoRefB.current;
    if (!video || !videoSrcB) return;
    const bump = () => {
      try {
        if (video.readyState >= 1) video.currentTime = 0.001;
      } catch {
        /* noop */
      }
    };
    video.addEventListener('loadeddata', bump, { once: true });
    bump();
    return () => video.removeEventListener('loadeddata', bump);
  }, [videoSrcB]);

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

  const TOOLBAR_PLAYBACK_GAP_PX = 16;

  useLayoutEffect(() => {
    const el = playbackDockEl;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const h = el.offsetHeight;
      setToolbarBottomReservePx(Math.max(120, h + TOOLBAR_PLAYBACK_GAP_PX));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [playbackDockEl]);

  // Expose the playback-dock clearance as a CSS custom property so that the
  // global InstallPrompt banner (rendered in app/layout.tsx) can position
  // itself above the controls without any prop drilling or context.
  // The measured value already includes env(safe-area-inset-bottom) because
  // the dock's padding-bottom on mobile contains that env() value.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--coachlab-banner-bottom',
      `calc(${toolbarBottomReservePx}px + var(--coachlab-install-banner-height, 0px))`,
    );
    return () => {
      document.documentElement.style.removeProperty('--coachlab-banner-bottom');
    };
  }, [toolbarBottomReservePx]);

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
    // Signal any in-flight embed capture to abort cleanly. Even if the flow is
    // mid-countdown, mid-await, or mid-recording loop, the cancel check at each
    // await point will catch this and run the cleaner before exiting.
    embedCaptureCancelRef.current = true;
    embedShareInFlightRef.current = false;
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
    setCaptureActuallyRecording(false);
    setEmbedCapturePanelId(null);
    setCapturePrepPanel(null);
    setEmbedCaptureAwaitingShare(null);
    setEmbedYtKilledA(false);
    setEmbedYtKilledB(false);
    embedCaptureShareBundleRef.current = null;
    setCaptureCoachBanner(false);
    setEmbedCaptureConsecutiveFailures(0);
    setCaptureFallbackStreamUrl(null);
    setCaptureProgress01(0);
    setShowCaptureSaveToast(false);
    setCapturePostPhase('hidden');
    // Hub screen-record flow reset
    setHubCaptureLoading(false);
    setHubCaptureTarget(null);
    // Clear any lingering recording UI so a "clean session" never leaves the
    // top Recording pill, countdown, step status, or download prompt behind.
    setIsRecording(false);
    setCaptureCountdown(null);
    setCaptureStepStatus(null);
    setScreenRecordDownloadPending(false);
    setRecordingSession(null);
    setRecordingArea(null);
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
  const resetToolAfterVideoLoad = useCallback(() => {
    setActiveTool('select');
    setDrawContextActive(false);
  }, []);

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
    resetToolAfterVideoLoad();
    // Allow uploading the same file again without needing a page refresh.
    e.target.value = '';
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl, resetToolAfterVideoLoad]);

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
    resetToolAfterVideoLoad();
    e.target.value = '';
  }, [cleanupVideoEl, revokeBlobUrl, resetToolAfterVideoLoad]);

  /**
   * Direct-file handler for the RecordingHub Publer drop zone.
   * Mirrors handleVideoUpload / handleVideoUploadB but accepts a File object
   * directly (no synthetic input event) so the drop zone in RecordingHub
   * can hand the file straight here without rewriting the existing upload path.
   */
  const handleVideoFile = useCallback((file: File, target: 'A' | 'B') => {
    if (target === 'A') {
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
      setProcessingStatus(null);
      setStroMotionEnabled(false);
      setStroMotionRegion(undefined);
      clearGhosts();
      canvasRef.current?.clearAll();
      resetToolAfterVideoLoad();
    } else {
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
      resetToolAfterVideoLoad();
    }
  }, [cleanupVideoEl, clearGhosts, revokeBlobUrl, resetToolAfterVideoLoad]);

  // ── Hub "Alternative — Screen Record" flow ────────────────────────────────

  /**
   * Load a URL into the target slot as an embed (Recording Hub alt flow).
   * Shows loading feedback immediately; coach picks record options on the video panel.
   */
  const handleHubCaptureLoad = useCallback((url: string, target: 'A' | 'B') => {
    const raw = normalizeWebUrlInput(url);
    if (!raw) return;

    embedCaptureCancelRef.current = false;
    embedShareInFlightRef.current = false;
    embedCaptureShareBundleRef.current = null;
    setEmbedCaptureAwaitingShare(null);

    flushSync(() => {
      setHubCaptureLoading(true);
      setHubCaptureTarget(target);
      setCaptureError(null);
    });

    if (target === 'A') {
      setEmbedReadyA(false);
      revokeBlobUrl(lastBlobUrlARef.current);
      lastBlobUrlARef.current = null;
      setVideoSrc(null);
      setGenericEmbedSrcA(null);
      setYoutubeVideoIdA(null);
      if (videoRef.current) cleanupVideoEl(videoRef.current);
    } else {
      setEmbedReadyB(false);
      revokeBlobUrl(lastBlobUrlBRef.current);
      lastBlobUrlBRef.current = null;
      setVideoSrcB(null);
      setGenericEmbedSrcB(null);
      setYoutubeVideoIdB(null);
      if (videoRefB.current) cleanupVideoEl(videoRefB.current);
      setVideoBLoaded(false);
    }

    const resolved = resolveEmbedTarget(raw);
    if (resolved?.kind === 'youtube') {
      if (target === 'A') {
        setYtPlayerRemountNonceA((n) => n + 1);
        setYoutubeVideoIdA(resolved.videoId);
      } else {
        setYtPlayerRemountNonceB((n) => n + 1);
        setYoutubeVideoIdB(resolved.videoId);
      }
    } else if (resolved?.kind === 'iframe') {
      if (target === 'A') setGenericEmbedSrcA(resolved.src);
      else setGenericEmbedSrcB(resolved.src);
    } else if (target === 'A') {
      setGenericEmbedSrcA(raw);
    } else {
      setGenericEmbedSrcB(raw);
    }
  }, [cleanupVideoEl, revokeBlobUrl]);

  /** Cancel a hub-initiated capture before or during the share step. */
  const handleHubCaptureCancel = useCallback(() => {
    setHubCaptureLoading(false);
    setHubCaptureTarget(null);
    setAltScreenRecordMessage(null);
    stopAllTracks(hubAltStreamRef.current);
    hubAltStreamRef.current = null;
    embedCaptureCancelRef.current = true;
    setEmbedCaptureAwaitingShare(null);
    embedCaptureShareBundleRef.current = null;
    setCaptureBusy(false);
    setEmbedCaptureRecording(false);
    setEmbedCapturePanelId(null);
    // Mirror the shared clearCapturePrepUi reset so cancelling never leaves the
    // bottom coach banner, countdown, step status, progress, or post-processing
    // UI active. (clearCapturePrepUi is declared later, so we reset inline.)
    setCapturePrepPanel(null);
    setCaptureCoachBanner(false);
    setCaptureActuallyRecording(false);
    setCaptureCountdown(null);
    setCaptureStepStatus(null);
    setCaptureProgress01(0);
    setCapturePostPhase('hidden');
  }, []);

  /** Alt URL flow: getDisplayMedia first (Safari), then load embed and auto-record when playing. */
  const handleHubAltScreenRecordStart = useCallback(
    (url: string, target: 'A' | 'B') => {
      const raw = normalizeWebUrlInput(url);
      if (!raw) return;
      setAltScreenRecordMessage(
        'Please wait — turn your volume up and remove headphones if you want audio recorded',
      );
      embedCaptureCancelRef.current = false;
      embedShareInFlightRef.current = true;
      setHubCaptureLoading(true);
      setHubCaptureTarget(target);
      setCaptureError(null);

      getTabCaptureStream()
        .then((stream) => {
          embedShareInFlightRef.current = false;
          if (embedCaptureCancelRef.current) {
            stopAllTracks(stream);
            setHubCaptureLoading(false);
            setAltScreenRecordMessage(null);
            return;
          }
          hubAltStreamRef.current = stream;
          handleHubCaptureLoad(raw, target);
        })
        .catch((e: unknown) => {
          embedShareInFlightRef.current = false;
          setHubCaptureLoading(false);
          setAltScreenRecordMessage(null);
          if (!embedCaptureCancelRef.current) {
            setCaptureError(handleCaptureError(e, 'getDisplayMedia').friendly);
          }
        });
    },
    [handleHubCaptureLoad],
  );

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

    // Banded drift correction (B is muted, so trimming its playbackRate is
    // inaudible). Small skew is corrected by nudging B's rate to close the gap
    // — no <video> seek, no decoder flush — and a hard seek is reserved for
    // large desyncs that a rate trim cannot recover quickly.
    const DRIFT_DEADBAND = 0.05; // <=50 ms: treat as in sync, run at A's rate
    const DRIFT_HARD_SEEK = 0.35; // >350 ms (or out of range): snap once
    const DRIFT_RATE_NUDGE = 0.06; // +/-6% rate trim in the soft band
    // Steady-state drift only needs checking a handful of times per second; the
    // loop still reschedules every rAF frame (cheap) but runs its correction
    // body at ~15 Hz to stay off the main-thread budget during playback.
    const DRIFT_INTERVAL_MS = 66; // ~15 Hz
    let lastDriftRunTs = 0;
    let playPendingB = false;
    let rafId = 0;

    const bTarget = () => vA.currentTime - videoBOffset;
    const bInRange = (t: number) => t >= 0 && t <= videoBDuration;

    // ── Event handlers: respond instantly to user actions on A ──

    const onPlayA = () => {
      const t = bTarget();
      if (bInRange(t) && vB.paused && !playPendingB) {
        vB.currentTime = t;
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
      if (vA.paused || !playBothEnabled) {
        rafId = 0;
        return;
      }

      const tnow = performance.now();
      if (tnow - lastDriftRunTs >= DRIFT_INTERVAL_MS) {
        lastDriftRunTs = tnow;

        const t = bTarget();

        if (!vA.paused) {
          if (bInRange(t)) {
            const base = vA.playbackRate;
            const signedDrift = t - vB.currentTime; // + => B is behind target
            const drift = Math.abs(signedDrift);

            if (drift > DRIFT_HARD_SEEK) {
              // Too far out of sync for a rate trim to recover quickly — snap
              // once and restore the exact rate.
              vB.currentTime = t;
              if (vB.playbackRate !== base) vB.playbackRate = base;
            } else if (drift > DRIFT_DEADBAND) {
              // Soft-correct: nudge B's rate toward A to close the gap. No seek.
              const target = signedDrift > 0
                ? base * (1 + DRIFT_RATE_NUDGE)   // B behind → speed up
                : base * (1 - DRIFT_RATE_NUDGE);  // B ahead  → slow down
              if (vB.playbackRate !== target) vB.playbackRate = target;
            } else {
              // Within deadband — run at A's exact rate (ends any nudge).
              if (vB.playbackRate !== base) vB.playbackRate = base;
            }

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
      }

      rafId = requestAnimationFrame(correctDrift);
    };

    const startDriftLoop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(correctDrift);
    };

    const stopDriftLoop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    // Initial alignment
    vB.playbackRate = vA.playbackRate;
    const t0 = bTarget();
    if (bInRange(t0)) vB.currentTime = t0;

    if (!vA.paused) startDriftLoop();

    const onPlayStartDrift = () => startDriftLoop();
    const onPauseStopDrift = () => stopDriftLoop();
    vA.addEventListener('play', onPlayStartDrift);
    vA.addEventListener('pause', onPauseStopDrift);

    return () => {
      stopDriftLoop();
      vA.removeEventListener('play', onPlayStartDrift);
      vA.removeEventListener('pause', onPauseStopDrift);
      vA.removeEventListener('play', onPlayA);
      vA.removeEventListener('pause', onPauseA);
      vA.removeEventListener('seeking', onSeekingA);
      vA.removeEventListener('ratechange', onRateA);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoBLoaded, videoBOffset, videoBDuration, playBothEnabled, youtubeVideoIdA, genericEmbedSrcA]);

  // ── Webcam ────────────────────────────────────────────────────────────────
  const setAudioMuted = useCallback((muted: boolean) => {
    setMicMuted(muted);
    micStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    webcamStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, []);

  const stopWebcam = useCallback(() => {
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    setWebcamActive(false);
    if (!micStreamRef.current) {
      setMicActive(false);
      setMicMuted(false);
    }
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
      setMicActive(true);
      setMicMuted(false);
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
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
      setMicMuted(false);
    } catch (err) {
      console.error('[page] Mic access denied:', err);
      alert('Could not access microphone. Please check browser permissions.');
    }
  }, []);

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (!webcamActive) {
      setMicActive(false);
      setMicMuted(false);
    }
  }, [webcamActive]);

  const toggleMic = useCallback(() => {
    if (!micActive && !webcamActive) {
      void startMic();
      return;
    }
    setAudioMuted(!micMuted);
  }, [micActive, micMuted, webcamActive, startMic, setAudioMuted]);

  // ── Screenshot ────────────────────────────────────────────────────────────
  const handleScreenshotVideoOnly = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    downloadDataURL(canvas.toDataURL('image/png'), `coach-lab-video-${Date.now()}.png`);
  }, []);

  const handleScreenshotEntireScreen = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      alert('Screen capture is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((r) => window.setTimeout(r, 250));
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const snap = document.createElement('canvas');
      snap.width = w;
      snap.height = h;
      snap.getContext('2d')?.drawImage(video, 0, 0, w, h);
      stopAllTracks(stream);
      downloadDataURL(snap.toDataURL('image/png'), `coach-lab-screen-${Date.now()}.png`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      alert('Could not capture screenshot.');
    }
  }, []);

  const handleScreenRecordComplete = useCallback((blob: Blob, ext: string) => {
    // Phase 3: always full screen. If the user pre-selected a recording area,
    // open the post-record modal straight into crop mode (area seeds the crop box).
    setRecordingSession({
      videoBlob: blob,
      ext,
      mode: recordingArea ? 'selected-area' : 'full',
      cropRegion: null,
    });
  }, [recordingArea]);

  const handleResetRecordingSettings = useCallback(() => {
    setRecordingArea(null);
    setLayoutMode('youtube');
    if (webcamActive) void toggleWebcam();
    if (micActive) toggleMic();
  }, [webcamActive, micActive, toggleWebcam, toggleMic]);

  const downloadBlob = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coach-lab-recording-${Date.now()}.${ext}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  const handleRecordingReviewCancel = useCallback(() => {
    setRecordingSession(null);
  }, []);

  const handleRecordingDownloadFull = useCallback(() => {
    const session = recordingSession;
    if (!session?.videoBlob) return;
    setRecordingSession((s) => (s ? { ...s, mode: 'full', cropRegion: null } : s));
    downloadBlob(session.videoBlob, session.ext);
    setRecordingSession(null);
  }, [recordingSession, downloadBlob]);

  const handleRecordingExportCrop = useCallback(
    async (region: PixelRegion, aspect: CropAspect) => {
      const session = recordingSession;
      const src = session?.videoBlob;
      if (!src) return;

      setRecordingSession((s) =>
        s
          ? {
              ...s,
              mode: 'selected-area',
              cropRegion: {
                x: Math.round(region.x),
                y: Math.round(region.y),
                width: Math.round(region.w),
                height: Math.round(region.h),
                aspectRatio: aspect,
              },
            }
          : s,
      );

      const result = await exportCroppedVideo(src, region);
      if (!result.ok) {
        throw new Error(result.error || 'Could not crop the recording.');
      }
      downloadBlob(result.blob, result.ext);
      setRecordingSession(null);
    },
    [recordingSession, downloadBlob],
  );

  // Pre-record area metadata -> fraction of the screen, used to seed the crop box.
  const recordingAreaSeed = useMemo(() => {
    if (!recordingArea || typeof window === 'undefined') return null;
    const sw = window.innerWidth || 1;
    const sh = window.innerHeight || 1;
    return {
      frac: {
        x: recordingArea.x / sw,
        y: recordingArea.y / sh,
        w: recordingArea.width / sw,
        h: recordingArea.height / sh,
      },
      aspect: recordingArea.aspectRatio,
    };
  }, [recordingArea]);

  const handleScreenRecordDownloadYes = useCallback(() => {
    const pack = screenRecordBlobRef.current;
    if (!pack) return;
    const url = URL.createObjectURL(pack.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coach-lab-recording-${Date.now()}.${pack.ext}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    screenRecordBlobRef.current = null;
    setScreenRecordDownloadPending(false);
  }, []);

  const handleScreenRecordDownloadNo = useCallback(() => {
    screenRecordBlobRef.current = null;
    setScreenRecordDownloadPending(false);
  }, []);

  const handleDismissCaptureDownload = useCallback(() => {
    setCaptureDownloadStatus('idle');
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
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

  const handleAddVideoB = useCallback(() => {
    setUrlTarget('B');
    fileInputRefB.current?.click();
  }, []);

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

  const markEmbedReadyA = useCallback(() => {
    if (iframeLoadTimerARef.current) {
      clearTimeout(iframeLoadTimerARef.current);
      iframeLoadTimerARef.current = null;
    }
    setEmbedReadyA(true);
  }, []);

  const markEmbedReadyB = useCallback(() => {
    if (iframeLoadTimerBRef.current) {
      clearTimeout(iframeLoadTimerBRef.current);
      iframeLoadTimerBRef.current = null;
    }
    setEmbedReadyB(true);
  }, []);

  const iframeLoadTimerARef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGenericEmbedIframeLoadA = useCallback(() => {
    if (!youtubeVideoIdA && genericEmbedSrcA) {
      if (iframeLoadTimerARef.current) clearTimeout(iframeLoadTimerARef.current);
      const delay = hubCaptureTarget === 'A' ? HUB_EMBED_READY_MS : 200;
      iframeLoadTimerARef.current = setTimeout(() => markEmbedReadyA(), delay);
    }
  }, [youtubeVideoIdA, genericEmbedSrcA, hubCaptureTarget, markEmbedReadyA]);

  const iframeLoadTimerBRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGenericEmbedIframeLoadB = useCallback(() => {
    if (!youtubeVideoIdB && genericEmbedSrcB) {
      if (iframeLoadTimerBRef.current) clearTimeout(iframeLoadTimerBRef.current);
      const delay = hubCaptureTarget === 'B' ? HUB_EMBED_READY_MS : 200;
      iframeLoadTimerBRef.current = setTimeout(() => markEmbedReadyB(), delay);
    }
  }, [youtubeVideoIdB, genericEmbedSrcB, hubCaptureTarget, markEmbedReadyB]);

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

  // ── Object Multiplier ─────────────────────────────────────────────────────
  const handleObjMultiplierCapture = useCallback(async () => {
    const region = canvasRef.current?.getObjMultiplierRegion();
    if (!region) {
      alert('Draw a rectangle on the video first to select a region.');
      return;
    }
    setObjMultiplierProgress('Capturing…');
    const count = await canvasRef.current?.runObjMultiplierCapture(
      objMultiplierFrameCount,
      (done, total) => setObjMultiplierProgress(`Capturing ${done}/${total}…`),
    );
    setObjMultiplierProgress(count ? `${count} frames captured` : null);
  }, [objMultiplierFrameCount]);

  const handleObjMultiplierClear = useCallback(() => {
    canvasRef.current?.clearObjMultiplier();
    setObjMultiplierHasRegion(false);
    setObjMultiplierProgress(null);
  }, []);

  // ── URL Input handler ────────────────────────────────────────────────────

  const [urlLoadError, setUrlLoadError] = useState<string | null>(null);
  const [urlLoadPhase, setUrlLoadPhase] = useState<string | null>(null);
  const urlLoadAbortRef = useRef<AbortController | null>(null);

  const applyVideoStream = useCallback(
    (streamUrl: string, target: 'A' | 'B') => {
      if (target === 'A') {
        setYoutubeVideoIdA(null);
        setGenericEmbedSrcA(null);
        setVideoSrc(streamUrl);
        if (videoRef.current) {
          cleanupVideoEl(videoRef.current);
          videoRef.current.crossOrigin = 'anonymous';
          videoRef.current.src = streamUrl;
          videoRef.current.load();
        }
      } else {
        setYoutubeVideoIdB(null);
        setGenericEmbedSrcB(null);
        setVideoSrcB(streamUrl);
        if (videoRefB.current) {
          cleanupVideoEl(videoRefB.current);
          videoRefB.current.crossOrigin = 'anonymous';
          videoRefB.current.src = streamUrl;
          videoRefB.current.load();
        }
        setVideoBLoaded(false);
      }
    },
    [cleanupVideoEl],
  );

  const handleUrlSubmit = useCallback(async () => {
    const raw = normalizeWebUrlInput(urlInput);
    if (!raw) return;

    urlLoadAbortRef.current?.abort();
    const abort = new AbortController();
    urlLoadAbortRef.current = abort;

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
    // Detect YouTube playlist-only URLs (no video ID) and surface a clear error.
    try {
      const parsedUrl = new URL(raw.includes('://') ? raw : `https://${raw}`);
      const host = parsedUrl.hostname.replace(/^www\./i, '');
      if (host.includes('youtube.com') && parsedUrl.pathname === '/playlist') {
        setUrlLoadPhase(null);
        setUrlLoadError('YouTube playlists are not supported. Open a specific video from the playlist and paste that URL instead.');
        return;
      }
    } catch {
      // ignore URL parse errors; let downstream handle them
    }
    setUrlLoadError(null);
    setUrlLoadPhase('Loading video\u2026');
    setProcessingStatus(null);
    setStroMotionEnabled(false);
    setStroMotionRegion(undefined);
    clearGhosts();
    (urlTarget === 'A' ? canvasRef.current : canvasRefB.current)?.clearAll();

    // Fast path: direct video URL \u2192 proxy same-origin for Canvas/ML
    const looksLikeDirectFile = raw.match(/\.(mp4|webm|mov)(\?.*)?$/i);
    const lowerRaw = raw.toLowerCase();
    const looksLikeYouTubeDirectStream =
      lowerRaw.includes('googlevideo.com/') || lowerRaw.includes('/videoplayback?') || lowerRaw.includes('mime=video');

    if (looksLikeDirectFile || looksLikeYouTubeDirectStream) {
      const streamUrl = `/api/video/stream?url=${encodeURIComponent(raw)}`;
      setUrlLoadPhase(null);
      applyVideoStream(streamUrl, urlTarget);
      return;
    }

    // YouTube URL \u2192 resolve + stream via Cloudflare Worker
    const resolved = resolveEmbedTarget(raw);
    const isYouTube = resolved?.kind === 'youtube';

    if (isYouTube) {
      const videoId = resolved.videoId;
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

      const slowTimer = window.setTimeout(() => {
        if (!abort.signal.aborted) setUrlLoadPhase('Still working on it \u2014 almost there\u2026');
      }, 5000);
      const verySlowTimer = window.setTimeout(() => {
        if (!abort.signal.aborted) setUrlLoadPhase('Taking a bit longer than usual\u2026');
      }, 15000);

      try {
        // Layer 1: Cloudflare Worker stream proxy (resolve + proxy same IP)
        const workerBase = process.env.NEXT_PUBLIC_YT_RESOLVER_URL;
        if (workerBase) {
          const streamUrl = `${workerBase}/stream?url=${encodeURIComponent(watchUrl)}`;
          try {
            const checkRes = await fetch(
              `${workerBase}/resolve?url=${encodeURIComponent(watchUrl)}`,
              { signal: abort.signal },
            );
            if (checkRes.ok) {
              clearTimeout(slowTimer);
              clearTimeout(verySlowTimer);
              setUrlLoadPhase(null);
              applyVideoStream(streamUrl, urlTarget);
              return;
            }
          } catch (e) {
            if (abort.signal.aborted) return;
            console.warn('[analysis] Worker resolve failed, trying Vercel fallback', e);
          }
        }

        // Layer 2: Vercel server-side resolve + proxy
        if (abort.signal.aborted) return;
        setUrlLoadPhase('Connecting to stream\u2026');
        const streamResult = await resolveYoutubeForAnalysis(watchUrl);
        if (abort.signal.aborted) return;

        if (streamResult.ok && streamResult.directUrl) {
          const streamUrl = `/api/video/stream?url=${encodeURIComponent(streamResult.directUrl)}`;
          clearTimeout(slowTimer);
          clearTimeout(verySlowTimer);
          setUrlLoadPhase(null);
          applyVideoStream(streamUrl, urlTarget);
          return;
        }

        // All resolution attempts failed — fall back to YouTube embed + capture
        clearTimeout(slowTimer);
        clearTimeout(verySlowTimer);
      } catch (e) {
        clearTimeout(slowTimer);
        clearTimeout(verySlowTimer);
        if (abort.signal.aborted) return;
        console.warn('[analysis] YouTube resolve error:', e);
      }

      // Fallback: load YouTube in an iframe embed so the coach can use Capture
      setUrlLoadPhase(null);
      setShowTapToPlay(true);
      if (urlTarget === 'A') {
        setYoutubeVideoIdA(videoId);
        setGenericEmbedSrcA(null);
      } else {
        setYoutubeVideoIdB(videoId);
        setGenericEmbedSrcB(null);
      }
      return;
    }

    // Non-YouTube embed (generic iframe)
    if (resolved) {
      setUrlLoadPhase(null);
      setShowTapToPlay(false);
      if (urlTarget === 'A') {
        setYoutubeVideoIdA(null);
        setGenericEmbedSrcA(resolved.src);
      } else {
        setYoutubeVideoIdB(null);
        setGenericEmbedSrcB(resolved.src);
      }
      return;
    }

    // Unrecognized URL
    setUrlLoadPhase(null);
    setUrlLoadError(
      'We couldn\u2019t open that link. Try a YouTube address, a social clip link, or paste a direct video link \u2014 then tap Load again.',
    );
  }, [applyVideoStream, cleanupVideoEl, clearGhosts, revokeBlobUrl, urlInput, urlTarget, videoBDuration]);

  const buildEmbedCaptureBundle = useCallback(
    async (
      panel: 'A' | 'B',
      opts: { mode: 'full' | 'section'; startSec: number | null; endSec: number | null },
    ): Promise<EmbedCaptureShareBundle | null> => {
      const videoEl = panel === 'A' ? videoRef.current : videoRefB.current;
      if (!videoEl) {
        throw new Error('video element missing');
      }

      const ready = panel === 'A' ? embedReadyA : embedReadyB;
      const hasEmbedOnly =
        panel === 'A'
          ? !!(youtubeVideoIdA || genericEmbedSrcA) && !videoSrc
          : !!(youtubeVideoIdB || genericEmbedSrcB) && !videoSrcB;
      if (hasEmbedOnly && !ready) {
        throw new Error('embed not ready');
      }

      let isoRestore: (() => void) | null = null;
      let ytSnap: any = null;
      let nulledYtRef = false;
      let youtubeDurationHintSec: number | null = null;
      let ytHardDestroyed = false;

      const ytRef = panel === 'A' ? ytPlayerARef.current : ytPlayerBRef.current;
      const isYt = panel === 'A' ? !!youtubeVideoIdA : !!youtubeVideoIdB;

      captureLog('isolate-begin', panel);

      if (isYt && ytRef) {
        youtubeDurationHintSec = safeYoutubePlayerDuration(ytRef);
        destroyYouTubeEmbedHard(ytRef);
        ytHardDestroyed = true;
        if (panel === 'A') {
          ytPlayerARef.current = null;
          setEmbedYtKilledA(true);
        } else {
          ytPlayerBRef.current = null;
          setEmbedYtKilledB(true);
        }
      } else {
        const iso = isolateYouTubePlayerSync(null);
        isoRestore = iso.restore;
        ytSnap = ytRef;
        if (isYt && ytRef) {
          if (panel === 'A') ytPlayerARef.current = null;
          else ytPlayerBRef.current = null;
          nulledYtRef = true;
        }
      }

      await flushCaptureIsolationMs(80);

      if (embedCaptureCancelRef.current) {
        return null;
      }

      return {
        panel,
        opts,
        isoRestore,
        ytSnap,
        nulledYtRef,
        isYt,
        ytHardDestroyed,
        youtubeDurationHintSec,
      };
    },
    [
      youtubeVideoIdA,
      youtubeVideoIdB,
      genericEmbedSrcA,
      genericEmbedSrcB,
      videoSrc,
      videoSrcB,
      embedReadyA,
      embedReadyB,
    ],
  );

  const restoreBundleYouTube = useCallback((bundle: EmbedCaptureShareBundle) => {
    try {
      bundle.isoRestore?.();
    } catch (e) {
      console.warn('[Capture] restore pointer-events:', e);
    }
    if (bundle.ytHardDestroyed) {
      if (bundle.panel === 'A') {
        setEmbedYtKilledA(false);
        setYtPlayerRemountNonceA((n) => n + 1);
      } else {
        setEmbedYtKilledB(false);
        setYtPlayerRemountNonceB((n) => n + 1);
      }
    } else if (bundle.nulledYtRef && bundle.ytSnap) {
      if (bundle.panel === 'A') ytPlayerARef.current = bundle.ytSnap;
      else ytPlayerBRef.current = bundle.ytSnap;
    }
  }, []);

  const clearCapturePrepUi = useCallback((resetPostPhase = false) => {
    setCaptureBusy(false);
    setEmbedCaptureRecording(false);
    setEmbedCapturePanelId(null);
    setCapturePrepPanel(null);
    setEmbedCaptureAwaitingShare(null);
    setEmbedYtKilledA(false);
    setEmbedYtKilledB(false);
    embedCaptureShareBundleRef.current = null;
    setCaptureProgress01(0);
    setCaptureCountdown(null);
    setCaptureStepStatus(null);
    setCaptureCoachBanner(false);
    setCaptureActuallyRecording(false);
    if (resetPostPhase) setCapturePostPhase('hidden');
  }, []);

  const bumpCaptureFailures = useCallback((panel: 'A' | 'B') => {
    const yidAtFail = panel === 'A' ? youtubeVideoIdA : youtubeVideoIdB;
    setEmbedCaptureConsecutiveFailures((n) => {
      const next = n + 1;
      if (next >= 3 && yidAtFail) {
        void (async () => {
          try {
            const r = await resolveYoutubeForAnalysis(
              `https://www.youtube.com/watch?v=${encodeURIComponent(yidAtFail)}`,
            );
            if (r.ok && r.directUrl) {
              setCaptureFallbackStreamUrl(
                `/api/video/stream?url=${encodeURIComponent(r.directUrl)}`,
              );
            }
          } catch {
            /* noop */
          }
        })();
      }
      return next;
    });
  }, [youtubeVideoIdA, youtubeVideoIdB]);

  // Hub alt URL load: clear hub spinner once the embed is ready (coach uses video panel).
  useEffect(() => {
    if (!hubCaptureTarget) return;
    const ready = hubCaptureTarget === 'A' ? embedReadyA : embedReadyB;
    if (!ready) return;
    setHubCaptureLoading(false);
  }, [embedReadyA, embedReadyB, hubCaptureTarget]);

  const completeEmbedCaptureAfterStream = useCallback(
    async (preAcquiredStream: MediaStream) => {
      const bundle = embedCaptureShareBundleRef.current;
      if (!bundle) {
        stopAllTracks(preAcquiredStream);
        setCaptureError(
          handleCaptureError(new Error('Prepare again before sharing'), 'share-step').friendly,
        );
        return;
      }
      const { panel, opts, ytSnap, isYt, ytHardDestroyed, youtubeDurationHintSec } = bundle;

      const restoreYouTubeFromBundle = () => {
        try {
          bundle.isoRestore?.();
        } catch (e) {
          console.warn('[Capture] restore pointer-events:', e);
        }
        if (bundle.ytHardDestroyed) {
          if (bundle.panel === 'A') {
            setEmbedYtKilledA(false);
            setYtPlayerRemountNonceA((n) => n + 1);
          } else {
            setEmbedYtKilledB(false);
            setYtPlayerRemountNonceB((n) => n + 1);
          }
        } else if (bundle.nulledYtRef && bundle.ytSnap) {
          if (bundle.panel === 'A') ytPlayerARef.current = bundle.ytSnap;
          else ytPlayerBRef.current = bundle.ytSnap;
        }
        embedCaptureShareBundleRef.current = null;
        setCaptureCoachBanner(false);
      };

      const clearCaptureUi = (resetPostPhase = false) => {
        setCaptureBusy(false);
        setEmbedCaptureRecording(false);
        setEmbedCapturePanelId(null);
        setCapturePrepPanel(null);
        setEmbedCaptureAwaitingShare(null);
        setEmbedYtKilledA(false);
        setEmbedYtKilledB(false);
        embedCaptureShareBundleRef.current = null;
        setCaptureProgress01(0);
        setCaptureCountdown(null);
        setCaptureStepStatus(null);
        setCaptureCoachBanner(false);
        setCaptureActuallyRecording(false);
        // On error/cancel paths pass resetPostPhase=true so the banner disappears.
        // The success path calls clearCaptureUi(true) then immediately sets 'processing'.
        if (resetPostPhase) setCapturePostPhase('hidden');
      };

      const bumpFailures = () => {
        const yidAtFail = panel === 'A' ? youtubeVideoIdA : youtubeVideoIdB;
        setEmbedCaptureConsecutiveFailures((n) => {
          const next = n + 1;
          if (next >= 3 && yidAtFail) {
            void (async () => {
              try {
                const r = await resolveYoutubeForAnalysis(
                  `https://www.youtube.com/watch?v=${encodeURIComponent(yidAtFail)}`,
                );
                if (r.ok && r.directUrl) {
                  setCaptureFallbackStreamUrl(
                    `/api/video/stream?url=${encodeURIComponent(r.directUrl)}`,
                  );
                }
              } catch {
                /* noop */
              }
            })();
          }
          return next;
        });
      };

      const vtracks = preAcquiredStream.getVideoTracks();
      if (!vtracks || vtracks.length === 0) {
        stopAllTracks(preAcquiredStream);
        restoreYouTubeFromBundle();
        clearCaptureUi(true);
        setCaptureError(handleCaptureError(new Error('no video tracks in stream'), 'stream-tracks').friendly);
        bumpFailures();
        return;
      }
      captureLog('getDisplayMedia-ok');

      setCaptureError(null);
      setEmbedCapturePanelId(panel);
      setCaptureBusy(true);
      setEmbedCaptureRecording(true);
      setCaptureProgress01(0);
      setCaptureCoachBanner(false);

      const videoEl = panel === 'A' ? videoRef.current : videoRefB.current;
      if (!videoEl) {
        stopAllTracks(preAcquiredStream);
        restoreYouTubeFromBundle();
        clearCaptureUi(true);
        setCaptureError(handleCaptureError(new Error('video element missing'), 'video-element').friendly);
        bumpFailures();
        return;
      }

      if (bundle.ytHardDestroyed && isYt) {
        flushSync(() => {
          if (panel === 'A') {
            setEmbedYtKilledA(false);
            setYtPlayerRemountNonceA((n) => n + 1);
          } else {
            setEmbedYtKilledB(false);
            setYtPlayerRemountNonceB((n) => n + 1);
          }
        });
      }

      const shell = panel === 'A' ? captureShellRef.current : captureShellRefB.current;
      const hasGenericEmbed =
        panel === 'A' ? !!genericEmbedSrcA && !youtubeVideoIdA : !!genericEmbedSrcB && !youtubeVideoIdB;
      const durHint =
        bundle.ytHardDestroyed &&
        youtubeDurationHintSec != null &&
        Number.isFinite(youtubeDurationHintSec) &&
        youtubeDurationHintSec > 0.25
          ? youtubeDurationHintSec
          : !isYt &&
              typeof videoEl.duration === 'number' &&
              Number.isFinite(videoEl.duration) &&
              videoEl.duration > 0.25
            ? videoEl.duration
            : null;

      try {
        const result = await runEmbedTabCaptureFlow({
          opts,
          videoEl,
          ytPlayer: bundle.ytHardDestroyed ? null : isYt ? ytSnap : null,
          isYoutube: isYt,
          captureShellEl: shell,
          getYtPlayer: () => (panel === 'A' ? ytPlayerARef.current : ytPlayerBRef.current),
          getCropTargetEl: () =>
            (panel === 'A' ? embedCaptureCropTargetRefA.current : embedCaptureCropTargetRefB.current) ??
            shell,
          getGenericIframe: () =>
            panel === 'A' ? genericEmbedIframeRefA.current : genericEmbedIframeRefB.current,
          genericEmbedReady: panel === 'A' ? embedReadyA : embedReadyB,
          hasGenericEmbed,
          onProgress: setCaptureProgress01,
          onCountdown: setCaptureCountdown,
          onStepStatus: setCaptureStepStatus,
          videoDurationHintSec: durHint,
          preAcquiredStream,
          onPostStreamReady: () => {
            captureLog('ui-overlay-shown');
            setCaptureCoachBanner(true);
          },
          onRecordingStarted: () => {
            captureLog('recorder-started');
            setCaptureActuallyRecording(true);
          },
          getCancelled: () => embedCaptureCancelRef.current,
        });

        restoreYouTubeFromBundle();
        clearCaptureUi(true);

        if (!result.ok) {
          // Silent dismissal when the user pressed New / otherwise cancelled.
          if (!result.cancelled) {
            setCaptureError(result.message);
            bumpFailures();
          }
          return;
        }

        // Recording succeeded — transition the banner to "Processing your video…"
        // before any async blob work begins, so the coach has continuous feedback.
        setCapturePostPhase('processing');

        setEmbedCaptureConsecutiveFailures(0);
        setCaptureFallbackStreamUrl(null);
        captureLog('flow-handler-success-recording');

        try {
          sessionCaptureBlobRef.current = result.blob;
          sessionMp4BlobRef.current = null;
          setCaptureDownloadStatus('preparing');
          const conversionGen = ++captureMp4ConversionGenRef.current;
          const capturedBlob = result.blob;
          void (async () => {
            try {
              const conv = await convertWebmBlobToMp4(capturedBlob);
              if (conversionGen !== captureMp4ConversionGenRef.current) return;
              if (conv.ok) {
                sessionMp4BlobRef.current = conv.blob;
                setCaptureDownloadStatus('ready_mp4');
              } else {
                sessionMp4BlobRef.current = null;
                setCaptureDownloadStatus('ready_webm');
              }
            } catch (convErr) {
              console.warn('[CoachLab capture] MP4 conversion failed:', convErr);
              if (conversionGen !== captureMp4ConversionGenRef.current) return;
              sessionMp4BlobRef.current = null;
              setCaptureDownloadStatus('ready_webm');
            }
          })();

          if (panel === 'A') ytPlayerARef.current = null;
          else ytPlayerBRef.current = null;

          const url = URL.createObjectURL(result.blob);
          const postEl = panel === 'A' ? videoRef.current : videoRefB.current;

          if (panel === 'A') {
            revokeBlobUrl(lastBlobUrlARef.current);
            lastBlobUrlARef.current = url;
            setGenericEmbedSrcA(null);
            setYoutubeVideoIdA(null);
            setVideoSrc(url);
            if (postEl) {
              cleanupVideoEl(postEl);
              postEl.src = url;
              postEl.load();
              await new Promise<void>((resolve) => {
                if (postEl.readyState >= 2) {
                  resolve();
                  return;
                }
                const done = () => resolve();
                postEl.addEventListener('loadeddata', done, { once: true });
                window.setTimeout(done, 2500);
              });
              await postEl.play().catch(() => {});
            }
          } else {
            revokeBlobUrl(lastBlobUrlBRef.current);
            lastBlobUrlBRef.current = url;
            setGenericEmbedSrcB(null);
            setYoutubeVideoIdB(null);
            setVideoSrcB(url);
            if (postEl) {
              cleanupVideoEl(postEl);
              postEl.src = url;
              postEl.load();
              await new Promise<void>((resolve) => {
                if (postEl.readyState >= 2) {
                  resolve();
                  return;
                }
                const done = () => resolve();
                postEl.addEventListener('loadeddata', done, { once: true });
                window.setTimeout(done, 2500);
              });
              await postEl.play().catch(() => {});
            }
            setVideoBLoaded(false);
          }

          setShowCaptureSaveToast(true);
          setShowTapToPlay(false);
          captureLog('flow-handler-complete');
        } catch (postErr: unknown) {
          const { friendly } = handleCaptureError(postErr, 'apply-captured-video');
          setCaptureError(friendly);
          bumpFailures();
        }
      } catch (outerErr: unknown) {
        stopAllTracks(preAcquiredStream);
        restoreYouTubeFromBundle();
        clearCaptureUi(true);
        // If a thrown error reaches here while the cancel flag is set, treat as
        // a clean dismissal rather than surfacing a confusing toast.
        if (!embedCaptureCancelRef.current) {
          setCaptureError(handleCaptureError(outerErr, 'recording').friendly);
          bumpFailures();
        }
      }
    },
    [cleanupVideoEl, revokeBlobUrl, youtubeVideoIdA, youtubeVideoIdB, genericEmbedSrcA, genericEmbedSrcB, embedReadyA, embedReadyB],
  );

  const startEmbedCaptureRecording = useCallback(
    (panel: 'A' | 'B', opts: { mode: 'full' | 'section'; startSec: number | null; endSec: number | null }) => {
      embedCaptureRetryPayloadRef.current = { panel, opts };
      captureLog('start-recording-click', panel);

      // Never start an embed/tab capture while a screen recording is active —
      // two getDisplayMedia flows would fight and produce duplicate chrome.
      if (isRecording) return;
      if (embedShareInFlightRef.current) return;
      embedShareInFlightRef.current = true;
      embedCaptureCancelRef.current = false;
      embedCaptureShareBundleRef.current = null;
      setEmbedCaptureAwaitingShare(null);
      setCaptureError(null);

      setCaptureStepStatus(
        'Please wait — turn your volume up and remove your headphones if you want audio recorded in the final video.',
      );
      setCapturePrepPanel(panel);
      setCaptureBusy(true);

      getTabCaptureStream()
        .then((stream) => {
          embedShareInFlightRef.current = false;
          if (embedCaptureCancelRef.current) {
            stopAllTracks(stream);
            clearCapturePrepUi(true);
            return;
          }

          void (async () => {
            try {
              const bundle = await buildEmbedCaptureBundle(panel, opts);
              if (embedCaptureCancelRef.current || !bundle) {
                stopAllTracks(stream);
                if (bundle) restoreBundleYouTube(bundle);
                clearCapturePrepUi(true);
                return;
              }
              embedCaptureShareBundleRef.current = bundle;
              setCapturePrepPanel(null);
              await completeEmbedCaptureAfterStream(stream);
            } catch (err: unknown) {
              stopAllTracks(stream);
              const partial = embedCaptureShareBundleRef.current;
              if (partial) restoreBundleYouTube(partial);
              clearCapturePrepUi(true);
              if (!embedCaptureCancelRef.current) {
                setCaptureError(handleCaptureError(err, 'capture-prepare').friendly);
                bumpCaptureFailures(panel);
              }
            }
          })();
        })
        .catch((e: unknown) => {
          embedShareInFlightRef.current = false;
          clearCapturePrepUi(true);
          if (!embedCaptureCancelRef.current) {
            setCaptureError(handleCaptureError(e, 'getDisplayMedia').friendly);
            bumpCaptureFailures(panel);
          }
        });
    },
    [
      buildEmbedCaptureBundle,
      bumpCaptureFailures,
      clearCapturePrepUi,
      completeEmbedCaptureAfterStream,
      restoreBundleYouTube,
      isRecording,
    ],
  );

  const shareEmbedDisplayMediaFromUserGesture = useCallback(() => {
    captureLog('share-screen-click');
    // Atomic guard: a double-tap on the share button must not spawn two
    // getDisplayMedia calls. On Safari this would also consume the user-gesture
    // token twice and reliably fail the second call with a confusing error.
    if (embedShareInFlightRef.current) {
      captureLog('share-screen-click-ignored-duplicate');
      return;
    }
    const bundleSnap = embedCaptureShareBundleRef.current;
    if (!bundleSnap) return;
    embedShareInFlightRef.current = true;

    // IMPORTANT: getTabCaptureStream() MUST be the first await after a user click
    // on Safari/WebKit. Do not insert any awaits before this line.
    getTabCaptureStream()
      .then((stream) => {
        embedShareInFlightRef.current = false;
        // If the user cancelled (pressed New) between the click and the GDM
        // resolution, stop the freshly acquired stream and bail.
        if (embedCaptureCancelRef.current) {
          stopAllTracks(stream);
          return;
        }
        void completeEmbedCaptureAfterStream(stream);
      })
      .catch((e: unknown) => {
        embedShareInFlightRef.current = false;
        const b = bundleSnap;
        const { friendly } = handleCaptureError(e, 'getDisplayMedia');
        try {
          b.isoRestore?.();
        } catch (err) {
          console.warn('[Capture] restore after share cancel:', err);
        }
        if (b.ytHardDestroyed) {
          if (b.panel === 'A') {
            setEmbedYtKilledA(false);
            setYtPlayerRemountNonceA((n) => n + 1);
          } else {
            setEmbedYtKilledB(false);
            setYtPlayerRemountNonceB((n) => n + 1);
          }
        } else if (b.nulledYtRef && b.ytSnap) {
          if (b.panel === 'A') ytPlayerARef.current = b.ytSnap;
          else ytPlayerBRef.current = b.ytSnap;
        }
        embedCaptureShareBundleRef.current = null;
        setEmbedCaptureAwaitingShare(null);
        setEmbedYtKilledA(false);
        setEmbedYtKilledB(false);
        setCapturePrepPanel(null);
        setCaptureBusy(false);
        setEmbedCaptureRecording(false);
        setEmbedCapturePanelId(null);
        // Suppress error toast if the cancellation came from us (e.g. New button).
        if (!embedCaptureCancelRef.current) {
          setCaptureError(friendly);
        }
        const panel = b.panel;
        const yidAtFail = panel === 'A' ? youtubeVideoIdA : youtubeVideoIdB;
        setEmbedCaptureConsecutiveFailures((n) => {
          const next = n + 1;
          if (next >= 3 && yidAtFail) {
            void (async () => {
              try {
                const r = await resolveYoutubeForAnalysis(
                  `https://www.youtube.com/watch?v=${encodeURIComponent(yidAtFail)}`,
                );
                if (r.ok && r.directUrl) {
                  setCaptureFallbackStreamUrl(
                    `/api/video/stream?url=${encodeURIComponent(r.directUrl)}`,
                  );
                }
              } catch {
                /* noop */
              }
            })();
          }
          return next;
        });
      });
  }, [completeEmbedCaptureAfterStream, youtubeVideoIdA, youtubeVideoIdB]);

  const retryLastEmbedCapture = useCallback(() => {
    const p = embedCaptureRetryPayloadRef.current;
    setCaptureError(null);
    setEmbedCaptureAwaitingShare(null);
    embedCaptureShareBundleRef.current = null;
    if (!p) return;
    startEmbedCaptureRecording(p.panel, p.opts);
  }, [startEmbedCaptureRecording]);

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
      (capturePrepPanel === 'A' || (captureBusy && embedCapturePanelId === 'A')) &&
        (youtubeVideoIdA || genericEmbedSrcA) &&
        !videoSrc,
    );
  const lockEmbedInteractionB =
    Boolean(
      (capturePrepPanel === 'B' || (captureBusy && embedCapturePanelId === 'B')) &&
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

  /** Canvas-first layout: toolbar is a flex sibling, not an overlay — no inset padding. */
  const panelToolbarInset = 0;
  const timelineLeadingInset = 16;

  const reelsDesktop = !isMobile && layoutMode === 'reels';

  const canPlaybackSyncBoth = Boolean(
    hasVideoBContent &&
    videoSrc &&
    videoSrcB &&
    !youtubeVideoIdA &&
    !youtubeVideoIdB &&
    !genericEmbedSrcA &&
    !genericEmbedSrcB,
  );

  const applyMarkupToTargets = useCallback(
    (op: (handle: CanvasHandle) => void) => {
      if (markupTarget === 'both') {
        if (canvasRef.current) op(canvasRef.current);
        if (canvasRefB.current) op(canvasRefB.current);
        return;
      }
      const ref = markupTarget === 'B' ? canvasRefB : canvasRef;
      if (ref.current) op(ref.current);
    },
    [markupTarget],
  );

  const handleMarkupUndo = useCallback(() => {
    applyMarkupToTargets((c) => c.undo());
  }, [applyMarkupToTargets]);

  const handleMarkupRedo = useCallback(() => {
    applyMarkupToTargets((c) => c.redo());
  }, [applyMarkupToTargets]);

  const handleMarkupClear = useCallback(() => {
    applyMarkupToTargets((c) => {
      c.clearAll();
      c.resetBallTrail();
    });
    setSkeletonOverlayPaused(true);
  }, [applyMarkupToTargets]);

  useEffect(() => {
    if (!hasVideoBContent) {
      setMarkupTarget('A');
      return;
    }
    if (playbackTarget === 'B') setMarkupTarget('B');
    else if (playbackTarget === 'A') setMarkupTarget('A');
  }, [playbackTarget, hasVideoBContent]);

  const renderTimelineDock = () => (
    <div style={{ width: '100%', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 8 }}>
      {!(capturePrepPanel || (captureBusy && embedCaptureRecording)) && (hasVideoBContent ? (
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
                phoneChrome={isMobile || reelsDesktop}
                compareSlot={hasVideoBContent ? playbackTarget : undefined}
                onCompareSlotChange={hasVideoBContent ? setPlaybackTarget : undefined}
                compareAbDisabled={!canPlaybackSyncBoth}
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
                phoneChrome={isMobile || reelsDesktop}
                compareSlot={hasVideoBContent ? playbackTarget : undefined}
                onCompareSlotChange={hasVideoBContent ? setPlaybackTarget : undefined}
                compareAbDisabled={!canPlaybackSyncBoth}
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
            phoneChrome={isMobile || reelsDesktop}
            compareSlot={hasVideoBContent ? playbackTarget : undefined}
            onCompareSlotChange={hasVideoBContent ? setPlaybackTarget : undefined}
            compareAbDisabled={!canPlaybackSyncBoth}
          />
        )
      ))}
    </div>
  );

  // ── Centralized ToolPalette prop assembly ──────────────────────────────
  // Single source of truth: edit here and all three toolbar instances
  // (desktop left, mobile strip, desktop-reels) pick up the change.
  const toolPaletteBaseProps = {
    activeTool,
    onToolChange:                    handleToolChange,
    compact:                         true as const,
    drawingOptions,
    onOptionsChange:                 handleOptionsChange,
    onUndo:                          handleMarkupUndo,
    onRedo:                          handleMarkupRedo,
    onClear:                         handleMarkupClear,
    markupTarget,
    onMarkupTargetChange:            setMarkupTarget,
    hasCompareVideo:                 hasVideoBContent,
    onResetSkeleton:                 () => canvasRef.current?.resetSkeleton(),
    onResetBallTrail:                () => canvasRef.current?.resetBallTrail(),
    ballTrailMode,
    onBallTrailModeChange:           setBallTrailMode,
    onAutoSwing:                     handleAutoSwing,
    onRacketMultiplier:              handleRacketMultiplier,
    circleSpinning,
    onCircleSpinningChange:          setCircleSpinning,
    outlineEraserSize,
    onOutlineEraserSizeChange:       setOutlineEraserSize,
    skeletonShowAngles,
    onSkeletonShowAnglesChange:      setSkeletonShowAngles,
    skeletonShowHeadLine,
    onSkeletonShowHeadLineChange:    setSkeletonShowHeadLine,
    skeletonClassicColors,
    onSkeletonClassicColorsChange:   setSkeletonClassicColors,
    skeletonShowRightArm,
    onSkeletonShowRightArmChange:    setSkeletonShowRightArm,
    skeletonShowLeftArm,
    onSkeletonShowLeftArmChange:     setSkeletonShowLeftArm,
    skeletonShowRightLeg,
    onSkeletonShowRightLegChange:    setSkeletonShowRightLeg,
    skeletonShowLeftLeg,
    onSkeletonShowLeftLegChange:     setSkeletonShowLeftLeg,
    skeletonOverlayPaused,
    onSkeletonOverlayPausedChange:   () => setSkeletonOverlayPaused((p) => !p),
    ballSampleMode,
    onBallSampleModeChange:          setBallSampleMode,
    onResetCropZoom:                 () => canvasRef.current?.resetCropZoom(),
    objMultiplierFrameCount,
    onObjMultiplierFrameCountChange: setObjMultiplierFrameCount,
    onObjMultiplierCapture:          handleObjMultiplierCapture,
    onObjMultiplierClear:            handleObjMultiplierClear,
    objMultiplierActive:             objMultiplierHasRegion,
    objMultiplierProgress,
    iconOnlyLayout:                  toolbarIconOnlyLayout,
    collapsed:                       !isMobile && toolbarCollapsed,
    onToggleCollapsed:               !isMobile ? toggleToolbarCollapsed : undefined,
    showCollapseControl:             !isMobile,
    onCleanSession:                  resetSession,
    drawContextActive,
    onExitDrawContext:               exitDrawContext,
    onOpenDrawContext:               () => {
      // Opening Style should also put the canvas in a drawing tool, otherwise
      // the Style row highlights but activeTool stays 'select' and nothing draws.
      if (DRAW_CONTEXT_TOOLS.includes(activeTool)) setDrawContextActive(true);
      else handleToolChange('pen');
    },
    ...(isMobile
      ? {
          precisionDrawEnabled,
          onPrecisionDrawToggle: handlePrecisionDrawToggle,
          onShowPrecisionInstructions: showPrecisionInstructionsAgain,
        }
      : {}),
    phoneLayout:                     reelsDesktopEarly,
    compactToolbarChrome:            compactToolbarRail,
    toolbarLabelsExpanded:             isMobile ? false : toolbarLabelsExpanded,
    onToggleToolbarLabels:             isMobile ? undefined : () => setToolbarLabelsExpanded((v) => !v),
    ...(compactToolbarRail
      ? {
          iconOnlyLayout: true,
          denseMobile: true,
          collapsed: true,
          // Keep chevron on desktop-collapsed compact rail so the user can expand back;
          // hide it only when we are truly in a phone/tablet strip layout.
          showCollapseControl: !phoneToolbarLayout && !isMobile,
          onToggleCollapsed: !phoneToolbarLayout && !isMobile ? toggleToolbarCollapsed : undefined,
        }
      : {}),
    recordingHubContent: (
      <RecordingHubContent
        isRecording={isRecording}
        onRecordingChange={handleRecordingChange}
        getCanvas={getCanvas}
        getWebcamStream={getWebcamStream}
        getMicStream={getMicStream}
        layoutMode={layoutMode as 'youtube' | 'reels'}
        onLayoutChange={setLayoutMode}
        onScreenRecordComplete={handleScreenRecordComplete}
        recordingArea={recordingArea}
        onRecordingAreaChange={setRecordingArea}
        onScreenshotEntireScreen={handleScreenshotEntireScreen}
        onScreenshotVideoOnly={handleScreenshotVideoOnly}
        webcamActive={webcamActive}
        onWebcamToggle={() => void toggleWebcam()}
        micActive={micActive}
        micMuted={micMuted}
        onMicToggle={toggleMic}
        webcamCutout={webcamCutout}
        onWebcamCutoutChange={setWebcamCutout}
        webcamPipMode={webcamPipMode}
        onWebcamPipModeChange={setWebcamPipMode}
        onResetRecordingSettings={handleResetRecordingSettings}
        hubCaptureLoading={hubCaptureLoading}
        hubCaptureTarget={hubCaptureTarget}
        hubCaptureIsActive={captureBusy && embedCapturePanelId === hubCaptureTarget}
        onHubCaptureCancel={handleHubCaptureCancel}
        captureDownloadStatus={captureDownloadStatus}
        onDownloadCapture={handleDownloadCaptureBlob}
        onDismissCaptureDownload={handleDismissCaptureDownload}
        hubIconOnly={isMobile || (phoneToolbarLayout && !toolbarLabelsExpanded)}
        hubLabelsExpanded={isMobile ? false : toolbarLabelsExpanded}
        onToggleHubLabels={isMobile ? undefined : () => setToolbarLabelsExpanded((v) => !v)}
        captureBusy={captureBusy || embedCaptureRecording}
      />
    ),
  } satisfies React.ComponentProps<typeof ToolPalette>;

  const hasVideoAContent = useMemo(
    () => !!(videoSrc || youtubeVideoIdA || genericEmbedSrcA),
    [videoSrc, youtubeVideoIdA, genericEmbedSrcA],
  );

  /** Enter AB sync as soon as slot B is filled so compare mode is obvious. */
  useEffect(() => {
    if (hasVideoAContent && hasVideoBContent) {
      setPlaybackTarget('AB');
    }
  }, [hasVideoAContent, hasVideoBContent]);

  const slotActionsOnDark = layoutMode === 'reels';

  const slotPillStyle = (variant: 'remove' | 'add'): React.CSSProperties => ({
    pointerEvents: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 34,
    minWidth: variant === 'add' ? 34 : undefined,
    padding: variant === 'add' ? '6px 10px' : '6px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    touchAction: 'manipulation',
    border:
      variant === 'add'
        ? '1px solid rgba(52,199,89,0.65)'
        : '1px solid rgba(255,255,255,0.35)',
    background:
      variant === 'add' ? 'rgba(52,199,89,0.35)' : 'rgba(0,0,0,0.55)',
    color: '#fff',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
  });

  const renderVideoSlotPills = () => {
    if (!hasVideoAContent) return null;
    return (
      <div
        role="group"
        aria-label="Video slot actions"
        data-tour-id="tour-video-ab"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 110,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          justifyContent: 'flex-end',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 16px)',
        }}
      >
        <button
          type="button"
          onClick={removeVideoA}
          title="Remove Video A"
          style={slotPillStyle('remove')}
        >
          <Trash2 size={16} strokeWidth={2.25} aria-hidden />
          {phoneToolbarLayout ? null : 'Remove A'}
        </button>
        {!hasVideoBContent ? (
          <button
            type="button"
            onClick={handleAddVideoB}
            title="Add Video B"
            style={slotPillStyle('add')}
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            {phoneToolbarLayout ? '+B' : 'Add B'}
          </button>
        ) : null}
      </div>
    );
  };

  const renderToolbarRail = () => {
    if (!showToolbarRail) return null;
    const paletteProps = {
      ...toolPaletteBaseProps,
      mobileChrome: isMobile && showMobileToolStrip,
    };
    return (
      <aside
        data-tour-id="video-toolbar"
        className="coachlab-video-toolbar"
        style={{
          flexShrink: 0,
          width: toolbarWidthPx,
          ...(isMobile ? {} : { transition: 'width 200ms ease' }),
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          zIndex: 80,
          background: isMobile ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.15)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isMobile ? 'none' : '2px 0 24px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: isMobile ? '4px 2px' : 6,
          }}
        >
          <ToolPalette {...paletteProps} />
        </div>
      </aside>
    );
  };

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
        preload="auto"
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, top: -9999, left: -9999 }}
      />
      <video
        ref={videoRefB}
        playsInline
        muted
        preload="auto"
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

      {/* ── Main layout: toolbar rail + canvas (no overlay) ── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: layoutMode === 'reels' ? '#000' : '#0b0b0c',
        }}
      >
        <ReelsDesktopShell enabled={reelsDesktop}>
          {renderToolbarRail()}
          <main
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
              paddingTop: 'env(safe-area-inset-top, 0px)',
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
                      // Fill the space left by the toolbar rail in the flex row.
                      // (100dvw here overflowed by the rail width, clipping the
                      // canvas and adding horizontal scroll.)
                      width: '100%',
                      minWidth: 0,
                      height: '100dvh',
                      maxHeight: '100dvh',
                      borderRadius: 0,
                      border: 'none',
                      boxShadow: 'none',
                      margin: 0,
                    }
                  : reelsDesktop
                    ? {
                        width: '100%',
                        height: '100%',
                        maxHeight: '100%',
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
              // In desktop reels A/B compare the playback dock (absolute, bottom:0
              // of this container) would otherwise overlay the lower panel. Reserve
              // its measured height so both stacked panels stay clear of the dock.
              ...(reelsDesktop && hasVideoBContent
                ? { paddingBottom: toolbarBottomReservePx }
                : null),
            }}
          >
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
            {/* Slot A: video panel + side-by-side actions when B is empty */}
            <div
              style={{
                flex: layoutMode === 'reels' ? (hasVideoBContent ? '1 1 50%' : '1 1 auto') : 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: layoutMode === 'reels' ? 0 : undefined,
                overflow: 'hidden',
              }}
            >
            <div
              style={{
                flex: 1,
                position: 'relative',
                minWidth: 0,
                minHeight: 0,
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
                  urlLoadPhase && urlTarget === 'A' ? (
                    <div style={{
                      position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 16,
                      borderRadius: layoutMode === 'reels' ? 0 : 20,
                      background: layoutMode === 'reels' ? '#000' : '#FFFFFF',
                    }}>
                      <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="20" cy="20" r="16" fill="none" stroke="#007AFF" strokeWidth="3" strokeDasharray="75" strokeDashoffset="20" strokeLinecap="round" />
                      </svg>
                      <span style={{ fontSize: 15, fontWeight: 500, color: layoutMode === 'reels' ? '#fff' : '#1A1A1A', textAlign: 'center', maxWidth: 280 }}>
                        {urlLoadPhase}
                      </span>
                    </div>
                  ) : urlLoadError && urlTarget === 'A' ? (
                    <div style={{
                      position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 14,
                      borderRadius: layoutMode === 'reels' ? 0 : 20,
                      background: layoutMode === 'reels' ? '#000' : '#FFFFFF',
                      padding: 24,
                    }}>
                      <div style={{ fontSize: 14, color: '#CC3333', textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
                        {urlLoadError}
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          onClick={() => { setUrlLoadError(null); handleUrlSubmit(); }}
                          style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => { setUrlLoadError(null); fileInputRef.current?.click(); }}
                          style={{ padding: '8px 20px', borderRadius: 10, border: '1px solid #E5E5E5', background: '#fff', color: '#1A1A1A', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
                        >
                          Upload instead
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div style={{
                    position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 16,
                    borderRadius: layoutMode === 'reels' ? 0 : 20,
                    border: layoutMode === 'reels' ? 'none' : '1px solid #E8E8ED',
                    background: layoutMode === 'reels' ? '#000' : '#FAFAFA',
                    padding: 24,
                  }}>
                    <button type="button" data-tour-id="tour-upload" onClick={() => fileInputRef.current?.click()} style={{ minHeight: 52, minWidth: 200, padding: '0 24px', borderRadius: 14, border: '1px solid #E5E5E5', background: '#FFFFFF', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Upload size={20} /> Upload Video
                    </button>
                    <span style={{ fontSize: 12, color: layoutMode === 'reels' ? 'rgba(255,255,255,0.45)' : '#8e8e93', textAlign: 'center', maxWidth: 320 }}>
                      or drag and drop a video file here. See Coach Lab Academy in the Control Panel for import workflows.
                    </span>
                  </div>
                  )
                ) : (
                  <>
                    {youtubeVideoIdA ? (
                      <div
                        ref={embedCaptureCropTargetRefA}
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
                          {embedYtKilledA ? (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#e5e5e5',
                                padding: 16,
                                textAlign: 'center',
                                fontSize: 14,
                                fontWeight: 600,
                                gap: 8,
                              }}
                            >
                              <div>Video paused for capture</div>
                              <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.88, maxWidth: 280 }}>
                                Tap Share Screen when you are ready. The YouTube player reloads if you cancel.
                              </div>
                            </div>
                          ) : (
                            <YouTubeEmbed
                              key={`yt-a-${youtubeVideoIdA}-${ytPlayerRemountNonceA}`}
                              videoId={youtubeVideoIdA}
                              onPlayer={(p) => { ytPlayerARef.current = p; }}
                              onEmbedReady={markEmbedReadyA}
                            />
                          )}
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
                        ref={embedCaptureCropTargetRefA}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <iframe
                          ref={genericEmbedIframeRefA}
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
                      skeletonEnabled={skeletonEnabled && markupTarget === 'A'}
                      skeletonDrawEnabled={skeletonEnabled && markupTarget === 'A' && !skeletonOverlayPaused}
                      ballTrailEnabled={ballTrailEnabled}
                      onProcessingStatus={setProcessingStatus}
                      isRecording={isRecording}
                      circleSpinning={circleSpinning}
                      outlineEraserSize={outlineEraserSize}
                      onOutlineEraserSizeChange={setOutlineEraserSize}
                      webcamPipMode={webcamPipMode}
                      webcamOpacity={webcamOpacity}
                      webcamActive={webcamActive && markupTarget !== 'B'}
                      stroMotionGhosts={ghostFrames}
                      stroMotionOpacity={stroMotionOpacity}
                      stroMotionRegion={stroMotionRegion}
                      skeletonShowAngles={skeletonShowAngles}
                      skeletonShowHeadLine={skeletonShowHeadLine}
                      skeletonClassicColors={skeletonClassicColors}
                      skeletonParts={skeletonParts}
                      ballSampleMode={ballSampleMode}
                      suppressTabCaptureMirror={
                        embedLiveVideoA && (!!youtubeVideoIdA || !!genericEmbedSrcA)
                      }
                      webcamCutout={webcamCutout}
                      precisionTouchDraw={isMobile && precisionDrawEnabled}
                      webcamPipMobileChrome={isMobile}
                      webcamPipBottomInsetPx={toolbarBottomReservePx}
                      showTourHelpInZoomCluster
                      poseFrameSkip={hasVideoBContent ? 1 : 0}
                      panModeEnabled={panModeEnabled}
                      onPanModeToggle={() => setPanModeEnabled((p) => !p)}
                      onObjMultiplierRegionSelected={() => setObjMultiplierHasRegion(true)}
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
                      busy={
                        isRecording ||
                        capturePrepPanel === 'A' ||
                        (captureBusy && (embedCapturePanelId === 'A' || hubCaptureTarget === 'A'))
                      }
                      progress01={embedCapturePanelId === 'A' ? captureProgress01 : 0}
                      recordingElapsedSec={embedCapturePanelId === 'A' ? captureRecordingElapsedSec : 0}
                      errorMessage={
                        embedCapturePanelId === 'A' ||
                        capturePrepPanel === 'A' ||
                        (!embedCapturePanelId && !capturePrepPanel)
                          ? captureError
                          : null
                      }
                      countdown={embedCapturePanelId === 'A' ? captureCountdown : null}
                      stepStatus={
                        capturePrepPanel === 'A' || embedCapturePanelId === 'A' ? captureStepStatus : null
                      }
                      videoDurationSec={safeYoutubePlayerDuration(ytPlayerARef.current)}
                      onRetry={retryLastEmbedCapture}
                      showCaptureDownloadFallback={embedCaptureConsecutiveFailures >= 3}
                      captureFallbackDownloadHref={captureFallbackStreamUrl}
                      onStartRecording={(o) => startEmbedCaptureRecording('A', o)}
                      onUploadInstead={() => fileInputRef.current?.click()}
                    />
                    {renderVideoSlotPills()}
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
                        ref={embedCaptureCropTargetRefB}
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
                          {embedYtKilledB ? (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#e5e5e5',
                                padding: 16,
                                textAlign: 'center',
                                fontSize: 14,
                                fontWeight: 600,
                                gap: 8,
                              }}
                            >
                              <div>Video paused for capture</div>
                              <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.88, maxWidth: 280 }}>
                                Tap Share Screen when you are ready. The YouTube player reloads if you cancel.
                              </div>
                            </div>
                          ) : (
                            <YouTubeEmbed
                              key={`yt-b-${youtubeVideoIdB}-${ytPlayerRemountNonceB}`}
                              videoId={youtubeVideoIdB}
                              onPlayer={(p) => { ytPlayerBRef.current = p; }}
                              onEmbedReady={markEmbedReadyB}
                            />
                          )}
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
                        ref={embedCaptureCropTargetRefB}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          background: '#000',
                        }}
                      >
                        <iframe
                          ref={genericEmbedIframeRefB}
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
                      skeletonEnabled={skeletonEnabled && markupTarget === 'B'}
                      skeletonDrawEnabled={skeletonEnabled && markupTarget === 'B' && !skeletonOverlayPaused}
                      ballTrailEnabled={ballTrailEnabled}
                      onProcessingStatus={setProcessingStatus}
                      isRecording={isRecording}
                      circleSpinning={circleSpinning}
                      outlineEraserSize={outlineEraserSize}
                      onOutlineEraserSizeChange={setOutlineEraserSize}
                      webcamPipMode={webcamPipMode}
                      webcamOpacity={webcamOpacity}
                      webcamActive={webcamActive && markupTarget === 'B'}
                      skeletonShowAngles={skeletonShowAngles}
                      skeletonShowHeadLine={skeletonShowHeadLine}
                      skeletonClassicColors={skeletonClassicColors}
                      skeletonParts={skeletonParts}
                      ballSampleMode={ballSampleMode}
                      suppressTabCaptureMirror={
                        embedLiveVideoB && (!!youtubeVideoIdB || !!genericEmbedSrcB)
                      }
                      webcamCutout={webcamCutout}
                      precisionTouchDraw={isMobile && precisionDrawEnabled}
                      webcamPipMobileChrome={isMobile}
                      webcamPipBottomInsetPx={toolbarBottomReservePx}
                      poseFrameSkip={1}
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
                      busy={
                        isRecording ||
                        capturePrepPanel === 'B' ||
                        (captureBusy && (embedCapturePanelId === 'B' || hubCaptureTarget === 'B'))
                      }
                      progress01={embedCapturePanelId === 'B' ? captureProgress01 : 0}
                      recordingElapsedSec={embedCapturePanelId === 'B' ? captureRecordingElapsedSec : 0}
                      errorMessage={
                        embedCapturePanelId === 'B' ||
                        capturePrepPanel === 'B' ||
                        (!embedCapturePanelId && !capturePrepPanel)
                          ? captureError
                          : null
                      }
                      countdown={embedCapturePanelId === 'B' ? captureCountdown : null}
                      stepStatus={
                        capturePrepPanel === 'B' || embedCapturePanelId === 'B' ? captureStepStatus : null
                      }
                      videoDurationSec={safeYoutubePlayerDuration(ytPlayerBRef.current)}
                      onRetry={retryLastEmbedCapture}
                      showCaptureDownloadFallback={embedCaptureConsecutiveFailures >= 3}
                      captureFallbackDownloadHref={captureFallbackStreamUrl}
                      onStartRecording={(o) => startEmbedCaptureRecording('B', o)}
                      onUploadInstead={() => fileInputRefB.current?.click()}
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
              ref={setPlaybackDock}
              data-tour-id="playback-dock"
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
                padding: isMobile
                  ? `6px 12px calc(8px + env(safe-area-inset-bottom, 0px))`
                  : '12px 16px 16px',
                pointerEvents: 'none',
                opacity: controlsVisible ? 1 : 0.3,
                transition: 'opacity 0.4s ease',
              }}
            >
              {renderTimelineDock()}
            </div>
          </div>

          {/* Match timing: shift Video B relative to A */}
          {(videoSrcB || youtubeVideoIdB || genericEmbedSrcB) && (
            <div
              style={{
                position: 'absolute',
                right: 12,
                top: layoutMode === 'reels' ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : undefined,
                bottom: layoutMode === 'reels' ? undefined : (videoSrcB || youtubeVideoIdB || genericEmbedSrcB) ? 260 : 132,
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
              title="Shift the right video earlier or later to line up with the left clip (seconds)"
            >
              <span style={{ fontWeight: 700 }}>Match timing</span>
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
        </ReelsDesktopShell>
      </div>

      {captureError ? (
        <div
          role="alert"
          style={{
            position: 'fixed',
            // Stack below the recording pill (z250) and processing banner (z240)
            // when those are visible, so the three top-center banners never overlap.
            top: `calc(env(safe-area-inset-top, 0px) + 12px + ${isRecording ? 52 : 0}px + ${processingStatus || stroMotionProcessing ? 56 : 0}px)`,
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
          <span style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span>{captureError}</span>
            {embedCaptureConsecutiveFailures >= 3 ? (
              <span style={{ fontSize: 12, color: '#57534e', lineHeight: 1.5 }}>
                Having trouble with screen capture? You can download this video directly and upload it to
                CoachLab — it only takes a moment.
                {captureFallbackStreamUrl ? (
                  <>
                    {' '}
                    <a
                      href={captureFallbackStreamUrl}
                      download
                      style={{ color: '#007AFF', fontWeight: 600 }}
                    >
                      Get a playable copy
                    </a>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => retryLastEmbedCapture()}
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

      {/* ── Capture coach banner — visible across all 5 states ─────────────────
           State 1: "Preparing…"         captureBusy && captureCoachBanner && !captureCountdown && !captureActuallyRecording
           State 2: "Starting video…"    captureStepStatus contains 'Starting video'
           State 3: "Recording…"         captureActuallyRecording
           State 4: "Processing…"        capturePostPhase === 'processing'
           State 5: "Your video is ready" capturePostPhase === 'ready'
      ────────────────────────────────────────────────────────────────────────── */}
      {((embedCaptureRecording && captureCoachBanner) || capturePostPhase !== 'hidden') ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            zIndex: 240,
            width: 'min(520px, calc(100vw - 24px))',
            pointerEvents: 'none',
            padding: '14px 18px',
            borderRadius: 16,
            background: capturePostPhase === 'ready'
              ? 'rgba(22,101,52,0.92)'         // dark green for "ready"
              : 'rgba(0,0,0,0.82)',
            color: '#FFFFFF',
            boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            transition: 'background 0.3s ease',
          }}
        >
          <style>{`
            @keyframes cl-rec-dot  { 0%,100%{opacity:1}  50%{opacity:0.25} }
            @keyframes cl-proc-spin { to { transform: rotate(360deg); } }
          `}</style>

          {/* ── Post-recording: "Processing your video…" or "Your video is ready" ── */}
          {capturePostPhase !== 'hidden' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {capturePostPhase === 'processing' ? (
                <>
                  <span style={{
                    width: 14, height: 14,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#FFFFFF',
                    borderRadius: '50%',
                    animation: 'cl-proc-spin 0.8s linear infinite',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35 }}>
                    Processing your video…
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>✓</span>
                  <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>
                    Your video is ready
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              {/* ── Active recording headline ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                {captureActuallyRecording ? (
                  <>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#FF3B30',
                        animation: 'cl-rec-dot 1.2s ease-in-out infinite',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35 }}>
                      Recording in progress — do not switch tabs
                    </span>
                  </>
                ) : captureCountdown != null ? (
                  <span style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35 }}>
                    Video is playing — starting in {captureCountdown}…
                  </span>
                ) : captureStepStatus?.startsWith('Starting video') ? (
                  <span style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35 }}>
                    Starting video…
                  </span>
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35 }}>
                    Preparing…
                  </span>
                )}
              </div>

              {/* Timer: only shown once recorder has actually started */}
              {captureActuallyRecording && (
                <div
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: 0.5,
                    textAlign: 'center',
                    marginBottom: 10,
                  }}
                >
                  {Math.floor(captureRecordingElapsedSec / 60)}:
                  {String(captureRecordingElapsedSec % 60).padStart(2, '0')}
                </div>
              )}

              {/* Countdown big number during 3-2-1 */}
              {!captureActuallyRecording && captureCountdown != null && (
                <div
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 52,
                    fontWeight: 900,
                    textAlign: 'center',
                    lineHeight: 1,
                    marginBottom: 10,
                    opacity: 0.95,
                  }}
                >
                  {captureCountdown}
                </div>
              )}

              {/* Progress bar */}
              <div style={{ width: '100%', height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.25)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(Math.min(1, Math.max(0, captureProgress01)) * 100)}%`,
                    background: captureActuallyRecording ? '#34C759' : 'rgba(255,255,255,0.55)',
                    borderRadius: 6,
                    transition: 'width 0.15s ease-out',
                  }}
                />
              </div>
            </>
          )}
        </div>
      ) : null}

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

      {/* Guided tour: floating "?" + spotlight overlay (portaled to body). */}
      {isRecording &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 250,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 999,
              background: 'rgba(255, 59, 48, 0.95)',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 700,
              boxShadow: '0 8px 28px rgba(255,59,48,0.35)',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#FFFFFF',
                animation: 'hubRecPulse 1.2s ease-in-out infinite',
              }}
            />
            Recording
          </div>,
          document.body,
        )}

      {(processingStatus || stroMotionProcessing) && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            // Drop below the recording pill (z250) when both are visible.
            top: `calc(env(safe-area-inset-top, 0px) + 12px + ${isRecording ? 52 : 0}px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 240,
            maxWidth: 'min(420px, calc(100vw - 24px))',
            padding: '10px 16px',
            borderRadius: 12,
            background: 'rgba(250, 249, 247, 0.97)',
            border: '1px solid #E5E5E5',
            color: '#1A1A1A',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.45,
            boxShadow: '0 12px 36px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          {stroMotionProcessing && stroMotionProgress
            ? stroMotionProgress
            : processingStatus}
        </div>
      )}

      {recordingSession?.videoBlob &&
        typeof document !== 'undefined' &&
        createPortal(
          <PostRecordingCropModal
            blob={recordingSession.videoBlob}
            ext={recordingSession.ext}
            seedRegionFrac={recordingAreaSeed?.frac ?? null}
            seedAspect={recordingAreaSeed?.aspect}
            startInCrop={recordingSession.mode === 'selected-area'}
            onCancel={handleRecordingReviewCancel}
            onDownloadFull={handleRecordingDownloadFull}
            onExportCrop={handleRecordingExportCrop}
          />,
          document.body,
        )}

      <GuidedTour suppressFloatingHelp />
    </div>
  );
}
