'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Camera, Plus, Trash2, Upload } from 'lucide-react';
import type { CanvasHandle } from '@/components/Canvas';
import ToolPalette, { type BallTrailMode, type WebcamPipMode } from '@/components/ToolPalette';
import PreciseTimeline from '@/components/PreciseTimeline';
import { RecordingHubContent } from '@/components/RecordingHub';
import type { ViewportRegion } from '@/components/RegionRecordOverlay';
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
import { downloadDataURL, captureFrame } from '@/lib/drawingTools';
import { useStroMotion } from '@/hooks/useStroMotion';
import { useAIMetrics } from '@/hooks/useAIMetrics';
import StroMotionPanel from '@/components/StroMotionPanel';
import BiomechanicsPanel from '@/components/BiomechanicsPanel';
import FrameMeasurementEditor from '@/components/aiMetrics/FrameMeasurementEditor';
import SaveSessionModal from '@/components/sessions/SaveSessionModal';
import { useSessionDraft } from '@/hooks/useSessionDraft';
import { renderMeasurementCard } from '@/lib/biomechanics';
import {
  AIMETRICS_DEFAULT_FRAME_COUNT,
  frameHasMeasurements,
  getWorkingMeasurements,
  type AIMetricsFrameCount,
} from '@/lib/aiMetricsDraft';
import {
  computeGhostSampleTimes,
  enforceMonotonicSampleTimes,
  setStroMotionPreviewHash,
  normalizeObjectBox,
  normalizeSubjectBox,
  subjectBoxFromRegion,
} from '@/lib/stroMotion';
import {
  allFramesReady,
  captureVideoFrameAtTime,
  countExportReadyFrames,
  countFramesWithPreviewMask,
  exportStroMotionDraftPng,
  frameHasMask,
  maskHasContent,
  STRO_MOTION_DEFAULT_FRAME_COUNT,
  STRO_MOTION_FRAME_COUNTS,
  type StroMotionBackground,
  type StroMotionFrameCount,
  type StroMotionVideoOrder,
} from '@/lib/stroMotionDraft';
import FrameMaskEditor from '@/components/stroMotion/FrameMaskEditor';
import StroMotionPreviewModal from '@/components/stroMotion/StroMotionPreviewModal';
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
import AuthButton from '@/components/AuthButton';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import RulerOverlay from '@/components/ruler/RulerOverlay';
import FrameMetricsReportModal, { type FrameMetricsReportFrame } from '@/components/frameMetrics/FrameMetricsReportModal';
import { uploadDataUrl } from '@/lib/supabase/storage';
import { proposePhaseMarkers } from '@/lib/biomechanics/phaseDetection';
import { skeletonFramesToSamples } from '@/lib/biomechanics/poseSampling';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

// Dynamic import prevents TensorFlow / Fabric from loading server-side
const CanvasOverlay = dynamic(() => import('@/components/Canvas'), { ssr: false });

// Tools that draw on the canvas and own the draw "context" (style controls).
const DRAW_CONTEXT_TOOLS: ToolType[] = [
  'pen', 'line', 'arrow', 'arrowAngle', 'circle', 'rect', 'triangle',
  'bodyCircle', 'text', 'angle', 'manualSwing', 'swingPath', 'jointChain',
];

/** Full-viewport invisible decoder — opacity 0 can block Safari frame delivery; keep off-screen but sized. */
const hiddenDecoderVideoStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  opacity: 0.01,
  pointerEvents: 'none',
  zIndex: 0,
  objectFit: 'contain',
};

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
  // Keep a stable two-div wrapper so toggling 16:9 ↔ 9:16 does not remount
  // toolbar children (which would reset ToolPalette navStack to home).
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        width: '100%',
        ...(enabled
          ? { justifyContent: 'center', alignItems: 'center', background: '#000' }
          : {}),
      }}
    >
      <div
        style={
          enabled
            ? {
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
              }
            : {
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'row',
                overflow: 'hidden',
                width: '100%',
              }
        }
      >
        {children}
      </div>
    </div>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contextPlayerId = searchParams.get('playerId');
  const contextSessionId = searchParams.get('sessionId');
  const [contextPlayerName, setContextPlayerName] = useState<string | null>(null);
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
  const [recordingSession, setRecordingSession] = useState<{
    videoBlob: Blob | null;
    ext: string;
    cropRegion: null | { x: number; y: number; width: number; height: number; aspectRatio?: CropAspect };
  } | null>(null);
  const [isRecording, setIsRecording]     = useState(false);
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
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
  const [videoLoadErrorA, setVideoLoadErrorA] = useState<string | null>(null);
  /** Drag-over state for the two video panels */
  const [isDragOverA, setIsDragOverA]       = useState(false);
  const [isDragOverB, setIsDragOverB]       = useState(false);
  const [drawContextActive, setDrawContextActive] = useState(false);
  const [isMobile, setIsMobile]             = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [showMobileToolStrip, setShowMobileToolStrip] = useState(false);
  const reelsDesktopEarly = !isMobile && layoutMode === 'reels';
  const phoneToolbarLayout = isMobile || showMobileToolStrip || reelsDesktopEarly;
  const compactToolbarRail = phoneToolbarLayout || (!isMobile && toolbarCollapsed);
  /** Large tap targets only on real phones — desktop 9:16 preview keeps compact UI */
  const touchChrome                         = isMobile;

  // StroMotion state (Dartfish-style subject box workflow)
  const [stroMotionActive, setStroMotionActive] = useState(false);
  const [stroStartFrame, setStroStartFrame] = useState(0);
  const [stroEndFrame, setStroEndFrame] = useState(3);
  const [stroFrameCount, setStroFrameCount] = useState<StroMotionFrameCount>(STRO_MOTION_DEFAULT_FRAME_COUNT);
  const [stroSelectingObject, setStroSelectingObject] = useState(false);
  const [stroSelectingFrameIndex, setStroSelectingFrameIndex] = useState<number | null>(null);
  const [stroVideoTime, setStroVideoTime] = useState(0);
  const [stroVideoDuration, setStroVideoDuration] = useState(0);
  const [stroVisibleCount, setStroVisibleCount] = useState<number | undefined>(undefined);
  const [stroShowSkeleton, setStroShowSkeleton] = useState(false);
  const [stroBackground, setStroBackground] = useState<'start' | 'end'>('start');
  const [stroVideoOrder, setStroVideoOrder] = useState<'forward' | 'reverse'>('forward');
  const [stroEndPlate, setStroEndPlate] = useState<ImageBitmap | null>(null);
  const [stroSampleTimesOverride, setStroSampleTimesOverride] = useState<number[] | null>(null);
  const [stroPreviewPngUrl, setStroPreviewPngUrl] = useState<string | null>(null);
  const [stroEditingFrameIndex, setStroEditingFrameIndex] = useState<number | null>(null);
  const [stroPreviewVideoUrl, setStroPreviewVideoUrl] = useState<string | null>(null);
  const [stroPreviewModalOpen, setStroPreviewModalOpen] = useState(false);
  const [stroPreviewError, setStroPreviewError] = useState<string | null>(null);
  const [stroIsBuildingVideoPreview, setStroIsBuildingVideoPreview] = useState(false);
  const stroPreviewVideoBlobRef = useRef<Blob | null>(null);
  const [sessionSaveModalOpen, setSessionSaveModalOpen] = useState(false);

  useEffect(() => {
    if (!contextPlayerId) {
      setContextPlayerName(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/players/${contextPlayerId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.player?.display_name) {
          setContextPlayerName(data.player.display_name as string);
        }
      })
      .catch(() => {
        if (!cancelled) setContextPlayerName(null);
      });
    return () => { cancelled = true; };
  }, [contextPlayerId]);

  const {
    draft: sessionDraft,
    hasContent: sessionDraftHasContent,
    applyStroMotion: applyStroMotionToDraft,
    applyAIMetrics: applyAIMetricsToDraft,
    setTitle: setSessionDraftTitle,
    resetDraft: resetSessionDraft,
  } = useSessionDraft();

  const stroSampleTimes = useMemo(
    () => computeGhostSampleTimes(stroStartFrame, stroEndFrame, stroFrameCount),
    [stroStartFrame, stroEndFrame, stroFrameCount],
  );

  const stroEffectiveSampleTimes = useMemo(() => {
    if (stroSampleTimesOverride?.length === stroFrameCount) return stroSampleTimesOverride;
    return stroSampleTimes;
  }, [stroSampleTimesOverride, stroSampleTimes, stroFrameCount]);

  useEffect(() => {
    setStroSampleTimesOverride(null);
  }, [stroStartFrame, stroEndFrame, stroFrameCount]);

  const stroMotionHtml5Only =
    !!videoSrc &&
    !youtubeVideoIdA &&
    !youtubeVideoIdB &&
    !genericEmbedSrcA &&
    !genericEmbedSrcB;

  // AI Metrics (coach override — frame time + optional labels)
  const biomechClearingRef = useRef(false);
  const [biomechActive, setBiomechActive] = useState(false);
  const [biomechVideoTime, setBiomechVideoTime] = useState(0);
  const [biomechVideoDuration, setBiomechVideoDuration] = useState(0);
  const [biomechFrameCount, setBiomechFrameCount] = useState<AIMetricsFrameCount>(AIMETRICS_DEFAULT_FRAME_COUNT);
  const [biomechSampleTimesOverride, setBiomechSampleTimesOverride] = useState<number[] | null>(null);
  const [biomechFrameCards, setBiomechFrameCards] = useState<Array<{ id: string; label: string; timeSec: number; imageUrl: string }>>([]);
  const [biomechReportAnalysis, setBiomechReportAnalysis] = useState<import('@/lib/biomechanics/types').BiomechanicsAnalysis | null>(null);
  const [biomechEditingFrameIndex, setBiomechEditingFrameIndex] = useState<number | null>(null);
  const [biomechPhaseMarkers, setBiomechPhaseMarkers] = useState<Array<{ id: string; label: string; short?: string; time: number }> | null>(null);
  const [biomechSelectedPhaseId, setBiomechSelectedPhaseId] = useState<string | null>(null);
  const biomechHtml5Only = stroMotionHtml5Only;
  /** Per-frame captured screenshots: frameIndex → data URL */
  const [biomechCapturedImages, setBiomechCapturedImages] = useState<Record<number, string>>({});
  /** Per-frame user notes: frameIndex → string */
  const [biomechFrameNotes, setBiomechFrameNotes] = useState<Record<number, string>>({});
  const [biomechMeasurements, setBiomechMeasurements] = useState<Record<number, { footDirection?: boolean; racketDirection?: boolean; footDistance?: boolean }>>({});
  /** Whether the Frame Metrics report modal is open */
  const [biomechReportModalOpen, setBiomechReportModalOpen] = useState(false);

  const {
    draft: aiMetricsDraft,
    status: aiMetricsStatus,
    strokeType: biomechStrokeType,
    setStrokeType: setBiomechStrokeType,
    customSteps: biomechCustomSteps,
    addCustomStep: addBiomechCustomStep,
    renameCustomStep: renameBiomechCustomStep,
    deleteCustomStep: deleteBiomechCustomStep,
    reorderCustomStep: reorderBiomechCustomStep,
    trimStartSec: biomechTrimStart,
    setTrimStartSec: setBiomechTrimStart,
    trimEndSec: biomechTrimEnd,
    setTrimEndSec: setBiomechTrimEnd,
    activeFrameIndex: biomechActiveFrameIndex,
    setActiveFrameIndex: setBiomechActiveFrameIndex,
    proposingFrameIndex: biomechProposingFrameIndex,
    isProposingFrame: biomechProposingFrame,
    isGenerating: biomechGenerating,
    isProcessing: biomechProcessing,
    progress: biomechProgress,
    showSkeleton: biomechShowSkeleton,
    setShowSkeleton: setBiomechShowSkeleton,
    syncDraft: syncAIMetricsDraft,
    addFrame: addBiomechFrame,
    removeFrame: removeBiomechFrame,
    updateFrameTime: updateBiomechFrameTime,
    updateEnabledModule: updateBiomechEnabledModule,
    updateFrameEnabledModule: updateBiomechFrameEnabledModule,
    setFrameSkeletonStamp: setBiomechFrameSkeletonStamp,
    proposeMeasurementsForFrame: proposeBiomechFrameMeasurements,
    updateFrameMeasurements: updateBiomechFrameMeasurements,
    resetFrameMeasurements: resetBiomechFrameMeasurements,
    reproposeFrameMeasurements: reproposeBiomechFrameMeasurements,
    markFrameReady: markBiomechFrameReady,
    generateReport: generateBiomechReport,
    invalidateReport: invalidateBiomechReport,
    clearAll: clearBiomechAll,
    autoProposeAllFrames: autoProposeAllBiomechFrames,
    readyCount: biomechReadyCount,
    enabledModules: biomechEnabledModules,
  } = useAIMetrics(videoRef);

  const biomechDefaultSampleTimes = useMemo(
    () => computeGhostSampleTimes(biomechTrimStart, biomechTrimEnd, biomechFrameCount),
    [biomechTrimStart, biomechTrimEnd, biomechFrameCount],
  );

  const biomechEffectiveSampleTimes = useMemo(() => {
    if (biomechSampleTimesOverride?.length === biomechFrameCount) return biomechSampleTimesOverride;
    return biomechDefaultSampleTimes;
  }, [biomechSampleTimesOverride, biomechDefaultSampleTimes, biomechFrameCount]);

  useEffect(() => {
    setBiomechSampleTimesOverride(null);
  }, [biomechTrimStart, biomechTrimEnd, biomechFrameCount]);

  const {
    draft: stroMotionDraft,
    status: stroMotionStatus,
    objectType: stroObjectType,
    setObjectType: setStroObjectType,
    activeFrameIndex: stroActiveFrameIndex,
    setActiveFrameIndex: setStroActiveFrameIndex,
    proposingFrameIndex: stroProposingFrameIndex,
    isProposingFrame: stroProposingFrame,
    isGenerating: stroGenerating,
    isProcessing: stroMotionProcessing,
    progress: stroMotionProgress,
    syncDraft: syncStroDraft,
    updateFrameTime: updateStroFrameTime,
    selectAreaForFrame: selectStroAreaForFrame,
    updateFrameMask,
    resetFrameMask,
    reproposeFrameMask,
    markFrameReady: markStroFrameReady,
    generatePreview: generateStroPreview,
    hydrateDraftForExport: hydrateStroDraftForExport,
    invalidatePreview: invalidateStroPreview,
    clearAll: clearStroMotionAll,
    setConfiguring: setStroMotionConfiguring,
  } = useStroMotion(videoRef);

  const stroVideoExportSupported =
    typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const [stroIsExportingVideo, setStroIsExportingVideo] = useState(false);

  // Object Multiplier state
  const [objMultiplierFrameCount, setObjMultiplierFrameCount] = useState(5);
  const [objMultiplierHasRegion, setObjMultiplierHasRegion] = useState(false);
  const [objMultiplierProgress, setObjMultiplierProgress] = useState<string | null>(null);

  // Derived: skeleton / ball trail enabled when their tool is active
  const skeletonEnabled  = activeTool === 'skeleton' || (biomechActive && biomechHtml5Only && biomechShowSkeleton) || (stroMotionActive && stroShowSkeleton);
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

  /** Full reset — used when navigating away or changing video. Exits StroMotion mode. */
  const resetStroMotion = useCallback(() => {
    clearStroMotionAll();
    setStroMotionActive(false);
    setStroSelectingObject(false);
    setStroSelectingFrameIndex(null);
    setStroVisibleCount(undefined);
    canvasRef.current?.setStroMotionVisibleCount?.(undefined);
    setStroMotionConfiguring(false);
    setStroSampleTimesOverride(null);
    if (stroPreviewVideoUrl) URL.revokeObjectURL(stroPreviewVideoUrl);
    stroPreviewVideoBlobRef.current = null;
    setStroPreviewPngUrl(null);
    setStroPreviewVideoUrl(null);
    setStroPreviewModalOpen(false);
    setStroIsBuildingVideoPreview(false);
    setStroEditingFrameIndex(null);
  }, [clearStroMotionAll, setStroMotionConfiguring, stroPreviewVideoUrl]);

  /** Soft clear — used by the panel's Clear button. Stays in StroMotion mode. */
  const softClearStroMotion = useCallback(() => {
    clearStroMotionAll();
    setStroSelectingObject(false);
    setStroSelectingFrameIndex(null);
    setStroVisibleCount(undefined);
    canvasRef.current?.setStroMotionVisibleCount?.(undefined);
    setStroSampleTimesOverride(null);
    setStroBackground('start');
    setStroVideoOrder('forward');
    if (stroPreviewVideoUrl) URL.revokeObjectURL(stroPreviewVideoUrl);
    stroPreviewVideoBlobRef.current = null;
    setStroPreviewPngUrl(null);
    setStroPreviewVideoUrl(null);
    setStroPreviewModalOpen(false);
    setStroIsBuildingVideoPreview(false);
    setStroEditingFrameIndex(null);
  }, [clearStroMotionAll, stroPreviewVideoUrl]);

  const refreshStroPreviewFromDraft = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !stroMotionDraft || stroMotionStatus !== 'ready') return;
    try {
      const pngUrl = await exportStroMotionDraftPng(video, stroMotionDraft);
      setStroPreviewPngUrl(pngUrl);
      setStroMotionPreviewHash(null);
      if (stroPreviewVideoUrl) {
        URL.revokeObjectURL(stroPreviewVideoUrl);
        stroPreviewVideoBlobRef.current = null;
        setStroPreviewVideoUrl(null);
      }
    } catch (err) {
      console.error('[StroMotion] Draft preview PNG error:', err);
    }
  }, [stroMotionDraft, stroMotionStatus, stroPreviewVideoUrl]);

  const seekStroVideo = useCallback(async (timeSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const dur = Number.isFinite(v.duration) ? v.duration : timeSec;
    const next = Math.max(0, Math.min(timeSec, dur));
    if (Math.abs(v.currentTime - next) > 0.00001 || v.seeking) {
      v.currentTime = next;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener('seeked', onSeeked);
          resolve();
        };
        v.addEventListener('seeked', onSeeked, { once: true });
        window.setTimeout(resolve, 120);
      });
    }
    setStroVideoTime(next);
    await canvasRef.current?.waitForRender?.();
  }, []);

  const stroReadyCount = useMemo(
    () => countExportReadyFrames(stroMotionDraft?.frames ?? []),
    [stroMotionDraft],
  );

  const stroAllFramesExportReady = useMemo(
    () => (stroMotionDraft ? allFramesReady(stroMotionDraft.frames) : false),
    [stroMotionDraft],
  );

  const stroFrameRows = useMemo(
    () => (stroMotionDraft?.frames ?? []).map((f) => ({
      index: f.index,
      timeSec: f.timeSec,
      label: f.label,
      status: f.status,
      hasMask: frameHasMask(f),
      hasSelection: !!f.selectionBox,
    })),
    [stroMotionDraft],
  );

  // Capture end-frame plate whenever endFrame or video changes
  useEffect(() => {
    if (!stroMotionActive || !stroMotionHtml5Only || !videoSrc) return;
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    captureVideoFrameAtTime(v, stroEndFrame).then((bitmap) => {
      if (cancelled) { try { bitmap.close(); } catch { /* closed */ } return; }
      setStroEndPlate((prev) => {
        if (prev) try { prev.close(); } catch { /* closed */ }
        return bitmap;
      });
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [stroMotionActive, stroMotionHtml5Only, videoSrc, stroEndFrame]);

  useEffect(() => {
    if (!stroMotionActive || !stroMotionHtml5Only) return;
    if (stroEndFrame <= stroStartFrame) return;
    void syncStroDraft({
      objectType: stroObjectType,
      backgroundTimeSec: stroStartFrame,
      sampleTimes: stroEffectiveSampleTimes,
    });
  }, [
    stroMotionActive,
    stroMotionHtml5Only,
    stroObjectType,
    stroStartFrame,
    stroEndFrame,
    stroEffectiveSampleTimes,
    syncStroDraft,
  ]);

  const handleStroObjectTypeChange = useCallback((type: typeof stroObjectType) => {
    setStroObjectType(type);
    invalidateStroPreview();
    setStroPreviewPngUrl(null);
    if (stroPreviewVideoUrl) URL.revokeObjectURL(stroPreviewVideoUrl);
    stroPreviewVideoBlobRef.current = null;
    setStroPreviewVideoUrl(null);
  }, [invalidateStroPreview, setStroObjectType, stroPreviewVideoUrl]);

  const handleStroSelectFrame = useCallback((index: number) => {
    const frame = stroMotionDraft?.frames[index];
    const timeSec = frame?.timeSec ?? stroEffectiveSampleTimes[index];
    if (timeSec === undefined) return;
    setStroActiveFrameIndex(index);
    void seekStroVideo(timeSec);
  }, [seekStroVideo, stroEffectiveSampleTimes, stroMotionDraft, setStroActiveFrameIndex]);

  const finishStroRegionSelect = useCallback((
    index: number,
    region: { x: number; y: number; w: number; h: number } | null,
  ) => {
    setStroSelectingObject(false);
    setStroSelectingFrameIndex(null);
    if (!region) {
      setProcessingStatus('Selection cancelled — click Select Area to try again.');
      return;
    }
    setProcessingStatus('Removing background…');
    const raw = subjectBoxFromRegion(region);
    const normalized = stroObjectType === 'player'
      ? normalizeSubjectBox(raw)
      : normalizeObjectBox(raw);
    void selectStroAreaForFrame(index, normalized)
      .then((ok) => {
        setStroEditingFrameIndex(index);
        if (!ok) {
          setProcessingStatus('Mask proposal failed — use Add brush or Re-propose mask.');
        } else {
          setProcessingStatus(null);
        }
        void canvasRef.current?.waitForRender?.();
      })
      .catch(() => {
        setProcessingStatus('Mask proposal failed — try Select Area again.');
      });
  }, [selectStroAreaForFrame, stroObjectType]);

  const autoSelectStroFrameFromSkeleton = useCallback(async (index: number): Promise<boolean> => {
    const frame = stroMotionDraft?.frames[index];
    if (!frame || frame.selectionBox) return false;
    const timeSec = frame.timeSec;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return false;

    // Get skeleton keypoints near this frame time
    const skFrames = canvasRef.current?.getSkeletonFrames?.() ?? [];
    const nearest = skFrames.reduce<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number }> } | null>((best, f) => {
      if (!best || Math.abs(f.timeSeconds - timeSec) < Math.abs(best.timeSeconds - timeSec)) return f;
      return best;
    }, null);

    if (!nearest?.keypoints?.length) return false;

    const validKps = nearest.keypoints.filter(kp => kp.score >= 0.2);
    if (validKps.length < 4) return false;

    // Compute bounding box from keypoints with 25% padding
    const xs = validKps.map(kp => kp.x);
    const ys = validKps.map(kp => kp.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = (maxX - minX) * 0.25;
    const padY = (maxY - minY) * 0.25;
    const region = {
      x: Math.max(0, minX - padX),
      y: Math.max(0, minY - padY),
      w: Math.min(video.videoWidth, maxX + padX) - Math.max(0, minX - padX),
      h: Math.min(video.videoHeight, maxY + padY) - Math.max(0, minY - padY),
    };

    await seekStroVideo(timeSec);
    finishStroRegionSelect(index, region);
    return true;
  }, [stroMotionDraft, videoRef, canvasRef, seekStroVideo, finishStroRegionSelect]);

  const handleStroSelectArea = useCallback((index: number) => {
    const frame = stroMotionDraft?.frames[index];
    const timeSec = frame?.timeSec ?? stroEffectiveSampleTimes[index];
    if (timeSec === undefined) return;
    setStroActiveFrameIndex(index);
    setStroSelectingFrameIndex(index);
    setStroSelectingObject(true);
    setProcessingStatus('Draw a box around the object on the video…');
    void seekStroVideo(timeSec).then(() => {
      canvasRef.current?.startStroMotionRegionSelect?.((region) => {
        finishStroRegionSelect(index, region);
      });
    });
  }, [finishStroRegionSelect, seekStroVideo, setStroActiveFrameIndex, stroEffectiveSampleTimes, stroMotionDraft]);

  const handleStroMarkReadyAndNext = useCallback((index: number) => {
    if (!markStroFrameReady(index)) {
      setProcessingStatus('Use Auto remove background or Add brush until the subject is visible.');
      return;
    }
    invalidateStroPreview();
    setStroPreviewPngUrl(null);
    const frames = stroMotionDraft?.frames ?? [];
    const next = frames.find((f) => f.index !== index && f.status !== 'ready' && frameHasMask(f));
    const needsArea = frames.find((f) => f.status !== 'ready' && !frameHasMask(f));
    if (next) {
      setStroEditingFrameIndex(next.index);
      setStroActiveFrameIndex(next.index);
      void seekStroVideo(next.timeSec);
      void canvasRef.current?.waitForRender?.();
      return;
    }
    setStroEditingFrameIndex(null);
    void canvasRef.current?.waitForRender?.();
    if (needsArea) {
      setStroActiveFrameIndex(needsArea.index);
      void seekStroVideo(needsArea.timeSec);
      setProcessingStatus(`Frame ${needsArea.index + 1} still needs Select Area.`);
      return;
    }
    setProcessingStatus('All frames ready — press Generate StroMotion.');
  }, [invalidateStroPreview, markStroFrameReady, seekStroVideo, stroMotionDraft, setStroActiveFrameIndex]);

  const handleStroMarkReady = useCallback((index: number): boolean => {
    if (!markStroFrameReady(index)) {
      setProcessingStatus('Use Auto remove background or Add brush until the subject is visible.');
      return false;
    }
    invalidateStroPreview();
    setStroPreviewPngUrl(null);
    return true;
  }, [invalidateStroPreview, markStroFrameReady]);

  const buildStroVideoPreview = useCallback(async () => {
    if (!stroVideoExportSupported) return false;
    setStroIsBuildingVideoPreview(true);
    try {
      await hydrateStroDraftForExport();
      await canvasRef.current?.waitForRender?.();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      const exportResult = await canvasRef.current?.exportStroMotionVideo?.();
      if (!exportResult?.ok || !exportResult.url) return false;
      setStroPreviewVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return exportResult.url ?? null;
      });
      stroPreviewVideoBlobRef.current = exportResult.blob ?? null;
      return true;
    } catch (err) {
      console.error('[StroMotion] Video preview error:', err);
      return false;
    } finally {
      setStroIsBuildingVideoPreview(false);
      canvasRef.current?.setStroMotionVisibleCount?.(undefined);
      setStroVisibleCount(undefined);
    }
  }, [hydrateStroDraftForExport, stroVideoExportSupported]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const syncMeta = () => {
      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setStroVideoDuration(dur);
        setStroEndFrame((prev) => (prev <= stroStartFrame || prev > dur ? Math.min(Math.max(stroStartFrame + 1, 3), dur) : prev));
        setBiomechVideoDuration(dur);
        setBiomechTrimEnd((prev) =>
          prev <= biomechTrimStart || prev > dur
            ? Math.min(Math.max(biomechTrimStart + 1, 3), dur)
            : prev,
        );
      }
      setStroVideoTime(v.currentTime || 0);
      setBiomechVideoTime(v.currentTime || 0);
    };
    v.addEventListener('loadedmetadata', syncMeta);
    v.addEventListener('timeupdate', syncMeta);
    syncMeta();
    return () => {
      v.removeEventListener('loadedmetadata', syncMeta);
      v.removeEventListener('timeupdate', syncMeta);
    };
  }, [videoSrc, stroStartFrame, biomechTrimStart]);

  const biomechFrameRows = useMemo(
    () => (aiMetricsDraft?.frames ?? []).map((f) => ({
      index: f.index,
      timeSec: f.timeSec,
      label: f.label,
      status: f.status,
      hasMeasurements: frameHasMeasurements(f),
      hasSkeletonStamp: !!f.skeletonStamp,
      enabledModules: f.enabledModules,
      capturedImageUrl: biomechCapturedImages[f.index],
      notes: biomechFrameNotes[f.index],
      footDirectionDone: biomechMeasurements[f.index]?.footDirection,
      racketDirectionDone: biomechMeasurements[f.index]?.racketDirection,
      footDistanceDone: biomechMeasurements[f.index]?.footDistance,
    })),
    [aiMetricsDraft, biomechCapturedImages, biomechFrameNotes, biomechMeasurements],
  );

  useEffect(() => {
    // Skip one cycle right after Clear so the draft stays null instead of
    // being immediately re-populated by the sample-times reset.
    if (biomechClearingRef.current) {
      biomechClearingRef.current = false;
      return;
    }
    if (!biomechActive || !biomechHtml5Only) return;
    if (biomechTrimEnd <= biomechTrimStart) return;
    syncAIMetricsDraft({
      strokeType: biomechStrokeType,
      trimStartSec: biomechTrimStart,
      trimEndSec: biomechTrimEnd,
      sampleTimes: biomechEffectiveSampleTimes,
      customSteps: biomechStrokeType === 'custom' ? biomechCustomSteps : undefined,
    });
  }, [
    biomechActive,
    biomechHtml5Only,
    biomechStrokeType,
    biomechTrimStart,
    biomechTrimEnd,
    biomechEffectiveSampleTimes,
    biomechCustomSteps,
    syncAIMetricsDraft,
  ]);

  // Auto-propose measurements for all pending frames when draft has frames without pose data
  const biomechAutoProposedRef = useRef(false);
  useEffect(() => {
    if (!biomechActive || !biomechHtml5Only || !aiMetricsDraft) return;
    const hasPending = aiMetricsDraft.frames.some(f => !f.poseSample);
    if (!hasPending || biomechAutoProposedRef.current) return;
    biomechAutoProposedRef.current = true;
    void autoProposeAllBiomechFrames().then(() => {
      biomechAutoProposedRef.current = false;
    });
  }, [biomechActive, biomechHtml5Only, aiMetricsDraft, autoProposeAllBiomechFrames]);

  // Auto-propose stroke phase markers from skeleton data
  useEffect(() => {
    if (!biomechActive || !biomechHtml5Only) { setBiomechPhaseMarkers(null); return; }
    if (biomechTrimEnd <= biomechTrimStart) return;
    const skFrames = canvasRef.current?.getSkeletonFrames?.() ?? [];
    if (skFrames.length < 3) return;
    const samples = skeletonFramesToSamples(skFrames);
    const markers = proposePhaseMarkers(
      biomechStrokeType,
      samples,
      biomechTrimStart,
      biomechTrimEnd,
      biomechStrokeType === 'custom' ? biomechCustomSteps : undefined,
    );
    if (markers.length > 0) {
      setBiomechPhaseMarkers(markers.map(m => ({ id: m.id, label: m.label, short: m.short, time: m.timeSec })));
    }
  }, [biomechActive, biomechHtml5Only, biomechTrimStart, biomechTrimEnd, biomechStrokeType, biomechCustomSteps]);

  useEffect(() => {
    if (stroMotionActive && stroMotionHtml5Only && !stroMotionProcessing) {
      setStroMotionConfiguring(true);
    } else if (!stroMotionActive) {
      setStroMotionConfiguring(false);
    }
  }, [stroMotionActive, stroMotionHtml5Only, stroMotionProcessing, setStroMotionConfiguring]);

  const handleStroGenerate = useCallback(async () => {
    if (stroEndFrame <= stroStartFrame) {
      alert('End frame must be after start frame.');
      return;
    }
    if (!stroMotionDraft || !stroAllFramesExportReady) {
      alert(`Mark every frame Ready with a visible mask before generating (${stroReadyCount}/${stroMotionDraft?.frames.length ?? 0} ready).`);
      return;
    }
    setStroVisibleCount(undefined);
    canvasRef.current?.setStroMotionVisibleCount?.(undefined);
    setStroMotionPreviewHash(null);
    if (stroPreviewVideoUrl) URL.revokeObjectURL(stroPreviewVideoUrl);
    stroPreviewVideoBlobRef.current = null;
    setStroPreviewVideoUrl(null);
    setStroPreviewPngUrl(null);
    setStroPreviewError(null);
    setStroPreviewModalOpen(true);

    await hydrateStroDraftForExport();
    const pngUrl = await generateStroPreview({ background: stroBackground, videoOrder: stroVideoOrder, endTimeSec: stroEndFrame });
    if (!pngUrl) {
      setStroPreviewError('Could not build the StroMotion image. Close and try Generate again.');
      return;
    }
    setStroPreviewPngUrl(pngUrl);
    setStroPreviewError(null);

    if (stroVideoExportSupported) {
      void buildStroVideoPreview();
    }
  }, [
    buildStroVideoPreview,
    generateStroPreview,
    hydrateStroDraftForExport,
    stroAllFramesExportReady,
    stroBackground,
    stroEndFrame,
    stroMotionDraft,
    stroPreviewVideoUrl,
    stroReadyCount,
    stroStartFrame,
    stroVideoExportSupported,
    stroVideoOrder,
  ]);

  useEffect(() => {
    if (stroMotionStatus !== 'ready' || !stroMotionDraft) return;
    applyStroMotionToDraft({
      draft: stroMotionDraft,
      pngDataUrl: stroPreviewPngUrl,
      videoBlob: stroPreviewVideoBlobRef.current,
      trimStartSec: stroStartFrame,
      trimEndSec: stroEndFrame,
    });
    setSessionDraftTitle(`${localDateTimeForFolder()} — StroMotion`);
  }, [
    applyStroMotionToDraft,
    setSessionDraftTitle,
    stroMotionDraft,
    stroMotionStatus,
    stroPreviewPngUrl,
    stroPreviewVideoUrl,
    stroStartFrame,
    stroEndFrame,
  ]);

  const handleStroDownloadPng = useCallback(() => {
    if (stroPreviewPngUrl) {
      downloadDataURL(stroPreviewPngUrl, `stromotion-${Date.now()}.png`);
      return;
    }
    const video = videoRef.current;
    if (video && stroMotionDraft) {
      void exportStroMotionDraftPng(video, stroMotionDraft).then((url) => {
        downloadDataURL(url, `stromotion-${Date.now()}.png`);
      }).catch(() => {
        alert('Could not export PNG. Generate StroMotion first.');
      });
      return;
    }
    alert('Generate StroMotion first.');
  }, [stroMotionDraft, stroPreviewPngUrl]);

  const handleStroEditFrame = useCallback((index: number) => {
    const frame = stroMotionDraft?.frames[index];
    const timeSec = frame?.timeSec ?? stroEffectiveSampleTimes[index];
    setStroEditingFrameIndex(index);
    setStroActiveFrameIndex(index);
    if (timeSec !== undefined) void seekStroVideo(timeSec);
  }, [seekStroVideo, setStroActiveFrameIndex, stroEffectiveSampleTimes, stroMotionDraft]);

  const handleStroCloseFrameEditor = useCallback(() => {
    setStroEditingFrameIndex(null);
    void refreshStroPreviewFromDraft();
  }, [refreshStroPreviewFromDraft]);

  const handleStroBuildVideoPreview = useCallback(async () => {
    if (!stroMotionDraft) {
      alert('Generate StroMotion first.');
      return;
    }
    if (!stroVideoExportSupported) return;
    const ok = await buildStroVideoPreview();
    if (!ok) {
      alert('Video preview failed. Try again or download PNG instead.');
      return;
    }
    setStroPreviewModalOpen(true);
  }, [buildStroVideoPreview, stroMotionDraft, stroVideoExportSupported]);

  const handleStroDownloadVideo = useCallback(() => {
    const blob = stroPreviewVideoBlobRef.current;
    if (!blob) {
      alert('Build the video preview first.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stromotion-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  const stroMotionPanelEl = (
    <StroMotionPanel
      compact
      objectType={stroObjectType}
      onObjectTypeChange={handleStroObjectTypeChange}
      currentTime={stroVideoTime}
      startFrame={stroStartFrame}
      endFrame={stroEndFrame}
      onSetStartFrame={() => setStroStartFrame(Math.max(0, stroVideoTime))}
      onSetEndFrame={() => setStroEndFrame(Math.min(stroVideoDuration || stroVideoTime, Math.max(stroVideoTime, stroStartFrame + 0.04)))}
      frameCount={stroFrameCount}
      onFrameCountChange={setStroFrameCount}
      frames={stroFrameRows}
      activeFrameIndex={stroActiveFrameIndex}
      onSelectFrame={handleStroSelectFrame}
      onSelectArea={handleStroSelectArea}
      onEditFrame={handleStroEditFrame}
      onMarkReady={handleStroMarkReady}
      isSelectingArea={stroSelectingObject}
      selectingFrameIndex={stroSelectingFrameIndex}
      isProposingFrame={stroProposingFrame}
      proposingFrameIndex={stroProposingFrameIndex}
      isGenerating={stroGenerating}
      progressCurrent={stroMotionProgress.current}
      progressTotal={stroMotionProgress.total}
      readyCount={stroReadyCount}
      isPreviewReady={stroMotionStatus === 'ready' || !!stroPreviewPngUrl}
      videoExportSupported={stroVideoExportSupported}
      isExportingVideo={stroIsExportingVideo}
      onGenerate={() => void handleStroGenerate()}
      onClear={softClearStroMotion}
      previewPngUrl={stroPreviewPngUrl}
      previewVideoUrl={stroPreviewVideoUrl}
      isBuildingVideoPreview={stroIsBuildingVideoPreview}
      onDownloadPng={handleStroDownloadPng}
      onDownloadVideo={handleStroDownloadVideo}
      onBuildVideoPreview={() => { void handleStroBuildVideoPreview(); }}
      onOpenPreview={() => setStroPreviewModalOpen(true)}
      showSkeleton={stroShowSkeleton}
      onShowSkeletonChange={setStroShowSkeleton}
      precomputedSampleTimes={stroEffectiveSampleTimes}
      background={stroBackground}
      onBackgroundChange={setStroBackground}
      videoOrder={stroVideoOrder}
      onVideoOrderChange={setStroVideoOrder}
      disabled={!stroMotionHtml5Only}
      disabledReason={
        !stroMotionHtml5Only
          ? 'Stromotion requires an uploaded video file (not YouTube or embed links).'
          : undefined
      }
    />
  );

  const stroMotionFrameStopsForCanvas = useMemo(() => {
    if (!stroMotionActive || !stroMotionHtml5Only || !stroMotionDraft) return null;
    const activeIdx = stroActiveFrameIndex;
    const boxes = stroMotionDraft.frames
      .filter((f) => f.selectionBox)
      .map((f) => ({
        box: f.selectionBox!,
        active: f.index === activeIdx,
        autoDetected: false,
        userConfirmed: f.status === 'ready',
      }));
    return boxes.length > 0 ? boxes : null;
  }, [stroMotionActive, stroMotionHtml5Only, stroMotionDraft, stroActiveFrameIndex]);

  useEffect(() => {
    if (stroMotionActive && stroMotionHtml5Only) {
      void import('@/lib/racketCocoDetect').then((m) => m.preloadRacketDetector());
    }
  }, [stroMotionActive, stroMotionHtml5Only]);

  const seekBiomechVideo = useCallback(async (timeSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const dur = Number.isFinite(v.duration) ? v.duration : timeSec;
    const next = Math.max(0, Math.min(timeSec, dur));
    if (Math.abs(v.currentTime - next) > 0.00001 || v.seeking) {
      v.currentTime = next;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener('seeked', onSeeked);
          resolve();
        };
        v.addEventListener('seeked', onSeeked, { once: true });
        window.setTimeout(resolve, 120);
      });
    }
    setBiomechVideoTime(next);
    await canvasRef.current?.waitForRender?.();
  }, []);

  const handleBiomechSelectFrame = useCallback((index: number) => {
    const frame = aiMetricsDraft?.frames[index];
    const timeSec = frame?.timeSec ?? biomechEffectiveSampleTimes[index];
    if (timeSec === undefined) return;
    setBiomechActiveFrameIndex(index);
    void seekBiomechVideo(timeSec).then(() => {
      // Auto-stamp skeleton measurements if pose data is available
      const poseSample = frame?.poseSample ?? frame?.skeletonStamp ?? null;
      const kps = poseSample?.keypoints;
      if (!kps?.length) return;
      const video = videoRef.current;
      const nativeW = video?.videoWidth ?? 1280;
      const nativeH = video?.videoHeight ?? 720;
      canvasRef.current?.stampAutoMeasurements(kps, nativeW, nativeH);
    });
  }, [aiMetricsDraft, biomechEffectiveSampleTimes, seekBiomechVideo, setBiomechActiveFrameIndex, videoRef, canvasRef]);

  const handleBiomechProposeFrame = useCallback((index: number) => {
    const frame = aiMetricsDraft?.frames[index];
    const timeSec = frame?.timeSec ?? biomechEffectiveSampleTimes[index];
    if (timeSec === undefined) return;
    setBiomechActiveFrameIndex(index);
    void seekBiomechVideo(timeSec).then(() => {
      void proposeBiomechFrameMeasurements(index);
    });
  }, [aiMetricsDraft, biomechEffectiveSampleTimes, proposeBiomechFrameMeasurements, seekBiomechVideo, setBiomechActiveFrameIndex]);

  const handleBiomechMarkReady = useCallback((index: number) => {
    markBiomechFrameReady(index);
    invalidateBiomechReport();
    setBiomechFrameCards([]);
    setBiomechReportAnalysis(null);
  }, [invalidateBiomechReport, markBiomechFrameReady]);

  const handleBiomechGenerateReport = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !aiMetricsDraft) return;
    const analysis = generateBiomechReport();
    if (!analysis) return;

    setBiomechFrameCards([]);
    const cards: Array<{ id: string; label: string; timeSec: number; imageUrl: string }> = [];
    const snap = document.createElement('canvas');
    snap.width = video.videoWidth;
    snap.height = video.videoHeight;
    const sctx = snap.getContext('2d');

    for (const m of analysis.measurements) {
      await seekBiomechVideo(m.timeSec);
      if (sctx && video.videoWidth > 0) {
        try {
          sctx.drawImage(video, 0, 0, snap.width, snap.height);
          const imageUrl = renderMeasurementCard(snap, snap.width, snap.height, m);
          cards.push({ id: m.phaseId, label: m.phaseLabel, timeSec: m.timeSec, imageUrl });
        } catch { /* skip */ }
      }
    }

    setBiomechFrameCards(cards);
    setBiomechReportAnalysis(analysis);
    applyAIMetricsToDraft({
      strokeType: biomechStrokeType,
      trimStartSec: biomechTrimStart,
      trimEndSec: biomechTrimEnd,
      frameCards: cards,
      sampleTimes: biomechEffectiveSampleTimes,
      measurements: analysis,
    });
    setSessionDraftTitle(`${localDateTimeForFolder()} — AI Metrics`);
  }, [
    aiMetricsDraft,
    applyAIMetricsToDraft,
    biomechEffectiveSampleTimes,
    biomechStrokeType,
    biomechTrimEnd,
    biomechTrimStart,
    generateBiomechReport,
    seekBiomechVideo,
    setSessionDraftTitle,
  ]);

  const handleBiomechExportJson = useCallback(() => {
    if (!biomechReportAnalysis) return;
    const blob = new Blob([JSON.stringify(biomechReportAnalysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-metrics-${biomechStrokeType}-${Date.now()}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [biomechReportAnalysis, biomechStrokeType]);

  const [biomechSavingReport, setBiomechSavingReport] = useState(false);
  const [biomechReportPlayerPickerOpen, setBiomechReportPlayerPickerOpen] = useState(false);
  const [biomechReportPlayerList, setBiomechReportPlayerList] = useState<Array<{ id: string; display_name: string }>>([]);

  /** Opens the player picker; actual save happens in handleBiomechSaveReportToPlayer */
  const handleBiomechSaveReport = useCallback(async () => {
    if (!aiMetricsDraft || biomechSavingReport) return;
    try {
      const res = await fetch('/api/players');
      if (res.ok) {
        const body = await res.json() as { players?: Array<{ id: string; display_name: string }> };
        setBiomechReportPlayerList(body.players ?? []);
      }
    } catch { /* offline */ }
    setBiomechReportPlayerPickerOpen(true);
  }, [aiMetricsDraft, biomechSavingReport]);

  const handleBiomechSaveReportToPlayer = useCallback(async (playerId: string | null) => {
    if (!aiMetricsDraft) return;
    setBiomechReportPlayerPickerOpen(false);
    setBiomechSavingReport(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const userRes = await supabase?.auth.getUser();
      const userId = userRes?.data?.user?.id;

      // Upload captured frame images to Supabase Storage
      const screenshotUrls: string[] = [];
      if (supabase && userId) {
        for (const [idx, dataUrl] of Object.entries(biomechCapturedImages)) {
          const filename = `${userId}/reports/${Date.now()}-frame${idx}.png`;
          const path = await uploadDataUrl('analysis-screenshots', filename, dataUrl);
          if (path) {
            const { data: signed } = await supabase.storage.from('analysis-screenshots').createSignedUrl(path, 60 * 60 * 24 * 365);
            if (signed?.signedUrl) screenshotUrls.push(signed.signedUrl);
          }
        }
      }

      // Build report body text
      const bodyLines: string[] = [
        `**Stroke type:** ${biomechStrokeType}`,
        `**Frames analysed:** ${aiMetricsDraft.frames.length}`,
        '',
        ...aiMetricsDraft.frames.map((f, i) => {
          const notes = biomechFrameNotes[i] ?? '';
          const meas = biomechMeasurements[i];
          const checks = [
            meas?.footDirection ? '✓ Foot direction' : null,
            meas?.racketDirection ? '✓ Racket direction' : null,
            meas?.footDistance ? '✓ Foot distance' : null,
          ].filter(Boolean).join('  ');
          return `**${f.label}** @ ${f.timeSec.toFixed(2)}s${checks ? `  ${checks}` : ''}${notes ? `\n${notes}` : ''}`;
        }),
      ];

      const targetPlayerId = playerId ?? biomechReportPlayerList[0]?.id ?? null;
      if (targetPlayerId) {
        const res = await fetch(`/api/players/${targetPlayerId}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'technique',
            folder_label: `AI Metrics — ${localDateTimeForFolder()}`,
            body_text: bodyLines.join('\n'),
            screenshots: screenshotUrls,
            source: 'ai-metrics',
            metadata: { strokeType: biomechStrokeType, frameCount: aiMetricsDraft.frames.length },
          }),
        });
        if (!res.ok) {
          console.error('Failed to save report:', await res.text());
        }
      } else {
        // No player selected — download report as text file
        const blob = new Blob([bodyLines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        downloadDataURL(url, `ai-metrics-report-${Date.now()}.txt`);
        URL.revokeObjectURL(url);
      }
    } finally {
      setBiomechSavingReport(false);
    }
  }, [aiMetricsDraft, biomechCapturedImages, biomechFrameNotes, biomechMeasurements, biomechStrokeType, biomechReportPlayerList]);

  const resetBiomech = useCallback(() => {
    biomechClearingRef.current = true;
    clearBiomechAll();
    // Keep biomechActive=true so the draft re-initialises on next render and
    // "Add frame" works immediately after Clear without re-navigating.
    setBiomechFrameCards([]);
    setBiomechReportAnalysis(null);
    setBiomechSampleTimesOverride(null);
    setBiomechEditingFrameIndex(null);
    setBiomechCapturedImages({});
    setBiomechFrameNotes({});
    setBiomechMeasurements({});
    setBiomechPhaseMarkers(null);
    setBiomechSelectedPhaseId(null);
    setBiomechReportModalOpen(false);
  }, [clearBiomechAll]);

  /** Take a screenshot of the current video + canvas for a specific frame */
  const handleBiomechCaptureFrame = useCallback(async (frameIndex: number) => {
    const video = videoRef.current;
    const overlayCanvas = canvasRef.current?.getCanvas();
    if (!video) return;

    // Seek to this frame's time first
    const frame = aiMetricsDraft?.frames[frameIndex];
    if (frame) {
      await seekBiomechVideo(frame.timeSec);
      // Brief wait for frame to render
      await new Promise(r => setTimeout(r, 200));
    }

    try {
      let dataUrl: string;
      if (overlayCanvas) {
        dataUrl = captureFrame(video, overlayCanvas);
      } else {
        // Fallback: capture just the video frame
        const tmp = document.createElement('canvas');
        tmp.width = video.videoWidth || 640;
        tmp.height = video.videoHeight || 360;
        tmp.getContext('2d')?.drawImage(video, 0, 0);
        dataUrl = tmp.toDataURL('image/png');
      }
      setBiomechCapturedImages(prev => ({ ...prev, [frameIndex]: dataUrl }));
    } catch { /* ignore */ }
  }, [videoRef, canvasRef, aiMetricsDraft, seekBiomechVideo]);

  const handleBiomechUpdateFrameNotes = useCallback((frameIndex: number, notes: string) => {
    setBiomechFrameNotes(prev => ({ ...prev, [frameIndex]: notes }));
  }, []);

  const [screenshotSaving, setScreenshotSaving] = useState(false);
  const [screenshotPickerOpen, setScreenshotPickerOpen] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotPlayerList, setScreenshotPlayerList] = useState<Array<{ id: string; display_name: string }>>([]);

  /** Capture the current frame into state and open the player picker */
  const handleScreenshotSave = useCallback(async () => {
    if (screenshotSaving) return;
    setScreenshotSaving(true);
    try {
      const video = videoRef.current;
      const overlayCanvas = canvasRef.current?.getCanvas();
      if (!video) return;
      let dataUrl: string;
      if (overlayCanvas) {
        dataUrl = captureFrame(video, overlayCanvas);
      } else {
        const tmp = document.createElement('canvas');
        tmp.width = video.videoWidth || 640;
        tmp.height = video.videoHeight || 360;
        tmp.getContext('2d')?.drawImage(video, 0, 0);
        dataUrl = tmp.toDataURL('image/png');
      }
      setScreenshotDataUrl(dataUrl);
      // Fetch player list for picker
      try {
        const res = await fetch('/api/players');
        if (res.ok) {
          const body = await res.json() as { players?: Array<{ id: string; display_name: string }> };
          setScreenshotPlayerList(body.players ?? []);
        }
      } catch { /* offline — picker still shows download option */ }
      setScreenshotPickerOpen(true);
    } finally {
      setScreenshotSaving(false);
    }
  }, [screenshotSaving, videoRef, canvasRef]);

  const handleScreenshotDownload = useCallback((playerName?: string) => {
    if (!screenshotDataUrl) return;
    const prefix = playerName ? `${playerName.replace(/[^\w]+/g, '-')}-` : '';
    downloadDataURL(screenshotDataUrl, `${prefix}screenshot-${Date.now()}.png`);
    setScreenshotPickerOpen(false);
    setScreenshotDataUrl(null);
  }, [screenshotDataUrl]);

  const handleScreenshotSaveToPlayer = useCallback(async (playerId: string, playerName: string) => {
    if (!screenshotDataUrl) return;
    const supabase = createSupabaseBrowserClient();
    const userRes = await supabase?.auth.getUser();
    const userId = userRes?.data?.user?.id;
    if (!supabase || !userId) {
      // Fallback to download if not authenticated
      handleScreenshotDownload(playerName);
      return;
    }
    setScreenshotSaving(true);
    try {
      const filename = `${userId}/${Date.now()}.png`;
      const path = await uploadDataUrl('analysis-screenshots', filename, screenshotDataUrl);
      if (path) {
        const { data: signed } = await supabase.storage.from('analysis-screenshots').createSignedUrl(path, 60 * 60 * 24 * 365);
        const imageUrl = signed?.signedUrl ?? path;
        await fetch(`/api/players/${playerId}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'technique',
            folder_label: `Analysis ${localDateTimeForFolder()}`,
            body_text: 'Screenshot from analysis session.',
            screenshots: [imageUrl],
            source: 'analysis-screenshot',
          }),
        });
      }
      setScreenshotPickerOpen(false);
      setScreenshotDataUrl(null);
    } finally {
      setScreenshotSaving(false);
    }
  }, [screenshotDataUrl, handleScreenshotDownload]);

  /** Open report modal: requires at least one captured frame */
  const handleBiomechOpenReport = useCallback(() => {
    setBiomechReportModalOpen(true);
  }, []);

  /** Assemble the report frames for the modal */
  const biomechReportFrames = useMemo((): FrameMetricsReportFrame[] => {
    if (!aiMetricsDraft) return [];
    return aiMetricsDraft.frames
      .filter(f => !!biomechCapturedImages[f.index])
      .map(f => ({
        index: f.index,
        timeSec: f.timeSec,
        label: f.label,
        imageUrl: biomechCapturedImages[f.index]!,
        notes: biomechFrameNotes[f.index] ?? '',
      }));
  }, [aiMetricsDraft, biomechCapturedImages, biomechFrameNotes]);

  const biomechanicsPanelEl = (
    <BiomechanicsPanel
      compact
      currentTime={biomechVideoTime}
      duration={biomechVideoDuration}
      strokeType={biomechStrokeType}
      onStrokeTypeChange={setBiomechStrokeType}
      customSteps={biomechCustomSteps}
      onAddCustomStep={addBiomechCustomStep}
      onRenameCustomStep={renameBiomechCustomStep}
      onDeleteCustomStep={deleteBiomechCustomStep}
      onReorderCustomStep={reorderBiomechCustomStep}
      trimStartSec={biomechTrimStart}
      trimEndSec={biomechTrimEnd}
      onSetTrimStart={() => setBiomechTrimStart(Math.max(0, biomechVideoTime))}
      onSetTrimEnd={() =>
        setBiomechTrimEnd(
          Math.min(
            biomechVideoDuration || biomechVideoTime,
            Math.max(biomechVideoTime, biomechTrimStart + 0.04),
          ),
        )
      }
      frameCount={biomechFrameCount}
      onFrameCountChange={setBiomechFrameCount}
      sampleTimes={biomechEffectiveSampleTimes}
      frames={biomechFrameRows}
      activeFrameIndex={biomechActiveFrameIndex}
      onSelectFrame={handleBiomechSelectFrame}
      onProposeFrame={handleBiomechProposeFrame}
      onEditFrame={(index) => {
        setBiomechEditingFrameIndex(index);
        setBiomechActiveFrameIndex(index);
      }}
      onMarkReady={handleBiomechMarkReady}
      onRemoveFrame={removeBiomechFrame}
      onAddFrameAtCurrentTime={() => addBiomechFrame(biomechVideoTime)}
      onToggleFrameModule={updateBiomechFrameEnabledModule}
      onStampSkeleton={(frameIndex) => {
        const frame = aiMetricsDraft?.frames[frameIndex];
        if (frame?.poseSample) {
          setBiomechFrameSkeletonStamp(frameIndex, frame.poseSample);
        }
      }}
      onActivateTool={handleToolChange}
      onCaptureFrame={(frameIndex) => { void handleBiomechCaptureFrame(frameIndex); }}
      onUpdateFrameNotes={handleBiomechUpdateFrameNotes}
      onToggleMeasurement={(frameIndex, key, done) => {
        setBiomechMeasurements(prev => ({
          ...prev,
          [frameIndex]: { ...prev[frameIndex], [key]: done },
        }));
      }}
      isProposingFrame={biomechProposingFrame}
      proposingFrameIndex={biomechProposingFrameIndex}
      isGenerating={biomechGenerating}
      readyCount={biomechReadyCount}
      isReportReady={biomechReportFrames.length > 0}
      showSkeleton={biomechShowSkeleton}
      onShowSkeletonChange={setBiomechShowSkeleton}
      onGenerate={handleBiomechOpenReport}
      onSaveReport={() => { void handleBiomechSaveReport(); }}
      isSavingReport={biomechSavingReport}
      onClear={resetBiomech}
      frameCards={biomechFrameCards}
      onDownloadFrameCard={(url, label) => {
        downloadDataURL(url, `ai-metrics-${label.replace(/[^\w]+/g, '')}-${Date.now()}.png`);
      }}
      onExportMeasurements={handleBiomechExportJson}
      isProcessing={biomechProcessing}
      progress={biomechProgress}
      disabled={!biomechHtml5Only}
      disabledReason={
        !biomechHtml5Only
          ? 'AI Metrics requires an uploaded video file (not YouTube or embed links).'
          : undefined
      }
    />
  );

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
    if (el) {
      setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
    }
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
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const fn = () => setShowMobileToolStrip(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const TOOLBAR_EXPANDED_W = 240;
  const TOOLBAR_COLLAPSED_W = 60;
  const TOOLBAR_MOBILE_W = 60;
  const TOOLBAR_MOBILE_FIXED_W = 60;
  const TOOLBAR_COMPACT_EXPANDED_W = 196;
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

  const [toolbarLabelsExpanded, setToolbarLabelsExpanded] = useState(false);

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

  // ── Keyboard shortcuts (undo / redo) ──────────────────────────────────────
  useEffect(() => {
    const undoActiveCanvas = () => {
      if (markupTarget === 'both') {
        canvasRef.current?.undo();
        canvasRefB.current?.undo();
      } else if (markupTarget === 'B') {
        canvasRefB.current?.undo();
      } else {
        canvasRef.current?.undo();
      }
    };
    const redoActiveCanvas = () => {
      if (markupTarget === 'both') {
        canvasRef.current?.redo();
        canvasRefB.current?.redo();
      } else if (markupTarget === 'B') {
        canvasRefB.current?.redo();
      } else {
        canvasRef.current?.redo();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoActiveCanvas();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        redoActiveCanvas();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markupTarget]);

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

  const attemptHtml5Play = useCallback(async (target: 'A' | 'B' = 'A') => {
    const v = target === 'A' ? videoRef.current : videoRefB.current;
    const canvas = target === 'A' ? canvasRef.current : canvasRefB.current;
    if (!v?.currentSrc) return false;
    try {
      if (v.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error('Video failed to load'));
          };
          const cleanup = () => {
            v.removeEventListener('loadeddata', onReady);
            v.removeEventListener('error', onError);
          };
          v.addEventListener('loadeddata', onReady, { once: true });
          v.addEventListener('error', onError, { once: true });
          window.setTimeout(() => {
            cleanup();
            resolve();
          }, 4000);
        });
      }
      try {
        if (v.readyState >= 2 && v.currentTime === 0) v.currentTime = 0.001;
      } catch { /* noop */ }
      v.muted = true;
      await v.play();
      if (v.paused) throw new Error('Video remained paused after play()');
      setShowTapToPlay(false);
      await canvas?.waitForRender?.();
      return true;
    } catch (err: unknown) {
      console.warn('[CoachLab] HTML5 play failed:', err);
      setShowTapToPlay(true);
      return false;
    }
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
    stopAllTracks(hubAltStreamRef.current);
    hubAltStreamRef.current = null;
    setCaptureYoutubeBusy(false);
    setUrlLoadPhase(null);
    setUrlLoadError(null);
    setCaptureSaveModalOpen(false);
    urlLoadAbortRef.current?.abort();
    urlLoadAbortRef.current = null;
    // Clear any lingering recording UI so a "clean session" never leaves the
    // top Recording pill, countdown, step status, or download prompt behind.
    setIsRecording(false);
    setCaptureCountdown(null);
    setCaptureStepStatus(null);
    setScreenRecordDownloadPending(false);
    setRecordingSession(null);
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
    captureMp4ConversionGenRef.current += 1;
    setCaptureDownloadStatus('idle');
    setShowTapToPlay(false);
    setVideoLoadErrorA(null);
    setProcessingStatus(null);
    setVideoBLoaded(false);
    resetStroMotion();
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
  }, [cleanupVideoEl, resetStroMotion, revokeBlobUrl]);

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

  const requestCanvasPaintAfterVideoLoad = useCallback((target: 'A' | 'B') => {
    const v = target === 'A' ? videoRef.current : videoRefB.current;
    const canvas = target === 'A' ? canvasRef.current : canvasRefB.current;
    if (!v || !canvas) return;
    const paint = () => { void canvas.waitForRender?.(); };
    if (v.readyState >= 2 && v.videoWidth > 0) {
      paint();
      return;
    }
    v.addEventListener('loadeddata', paint, { once: true });
    v.addEventListener('seeked', paint, { once: true });
    v.addEventListener('error', paint, { once: true });
  }, []);

  const loadVideoFileIntoSlot = useCallback((
    file: File,
    target: 'A' | 'B',
  ) => {
    revokeBlobUrl(target === 'A' ? lastBlobUrlARef.current : lastBlobUrlBRef.current);
    const url = URL.createObjectURL(file);
    if (target === 'A') {
      lastBlobUrlARef.current = url;
      setVideoLoadErrorA(null);
      setVideoSrc(url);
      setYoutubeVideoIdA(null);
      setGenericEmbedSrcA(null);
      setShowTapToPlay(false);
      setProcessingStatus(null);
      resetStroMotion();
      canvasRef.current?.clearAll();
      resetToolAfterVideoLoad();
    } else {
      lastBlobUrlBRef.current = url;
      setVideoSrcB(url);
      setYoutubeVideoIdB(null);
      setGenericEmbedSrcB(null);
      setVideoBLoaded(false);
      canvasRefB.current?.clearAll();
      resetToolAfterVideoLoad();
    }
  }, [
    resetStroMotion,
    resetToolAfterVideoLoad,
    revokeBlobUrl,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    const paintFirstFrame = () => {
      requestCanvasPaintAfterVideoLoad('A');
      try {
        if (video.readyState >= 2 && video.currentTime === 0) video.currentTime = 0.001;
      } catch { /* noop */ }
      void canvasRef.current?.waitForRender?.();
    };

    const onLoaded = () => {
      setVideoLoadErrorA(null);
      setShowTapToPlay(false);
      paintFirstFrame();
    };

    const onError = () => {
      const code = video.error?.code;
      const message = code === MediaError.MEDIA_ERR_DECODE
        ? 'This video format is not supported. Try exporting as MP4 (H.264).'
        : 'Could not load this video file. Try a different MP4 or WebM.';
      setVideoLoadErrorA(message);
      setShowTapToPlay(false);
    };

    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError);
    if (video.readyState >= 2) onLoaded();

    return () => {
      video.removeEventListener('error', onError);
    };
  }, [requestCanvasPaintAfterVideoLoad, videoSrc, youtubeVideoIdA, genericEmbedSrcA]);

  useEffect(() => {
    const video = videoRefB.current;
    if (!video || !videoSrcB) return;

    const onLoaded = () => {
      requestCanvasPaintAfterVideoLoad('B');
      try {
        if (video.readyState >= 2 && video.currentTime === 0) video.currentTime = 0.001;
      } catch { /* noop */ }
      void canvasRefB.current?.waitForRender?.();
    };

    video.addEventListener('loadeddata', onLoaded, { once: true });
    if (video.readyState >= 2) onLoaded();

    return () => {
      video.removeEventListener('loadeddata', onLoaded);
    };
  }, [requestCanvasPaintAfterVideoLoad, videoSrcB]);

  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadVideoFileIntoSlot(file, 'A');
    e.target.value = '';
  }, [loadVideoFileIntoSlot]);

  const triggerVideoUploadA = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const triggerVideoUploadB = useCallback(() => {
    const input = fileInputRefB.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const handleVideoUploadB = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadVideoFileIntoSlot(file, 'B');
    e.target.value = '';
  }, [loadVideoFileIntoSlot]);

  /**
   * Direct-file handler for the RecordingHub Publer drop zone.
   * Mirrors handleVideoUpload / handleVideoUploadB but accepts a File object
   * directly (no synthetic input event) so the drop zone in RecordingHub
   * can hand the file straight here without rewriting the existing upload path.
   */
  const handleVideoFile = useCallback((file: File, target: 'A' | 'B') => {
    loadVideoFileIntoSlot(file, target);
  }, [loadVideoFileIntoSlot]);

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
    loadVideoFileIntoSlot(file, 'A');
  }, [loadVideoFileIntoSlot]);

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
    loadVideoFileIntoSlot(file, 'B');
  }, [loadVideoFileIntoSlot]);

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

    const bTarget = () => vA.currentTime;
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
      const t = bTarget();
      if (bInRange(t)) {
        vB.currentTime = t;
        vB.playbackRate = vA.playbackRate;
      } else if (t < 0) {
        vB.currentTime = 0;
      }
    };

    const onSeekedA = () => {
      const t = bTarget();
      if (bInRange(t)) {
        vB.currentTime = t;
        vB.playbackRate = vA.playbackRate;
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
    vA.addEventListener('seeked', onSeekedA);
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
      vA.removeEventListener('seeked', onSeekedA);
      vA.removeEventListener('ratechange', onRateA);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoBLoaded, videoBDuration, playBothEnabled, youtubeVideoIdA, genericEmbedSrcA]);

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
  const handleScreenshotEntireArea = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    downloadDataURL(canvas.toDataURL('image/png'), `coach-lab-screenshot-${Date.now()}.png`);
  }, []);

  const handleScreenshotSelectArea = useCallback((region: ViewportRegion) => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ix = Math.max(region.x, rect.left);
    const iy = Math.max(region.y, rect.top);
    const ix2 = Math.min(region.x + region.w, rect.right);
    const iy2 = Math.min(region.y + region.h, rect.bottom);
    if (ix2 <= ix || iy2 <= iy) return;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = (ix - rect.left) * scaleX;
    const sy = (iy - rect.top) * scaleY;
    const sw = (ix2 - ix) * scaleX;
    const sh = (iy2 - iy) * scaleY;

    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(sw));
    crop.height = Math.max(1, Math.round(sh));
    crop.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    downloadDataURL(crop.toDataURL('image/png'), `coach-lab-screenshot-${Date.now()}.png`);
  }, []);

  const handleScreenRecordComplete = useCallback((blob: Blob, ext: string) => {
    setRecordingSession({
      videoBlob: blob,
      ext,
      cropRegion: null,
    });
  }, []);

  const handleResetRecordingSettings = useCallback(() => {
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
    setRecordingSession((s) => (s ? { ...s, cropRegion: null } : s));
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
    setVideoLoadErrorA(null);
    sessionCaptureBlobRef.current = null;
    sessionMp4BlobRef.current = null;
    setCaptureDownloadStatus('idle');
    cleanupVideoEl(videoRef.current);
    canvasRef.current?.clearAll();
    setCaptureError(null);
  }, [cleanupVideoEl, revokeBlobUrl]);

  const handleAddVideoB = useCallback(() => {
    setUrlTarget('B');
    triggerVideoUploadB();
  }, [triggerVideoUploadB]);

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
    try {
      const count = await canvasRef.current?.runObjMultiplierCapture(
        objMultiplierFrameCount,
        (done, total) => setObjMultiplierProgress(`Capturing ${done}/${total}…`),
      );
      setObjMultiplierProgress(count ? `${count} frames captured` : null);
    } catch {
      setObjMultiplierProgress(null);
      alert('Object multiplier capture failed. Try again.');
    }
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
    resetStroMotion();
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
  }, [applyVideoStream, cleanupVideoEl, resetStroMotion, revokeBlobUrl, urlInput, urlTarget, videoBDuration]);

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
    softClearStroMotion();
    resetBiomech();
  }, [applyMarkupToTargets, softClearStroMotion, resetBiomech]);

  useEffect(() => {
    if (!hasVideoBContent) {
      setMarkupTarget('A');
      return;
    }
    if (playbackTarget === 'B') setMarkupTarget('B');
    else if (playbackTarget === 'A') setMarkupTarget('A');
  }, [playbackTarget, hasVideoBContent]);

  const syncCompanionBeforePlay = useCallback(() => {
    if (!playBothEnabled) return;
    const vA = videoRef.current;
    const vB = videoRefB.current;
    if (!vA || !vB || !videoBLoaded) return;
    const t = vA.currentTime;
    if (t >= 0 && t <= videoBDuration) {
      vB.playbackRate = vA.playbackRate;
      vB.currentTime = t;
      if (vB.paused) void vB.play().catch(() => {});
    } else if (t < 0) {
      vB.currentTime = 0;
      if (!vB.paused) vB.pause();
    }
  }, [playBothEnabled, videoBLoaded, videoBDuration]);

  const syncCompanionBeforePause = useCallback(() => {
    if (!playBothEnabled) return;
    const vA = videoRef.current;
    const vB = videoRefB.current;
    if (!vA || !vB || !videoBLoaded) return;
    const t = vA.currentTime;
    if (t >= 0 && t <= videoBDuration) {
      vB.currentTime = t;
      vB.playbackRate = vA.playbackRate;
    } else if (t < 0) {
      vB.currentTime = 0;
    }
    if (!vB.paused) vB.pause();
  }, [playBothEnabled, videoBLoaded, videoBDuration]);

  const analysisTimelineExtras = useMemo(() => {
    const biomechSampleMarkers = biomechActive && biomechHtml5Only
      ? (aiMetricsDraft?.frames.length
          ? aiMetricsDraft.frames.map((f) => ({
              id: `biomech-frame-${f.index}`,
              time: f.timeSec,
              label: String(f.index + 1),
            }))
          : biomechEffectiveSampleTimes.map((time, i) => ({
              id: `biomech-frame-${i}`,
              time,
              label: String(i + 1),
            })))
      : null;

    const stroFrameStopMarkers = stroMotionActive && stroMotionHtml5Only
      ? (stroMotionDraft?.frames.length
          ? stroMotionDraft.frames.map((f) => ({
              id: `stro-stop-${f.index}`,
              time: f.timeSec,
              label: String(f.index + 1),
            }))
          : stroEffectiveSampleTimes.map((time, i) => ({
              id: `stro-stop-${i}`,
              time,
              label: String(i + 1),
            })))
      : null;

    if (biomechActive && biomechHtml5Only) {
      return {
        trimRange: { start: biomechTrimStart, end: biomechTrimEnd } as { start: number; end: number },
        trimAccent: '#34C759',
        onCurrentTime: setBiomechVideoTime,
        phaseMarkers: biomechPhaseMarkers,
        selectedPhaseMarkerId: biomechSelectedPhaseId,
        onPhaseMarkerSelect: (id: string) => setBiomechSelectedPhaseId(id),
        onPhaseMarkerChange: (id: string, time: number) => {
          setBiomechPhaseMarkers(prev => prev?.map(m => m.id === id ? { ...m, time } : m) ?? null);
        },
        phaseMarkerBounds: { start: biomechTrimStart, end: biomechTrimEnd },
        sampleMarkers: biomechSampleMarkers,
        onSampleMarkerSelect: (_id: string, time: number) => {
          const idx = Number(_id.replace('biomech-frame-', ''));
          setBiomechVideoTime(time);
          if (Number.isFinite(idx)) setBiomechActiveFrameIndex(idx);
          void seekBiomechVideo(time);
        },
        onSampleMarkerChange: (id: string, time: number) => {
          const idx = Number(id.replace('biomech-frame-', ''));
          if (!Number.isFinite(idx)) return;
          setBiomechSampleTimesOverride((prev) => {
            const base = prev ?? [...biomechEffectiveSampleTimes];
            const next = [...base];
            if (idx >= 0 && idx < next.length) next[idx] = time;
            return enforceMonotonicSampleTimes(next, biomechTrimStart, biomechTrimEnd);
          });
          updateBiomechFrameTime(idx, time);
          setBiomechActiveFrameIndex(idx);
          setBiomechVideoTime(time);
          void seekBiomechVideo(time);
        },
        sampleMarkerBounds: { start: biomechTrimStart, end: biomechTrimEnd },
        defaultZoomToTrim: true,
      };
    }
    if (stroMotionActive && stroMotionHtml5Only) {
      return {
        trimRange: { start: stroStartFrame, end: stroEndFrame } as { start: number; end: number },
        trimAccent: '#FF9500',
        onCurrentTime: setStroVideoTime,
        phaseMarkers: null as null,
        selectedPhaseMarkerId: null as null,
        onPhaseMarkerSelect: undefined,
        onPhaseMarkerChange: undefined,
        phaseMarkerBounds: null as null,
        sampleMarkers: stroFrameStopMarkers,
        onSampleMarkerSelect: (_id: string, time: number) => {
          const idx = Number(_id.replace('stro-stop-', ''));
          setStroVideoTime(time);
          if (Number.isFinite(idx)) setStroActiveFrameIndex(idx);
          void seekStroVideo(time);
        },
        onSampleMarkerChange: (id: string, time: number) => {
          const idx = Number(id.replace('stro-stop-', ''));
          if (!Number.isFinite(idx)) return;
          setStroSampleTimesOverride((prev) => {
            const base = prev ?? [...stroEffectiveSampleTimes];
            const next = [...base];
            if (idx >= 0 && idx < next.length) next[idx] = time;
            return enforceMonotonicSampleTimes(next, stroStartFrame, stroEndFrame);
          });
          updateStroFrameTime(idx, time);
          setStroActiveFrameIndex(idx);
          setStroVideoTime(time);
          void seekStroVideo(time);
        },
        sampleMarkerBounds: { start: stroStartFrame, end: stroEndFrame },
        defaultZoomToTrim: true,
      };
    }
    return {
      trimRange: null as null,
      trimAccent: '#FF9500',
      onCurrentTime: undefined as undefined,
      phaseMarkers: null as null,
      selectedPhaseMarkerId: null as null,
      onPhaseMarkerSelect: undefined,
      onPhaseMarkerChange: undefined,
      phaseMarkerBounds: null as null,
      sampleMarkers: null as null,
      onSampleMarkerSelect: undefined,
      onSampleMarkerChange: undefined,
      sampleMarkerBounds: null as null,
      defaultZoomToTrim: false,
    };
  }, [
    biomechActive,
    biomechHtml5Only,
    biomechTrimStart,
    biomechTrimEnd,
    aiMetricsDraft,
    biomechEffectiveSampleTimes,
    seekBiomechVideo,
    updateBiomechFrameTime,
    setBiomechActiveFrameIndex,
    stroMotionActive,
    stroMotionHtml5Only,
    stroMotionDraft,
    stroStartFrame,
    stroEndFrame,
    stroEffectiveSampleTimes,
    seekStroVideo,
    updateStroFrameTime,
    setStroActiveFrameIndex,
  ]);

  const renderTimelineDock = () => (
    <div style={{ width: '100%', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 8, minHeight: isMobile ? 108 : 120 }}>
      {!(capturePrepPanel || (captureBusy && embedCaptureRecording)) && (hasVideoBContent ? (
        playbackTarget === 'B'
          ? (videoSrcB || youtubeVideoIdB || genericEmbedSrcB) && (
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
                onPlayBlocked={handlePlayBlocked}
              />
            )
          : (videoSrc || youtubeVideoIdA || genericEmbedSrcA) && (
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
                beforePlay={playBothEnabled ? syncCompanionBeforePlay : undefined}
                beforePause={playBothEnabled ? syncCompanionBeforePause : undefined}
                onPlayBlocked={handlePlayBlocked}
                trimRange={analysisTimelineExtras.trimRange}
                trimAccent={analysisTimelineExtras.trimAccent}
                onCurrentTime={analysisTimelineExtras.onCurrentTime}
                phaseMarkers={analysisTimelineExtras.phaseMarkers}
                selectedPhaseMarkerId={analysisTimelineExtras.selectedPhaseMarkerId}
                onPhaseMarkerSelect={analysisTimelineExtras.onPhaseMarkerSelect}
                onPhaseMarkerChange={analysisTimelineExtras.onPhaseMarkerChange}
                phaseMarkerBounds={analysisTimelineExtras.phaseMarkerBounds}
                sampleMarkers={analysisTimelineExtras.sampleMarkers}
                onSampleMarkerSelect={analysisTimelineExtras.onSampleMarkerSelect}
                onSampleMarkerChange={analysisTimelineExtras.onSampleMarkerChange}
                sampleMarkerBounds={analysisTimelineExtras.sampleMarkerBounds}
                defaultZoomToTrim={analysisTimelineExtras.defaultZoomToTrim}
              />
            )
      ) : (
        hasVideoAContent && (
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
            beforePlay={playBothEnabled ? syncCompanionBeforePlay : undefined}
            beforePause={playBothEnabled ? syncCompanionBeforePause : undefined}
            onPlayBlocked={handlePlayBlocked}
            trimRange={analysisTimelineExtras.trimRange}
            trimAccent={analysisTimelineExtras.trimAccent}
            onCurrentTime={analysisTimelineExtras.onCurrentTime}
            phaseMarkers={analysisTimelineExtras.phaseMarkers}
            selectedPhaseMarkerId={analysisTimelineExtras.selectedPhaseMarkerId}
            onPhaseMarkerSelect={analysisTimelineExtras.onPhaseMarkerSelect}
            onPhaseMarkerChange={analysisTimelineExtras.onPhaseMarkerChange}
            phaseMarkerBounds={analysisTimelineExtras.phaseMarkerBounds}
            sampleMarkers={analysisTimelineExtras.sampleMarkers}
            onSampleMarkerSelect={analysisTimelineExtras.onSampleMarkerSelect}
            onSampleMarkerChange={analysisTimelineExtras.onSampleMarkerChange}
            sampleMarkerBounds={analysisTimelineExtras.sampleMarkerBounds}
            defaultZoomToTrim={analysisTimelineExtras.defaultZoomToTrim}
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
    stroMotionPanel: stroMotionPanelEl,
    biomechanicsPanel: biomechanicsPanelEl,
    authContent: <AuthButton iconOnly={compactToolbarRail} />,
    onNavigate: (screen) => {
      if (screen === 'stromotion') {
        setStroMotionActive(true);
        setBiomechActive(false);
      } else if (screen === 'aimetrics') {
        setBiomechActive(true);
        setStroMotionActive(false);
      } else if (screen === 'skeleton') {
        // Activate skeleton tool + un-pause overlay so pose runs and is visible
        handleToolChange('skeleton');
        setSkeletonOverlayPaused(false);
      } else if (screen === 'home') {
        setStroMotionActive(false);
        setBiomechActive(false);
      }
    },
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
    onScreenshotSave:                () => { void handleScreenshotSave(); },
    screenshotSaving,
    onSaveReport:                    () => setSessionSaveModalOpen(true),
    saveReportEnabled:               sessionDraftHasContent,
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
        onScreenshotEntireArea={handleScreenshotEntireArea}
        onScreenshotSelectArea={handleScreenshotSelectArea}
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
        hubIconOnly={isMobile || (compactToolbarRail && !toolbarLabelsExpanded)}
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

  /** Uploaded MP4/WebM — native <video> shows frames; canvas composites StroMotion layers when masks exist. */
  const html5FileUpload = Boolean(videoSrc && !youtubeVideoIdA && !genericEmbedSrcA);
  const stroDraftPreviewActive = Boolean(
    stroMotionActive &&
    stroMotionHtml5Only &&
    stroMotionDraft &&
    countFramesWithPreviewMask(stroMotionDraft.frames) > 0 &&
    !stroSelectingObject &&
    stroEditingFrameIndex === null,
  );
  const stroCompositeActive = stroDraftPreviewActive;
  const useNativeHtml5Video = html5FileUpload && !stroCompositeActive;
  const paintVideoOnCanvasA = Boolean(
    (html5FileUpload && stroCompositeActive) ||
    (embedLiveVideoA && (!!youtubeVideoIdA || !!genericEmbedSrcA)),
  );
  const html5VideoStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    zIndex: useNativeHtml5Video ? 1 : 0,
    transform: 'translateZ(0)',
    WebkitTransform: 'translateZ(0)',
  };

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
          background: '#FFFFFF',
          borderRight: '1px solid #D1D1D6',
          boxShadow: 'none',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: isMobile ? '4px 4px' : '6px 4px',
          }}
        >
          <ToolPalette {...paletteProps} />
        </div>
      </aside>
    );
  };

  return (
    <div
      className="coachlab-analysis-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        minHeight: 0,
        overflow: 'hidden',
        background: '#FFFFFF',
        color: '#1A1A1A',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >

      {/* ── Hidden decoders — slot B + webcam; slot A video lives in the panel ── */}
      <video
        ref={videoRefB}
        src={videoSrcB ?? undefined}
        crossOrigin={videoSrcB?.startsWith('/api/') ? 'anonymous' : undefined}
        playsInline
        muted
        preload="auto"
        style={hiddenDecoderVideoStyle}
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
          {contextPlayerId ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 14px',
                background: 'rgba(0,122,255,0.12)',
                borderBottom: '1px solid rgba(0,122,255,0.25)',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                Session for {contextPlayerName ?? 'player'}
                {contextSessionId ? (
                  <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.75, fontSize: 11 }}>
                    (draft)
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/players/${contextPlayerId}`)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View player
              </button>
            </div>
          ) : null}
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
                flex: layoutMode === 'reels' ? '1 1 0' : 1,
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
                {/* In-panel decoder — visible for uploads; canvas composites embeds / StroMotion */}
                <video
                  ref={videoRef}
                  src={videoSrc ?? undefined}
                  crossOrigin={videoSrc?.startsWith('/api/') ? 'anonymous' : undefined}
                  playsInline
                  muted
                  preload="auto"
                  style={html5VideoStyle}
                />
                <CanvasOverlay
                  ref={canvasRef}
                  videoRef={videoRef}
                  webcamVideoRef={webcamVideoRef}
                  renderVideo={paintVideoOnCanvasA}
                  nativeVideoUnderlay={useNativeHtml5Video}
                  transparentWhenNoVideo={
                    useNativeHtml5Video ||
                    (!paintVideoOnCanvasA &&
                      (!hasVideoAContent ||
                        ((!!youtubeVideoIdA || !!genericEmbedSrcA) && !embedLiveVideoA)))
                  }
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
                  stroMotionResult={null}
                  stroMotionDraft={stroMotionDraft}
                  stroMotionCanvasPreview={stroDraftPreviewActive}
                  stroMotionUseExportMasks={stroAllFramesExportReady || stroMotionStatus === 'ready'}
                  stroMotionBackground={stroBackground}
                  stroMotionVideoOrder={stroVideoOrder}
                  stroMotionEndPlate={stroEndPlate}
                  stroMotionSubjectBox={null}
                  stroMotionFrameStops={stroMotionFrameStopsForCanvas}
                  stroMotionVisibleCount={stroVisibleCount}
                  stroMotionShowSkeleton={stroShowSkeleton}
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
                  videoSourceKey={videoSrc}
                />
                {activeTool === 'ruler' && (
                  <RulerOverlay
                    containerWidth={canvasSize.width}
                    containerHeight={canvasSize.height}
                    onClose={() => setActiveTool('select')}
                  />
                )}
                {!(videoSrc || youtubeVideoIdA || genericEmbedSrcA) ? (
                  urlLoadPhase && urlTarget === 'A' ? (
                    <div style={{
                      position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 16,
                      pointerEvents: 'none',
                      zIndex: 10,
                      background: 'transparent',
                    }}>
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 16, borderRadius: layoutMode === 'reels' ? 0 : 20,
                        background: layoutMode === 'reels' ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.96)',
                        padding: 24, pointerEvents: 'none',
                      }}>
                      <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="20" cy="20" r="16" fill="none" stroke="#007AFF" strokeWidth="3" strokeDasharray="75" strokeDashoffset="20" strokeLinecap="round" />
                      </svg>
                      <span style={{ fontSize: 15, fontWeight: 500, color: layoutMode === 'reels' ? '#fff' : '#1A1A1A', textAlign: 'center', maxWidth: 280 }}>
                        {urlLoadPhase}
                      </span>
                      </div>
                    </div>
                  ) : urlLoadError && urlTarget === 'A' ? (
                    <div style={{
                      position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 14,
                      pointerEvents: 'none',
                      zIndex: 10,
                      background: 'transparent',
                    }}>
                      <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        gap: 14,
                        borderRadius: layoutMode === 'reels' ? 0 : 20,
                        background: layoutMode === 'reels' ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.96)',
                        padding: 24,
                        pointerEvents: 'none',
                      }}>
                      <div style={{ fontSize: 14, color: '#CC3333', textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
                        {urlLoadError}
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          onClick={() => { setUrlLoadError(null); handleUrlSubmit(); }}
                          style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', pointerEvents: 'auto' }}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => { setUrlLoadError(null); triggerVideoUploadA(); }}
                          style={{ padding: '8px 20px', borderRadius: 10, border: '1px solid #E5E5E5', background: '#fff', color: '#1A1A1A', fontSize: 14, fontWeight: 500, cursor: 'pointer', pointerEvents: 'auto' }}
                        >
                          Upload instead
                        </button>
                      </div>
                      </div>
                    </div>
                  ) : (
                  <div style={{
                    position: 'absolute', inset: layoutMode === 'reels' ? 0 : 16,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                    zIndex: 120,
                    background: 'transparent',
                  }}>
                    {webcamActive ? (
                      <button
                        type="button"
                        data-tour-id="tour-upload"
                        onClick={triggerVideoUploadA}
                        style={{
                          position: 'absolute',
                          top: layoutMode === 'reels' ? 12 : 0,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          minHeight: 40,
                          padding: '0 16px',
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          pointerEvents: 'auto',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                        }}
                      >
                        <Upload size={16} /> Upload Video
                      </button>
                    ) : (
                    <div style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 16,
                      borderRadius: layoutMode === 'reels' ? 0 : 20,
                      border: layoutMode === 'reels' ? 'none' : '1px solid #E8E8ED',
                      background: layoutMode === 'reels' ? 'rgba(0,0,0,0.72)' : '#FAFAFA',
                      padding: 24,
                      pointerEvents: 'none',
                      maxWidth: 420,
                    }}>
                    <button
                      type="button"
                      data-tour-id="tour-upload"
                      onClick={triggerVideoUploadA}
                      style={{
                        minHeight: 52,
                        minWidth: 200,
                        padding: '0 24px',
                        borderRadius: 14,
                        border: '1px solid #E5E5E5',
                        background: '#FFFFFF',
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        pointerEvents: 'auto',
                      }}
                    >
                      <Upload size={20} /> Upload Video
                    </button>
                    <span style={{ fontSize: 12, color: layoutMode === 'reels' ? 'rgba(255,255,255,0.45)' : '#8e8e93', textAlign: 'center', maxWidth: 320 }}>
                      or drag and drop a video file here. See Coach Lab Academy in the Control Panel for import workflows.
                    </span>
                    </div>
                    )}
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
                      onUploadInstead={triggerVideoUploadA}
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
                {videoLoadErrorA ? (
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.72)',
                      zIndex: 130,
                      padding: 24,
                    }}
                  >
                    <div style={{
                      maxWidth: 320,
                      textAlign: 'center',
                      color: '#fff',
                      fontSize: 14,
                      lineHeight: 1.5,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}>
                      <div>{videoLoadErrorA}</div>
                      <button
                        type="button"
                        onClick={triggerVideoUploadA}
                        style={{
                          padding: '10px 18px',
                          borderRadius: 10,
                          border: 'none',
                          background: '#007AFF',
                          color: '#fff',
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Try another file
                      </button>
                    </div>
                  </div>
                ) : null}
                {showTapToPlay && videoSrc && !videoLoadErrorA ? (
                  <div
                    role="button"
                    aria-label="Tap to play video"
                    style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.55)',
                      zIndex: 130,
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void attemptHtml5Play('A');
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
                ) : null}
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
                  flex: layoutMode === 'reels' ? '1 1 0' : 1,
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
                      videoSourceKey={videoSrcB}
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
                      onUploadInstead={triggerVideoUploadB}
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
                minHeight: isMobile ? 108 : 120,
                boxSizing: 'border-box',
              }}
            >
              {renderTimelineDock()}
            </div>
          </div>

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

      {stroEditingFrameIndex !== null && stroMotionDraft ? (() => {
        const frame = stroMotionDraft.frames[stroEditingFrameIndex];
        const isProposingThisFrame =
          stroProposingFrame && stroProposingFrameIndex === stroEditingFrameIndex;
        const workingMask = frame?.working ?? frame?.aiSnapshot ?? frame?.readyMask ?? null;

        if (isProposingThisFrame || !frame?.sourceFrame || !workingMask) {
          return (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10050,
                background: 'rgba(0,0,0,0.78)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              <div
                style={{
                  width: 'min(480px, 100%)',
                  background: '#1c1c1e',
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.12)',
                  padding: 24,
                  color: '#fff',
                  textAlign: 'center',
                }}
              >
                <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
                  {isProposingThisFrame ? 'Removing background…' : 'Preparing frame…'}
                </strong>
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                  {isProposingThisFrame
                    ? 'Auto background removal runs on the selected area. The editor opens when ready.'
                    : 'If this takes more than a few seconds, close and try Select Area again.'}
                </p>
                <button
                  type="button"
                  onClick={handleStroCloseFrameEditor}
                  style={{
                    marginTop: 16,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }

        return (
          <FrameMaskEditor
            key={frame.index}
            sourceFrame={frame.sourceFrame}
            mask={workingMask}
            frameLabel={frame.label}
            frameIndex={frame.index}
            frameTotal={stroMotionDraft.frames.length}
            frameStatus={frame.status}
            proposalEmpty={!maskHasContent(frame.aiSnapshot) && !maskHasContent(frame.working)}
            backgroundPlate={stroMotionDraft.backgroundPlate}
            selectionBox={frame.selectionBox}
            onMaskChange={(mask) => updateFrameMask(frame.index, mask)}
            onReset={() => resetFrameMask(frame.index)}
            onRegenerate={() => {
              void reproposeFrameMask(frame.index).then(() => {
                void canvasRef.current?.waitForRender?.();
              });
            }}
            onMarkReady={() => {
              if (!handleStroMarkReady(frame.index)) return;
              void canvasRef.current?.waitForRender?.();
            }}
            onMarkReadyAndNext={() => {
              handleStroMarkReadyAndNext(frame.index);
              void canvasRef.current?.waitForRender?.();
            }}
            onClose={handleStroCloseFrameEditor}
            isRegenerating={stroProposingFrame && stroProposingFrameIndex === frame.index}
          />
        );
      })() : null}

      <StroMotionPreviewModal
        open={stroPreviewModalOpen}
        onClose={() => {
          setStroPreviewModalOpen(false);
          setStroPreviewError(null);
        }}
        pngUrl={stroPreviewPngUrl}
        videoUrl={stroPreviewVideoUrl}
        videoExportSupported={stroVideoExportSupported}
        isGenerating={stroGenerating}
        isBuildingVideo={stroIsBuildingVideoPreview}
        errorMessage={stroPreviewError}
        onBuildVideo={() => { void handleStroBuildVideoPreview(); }}
        onDownloadPng={handleStroDownloadPng}
        onDownloadVideo={handleStroDownloadVideo}
      />

      {/* ── Screenshot player picker ─────────────────────────────────── */}
      {screenshotPickerOpen && screenshotDataUrl && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => { setScreenshotPickerOpen(false); setScreenshotDataUrl(null); }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 18, padding: 24,
              width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1D1D1F' }}>Save Screenshot</span>
              <button
                type="button"
                onClick={() => { setScreenshotPickerOpen(false); setScreenshotDataUrl(null); }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6E6E73', lineHeight: 1 }}
              >×</button>
            </div>
            <img src={screenshotDataUrl} alt="Screenshot preview" style={{ width: '100%', borderRadius: 10, objectFit: 'cover', maxHeight: 180 }} />
            <p style={{ margin: 0, fontSize: 13, color: '#6E6E73' }}>
              {screenshotPlayerList.length > 0 ? 'Save to a player\'s docs or download directly.' : 'No players found — download directly.'}
            </p>
            {screenshotPlayerList.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                {screenshotPlayerList.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={screenshotSaving}
                    onClick={() => { void handleScreenshotSaveToPlayer(p.id, p.display_name); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 10,
                      border: '1px solid #E5E5EA', background: '#F9F9F9',
                      color: '#1D1D1F', fontSize: 13, fontWeight: 500,
                      cursor: screenshotSaving ? 'not-allowed' : 'pointer', textAlign: 'left',
                      opacity: screenshotSaving ? 0.6 : 1,
                    }}
                  >
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#007AFF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {p.display_name.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1 }}>{p.display_name}</span>
                    <span style={{ fontSize: 11, color: '#6E6E73' }}>→ save to docs</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => handleScreenshotDownload()}
              style={{
                padding: '10px 0', borderRadius: 10,
                border: '1px solid #D1D1D6', background: '#F2F2F7',
                color: '#1D1D1F', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Download without player
            </button>
          </div>
        </div>,
        document.body,
      )}

      <FrameMetricsReportModal
        open={biomechReportModalOpen}
        onClose={() => setBiomechReportModalOpen(false)}
        frames={biomechReportFrames}
        onSaveToDoc={async (framesWithNotes) => {
          framesWithNotes.forEach(f => {
            setBiomechFrameNotes(prev => ({ ...prev, [f.index]: f.notes }));
          });
          await handleBiomechSaveReport();
        }}
        isSaving={biomechSavingReport}
      />

      {/* Report player picker modal */}
      {biomechReportPlayerPickerOpen && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setBiomechReportPlayerPickerOpen(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: 18, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 14 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1D1D1F' }}>Save Report to Player</span>
              <button type="button" onClick={() => setBiomechReportPlayerPickerOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6E6E73' }}>×</button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#6E6E73' }}>
              {biomechReportPlayerList.length > 0 ? 'Choose which player\'s docs to save this AI Metrics report into.' : 'No players found — create one first in the Players section.'}
            </p>
            {biomechReportPlayerList.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {biomechReportPlayerList.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { void handleBiomechSaveReportToPlayer(p.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid #E5E5EA', background: '#F9F9F9', color: '#1D1D1F', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#5856D6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {p.display_name.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1 }}>{p.display_name}</span>
                    <span style={{ fontSize: 11, color: '#6E6E73' }}>→ docs</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => { void handleBiomechSaveReportToPlayer(null); }}
              style={{ padding: '10px 0', borderRadius: 10, border: '1px solid #D1D1D6', background: '#F2F2F7', color: '#1D1D1F', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Save without player
            </button>
          </div>
        </div>,
        document.body,
      )}

      {biomechEditingFrameIndex !== null && aiMetricsDraft ? (() => {
        const frame = aiMetricsDraft.frames[biomechEditingFrameIndex];
        const working = frame ? getWorkingMeasurements(frame) : null;
        if (!frame || !working) return null;
        return (
          <FrameMeasurementEditor
            key={frame.index}
            frameLabel={frame.label}
            timeSec={frame.timeSec}
            frameStatus={frame.status}
            measurements={working}
            enabledModules={biomechEnabledModules}
            onMeasurementsChange={(m) => updateBiomechFrameMeasurements(frame.index, m)}
            onReset={() => resetBiomechFrameMeasurements(frame.index)}
            onRepropose={() => {
              void reproposeBiomechFrameMeasurements(frame.index);
            }}
            onMarkReady={() => {
              markBiomechFrameReady(frame.index);
              invalidateBiomechReport();
              setBiomechFrameCards([]);
              setBiomechReportAnalysis(null);
            }}
            onClose={() => setBiomechEditingFrameIndex(null)}
            isReproposing={biomechProposingFrame && biomechProposingFrameIndex === frame.index}
          />
        );
      })() : null}

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

      <SaveSessionModal
        open={sessionSaveModalOpen}
        onClose={() => setSessionSaveModalOpen(false)}
        draft={sessionDraft}
        defaultTitle={sessionDraft.title || `${localDateTimeForFolder()} — Analysis`}
        fixedPlayerId={contextPlayerId ?? undefined}
        fixedPlayerName={contextPlayerName ?? undefined}
        existingSessionId={contextSessionId ?? undefined}
        onSaved={(_sessionId, playerId) => {
          resetSessionDraft();
          router.push(`/players/${playerId}`);
        }}
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
            top: `calc(env(safe-area-inset-top, 0px) + 12px + ${isRecording ? 52 : 0}px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 240,
            maxWidth: 'min(480px, calc(100vw - 24px))',
            padding: stroSelectingObject ? '10px 12px 10px 16px' : '10px 16px',
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
            pointerEvents: stroSelectingObject ? 'auto' : 'none',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>
            {stroMotionProcessing
              ? stroProposingFrame
                ? `StroMotion: proposing mask… ${stroMotionProgress.current} / ${stroMotionProgress.total}`
                : stroGenerating
                  ? 'StroMotion: generating composite…'
                  : processingStatus
              : processingStatus}
          </span>
          {stroSelectingObject ? (
            <button
              type="button"
              onClick={() => {
                canvasRef.current?.cancelStroMotionRegionSelect?.();
              }}
              style={{
                flexShrink: 0,
                padding: '4px 10px',
                borderRadius: 7,
                border: '1px solid #D1D1D6',
                background: 'transparent',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#1A1A1A',
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      )}

      {recordingSession?.videoBlob &&
        typeof document !== 'undefined' &&
        createPortal(
          <PostRecordingCropModal
            blob={recordingSession.videoBlob}
            ext={recordingSession.ext}
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

export default function AnalysisPage() {
  return (
    <React.Suspense fallback={null}>
      <Home />
    </React.Suspense>
  );
}
