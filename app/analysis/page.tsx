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
const RecordingHubContent = React.lazy(() => import('@/components/RecordingHub').then(m => ({ default: m.RecordingHubContent })));
import { useRecording } from '@/contexts/RecordingContext';
import type { ViewportRegion } from '@/components/RegionRecordOverlay';
import type { CropAspect, PixelRegion } from '@/components/PostRecordingCropModal';
const PostRecordingCropModal = React.lazy(() => import('@/components/PostRecordingCropModal'));
import { exportCroppedVideo } from '@/lib/cropExport';
import GuidedTour from '@/components/GuidedTour';
import { terminateGlobalPoseWorker } from '@/lib/poseWorkerBridge';
import PrecisionDrawInstructions, {
  hasSeenPrecisionInstructions,
  markPrecisionInstructionsSeen,
} from '@/components/PrecisionDrawInstructions';
import YouTubeEmbed from '@/components/YouTubeEmbed';
import EmbedCapturePanel from '@/components/EmbedCapturePanel';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { downloadDataURL, captureFrame } from '@/lib/drawingTools';
import { ENABLE_GOOGLE_EXPORTS } from '@/lib/featureFlags';
import { useStroMotion } from '@/hooks/useStroMotion';
const StroMotionPanel = React.lazy(() => import('@/components/StroMotionPanel'));
const SnapshotScrollPanel = React.lazy(() => import('@/components/metrics/SnapshotScrollPanel'));
const GenerateWorkspace = React.lazy(() => import('@/components/metrics/GenerateWorkspace'));
const SaveSessionModal = React.lazy(() => import('@/components/sessions/SaveSessionModal'));
import { useSessionDraft } from '@/hooks/useSessionDraft';
import {
  computeGhostSampleTimes,
  enforceMonotonicSampleTimes,
  setStroMotionPreviewHash,
  normalizeObjectBox,
  normalizeSubjectBox,
  subjectBoxFromRegion,
} from '@/lib/stroMotion';
import { makeSnapshot, toPhaseMarkers, type Snapshot } from '@/lib/snapshots';
import { makeMediaAsset, type MediaAsset } from '@/lib/media/mediaAsset';
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
const FrameMaskEditor = React.lazy(() => import('@/components/stroMotion/FrameMaskEditor'));
const StroMotionPreviewModal = React.lazy(() => import('@/components/stroMotion/StroMotionPreviewModal'));

// Retired AI-Detect items (not useful for coaching) — scrubbed from every column
// carry-forward path so state captured before their removal self-heals.
const RETIRED_COLUMN_LABELS = new Set(['L Shoulder', 'R Shoulder']);
function scrubRetiredLabels<T extends { label: string }>(items: T[]): T[] {
  return items.filter((m) => !RETIRED_COLUMN_LABELS.has(m.label));
}
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
const SaveReportModal = React.lazy(() => import('@/components/shared/SaveReportModal'));
import AuthButton from '@/components/AuthButton';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import RulerOverlay from '@/components/ruler/RulerOverlay';
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

/**
 * Step 1 — Mode Guard.
 * Single source of truth for which analysis domain currently owns the canvas +
 * data column. Derived from the legacy ids (compat) but treated as authoritative:
 * exactly one domain may persist at a time.
 */
type AnalysisMode =
  | { kind: 'live' }
  | { kind: 'snapshot'; snapshotId: string };

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
  // Media Layer: dual-source asset for slot A. Snapshots reference it by id only.
  const [mediaAssetA, setMediaAssetA]     = useState<MediaAsset | null>(null);
  const currentMediaIdRef                 = useRef<string | null>(null);
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
  // Recording is owned by the GLOBAL RecordingProvider (app/layout.tsx) so it
  // survives route navigation; this page registers its webcam/mic sources and
  // consumes finished recordings (crop/save modal).
  const {
    recState: globalRecState,
    registerRecordingSources,
    completedRecording,
    clearCompletedRecording,
  } = useRecording();
  const isRecording = globalRecState === 'recording' || globalRecState === 'paused' || globalRecState === 'stopped';
  const [videoBLoaded, setVideoBLoaded]   = useState(false);
  const [videoBDuration, setVideoBDuration] = useState(0);
  const [playBothEnabled, setPlayBothEnabled] = useState(false);
  const [circleSpinning, setCircleSpinning] = useState(false);
  const [outlineEraserSize, setOutlineEraserSize] = useState(0);
  const [skeletonShowAngles, setSkeletonShowAngles] = useState(true);
  const [skeletonShowHeadLine, setSkeletonShowHeadLine] = useState(false);
  const [skeletonShowHeadDirection, setSkeletonShowHeadDirection] = useState(false);
  // Foot line is opt-in like the head lines — click it in Skeleton tools to show.
  const [skeletonShowFootLine, setSkeletonShowFootLine] = useState(false);
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
  const [toolbarLabelsExpanded, setToolbarLabelsExpanded] = useState(false);
  // Embedded panels (StroMotion/Biomech) show labels when the toolbar shows labels.
  const panelShowLabels = !compactToolbarRail || toolbarLabelsExpanded;
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
    setStroSampleTimesOverride((prev) => {
      // Frame COUNT changed → reseed evenly (null lets the memo recompute).
      if (!prev || prev.length !== stroFrameCount) return null;
      // Only the trim range moved (handle drag) → KEEP the coach's manually
      // placed sample balls, just clamp any that fell outside the new
      // [start,end] instead of wiping every position (the "snapshots move from
      // their position" bug).
      return enforceMonotonicSampleTimes(prev, stroStartFrame, stroEndFrame);
    });
  }, [stroStartFrame, stroEndFrame, stroFrameCount]);

  const stroMotionHtml5Only =
    !!videoSrc &&
    !youtubeVideoIdA &&
    !youtubeVideoIdB &&
    !genericEmbedSrcA &&
    !genericEmbedSrcB;

  // ── Snapshot model: single source of truth for Metrics analysis ──────────
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [measurementColumn, setMeasurementColumn] = useState<Array<{ id: string; label: string; value: number; unit: string; type: string }>>([]);
  const measurementColumnRef = useRef(measurementColumn);
  measurementColumnRef.current = measurementColumn;
  const [biomechSelectedPhaseId, setBiomechSelectedPhaseId] = useState<string | null>(null);
  // Derived phase markers (green balls) consumed by PreciseTimeline.
  const biomechPhaseMarkers = useMemo(
    () => (snapshots.length ? toPhaseMarkers(snapshots) : null),
    [snapshots],
  );
  const [measurementColumnPos, setMeasurementColumnPos] = useState<{ x: number; y: number }>({ x: 0.68, y: 0.02 });
  // Live column rect (CSS px, relative to the canvas container) reported by
  // Canvas each frame so the +/- overlay buttons anchor to the exact drawn
  // column — tracking drag AND resize with no lag/misalignment.
  const [measurementColumnRect, setMeasurementColumnRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Step 1: Mode Guard — single authoritative domain ─────────────────────
  // Frame mode supersedes snapshot mode so the two persist paths can never run
  // together. Snapshot-entry points clear the frame index, so normal snapshot
  // flow resolves to 'snapshot'; touching a frame resolves to 'frame'.
  const analysisMode = useMemo<AnalysisMode>(() => {
    if (biomechSelectedPhaseId) return { kind: 'snapshot', snapshotId: biomechSelectedPhaseId };
    return { kind: 'live' };
  }, [biomechSelectedPhaseId]);
  // Ref mirror so stable callbacks (e.g. the live-angle flush) can read the
  // current mode without being recreated.
  const analysisModeRef = useRef(analysisMode);
  analysisModeRef.current = analysisMode;

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

  // Skeleton persists across tool changes once enabled from Metrics
  const [skeletonKeepAlive, setSkeletonKeepAlive] = useState(false);
  const skeletonEnabled  = activeTool === 'skeleton' || skeletonKeepAlive || (stroMotionActive && stroShowSkeleton);
  const [skeletonOverlayPaused, setSkeletonOverlayPaused] = useState(false);
  const [skeletonConfirmOpen, setSkeletonConfirmOpen] = useState(false);
  const [skeletonWaitingForClick, setSkeletonWaitingForClick] = useState(false);
  const [skeletonLocked, setSkeletonLocked] = useState(false);
  const [pendingMeasurement, setPendingMeasurement] = useState<{ type: string; value: number; unit: string } | null>(null);
  const [pendingMeasurementName, setPendingMeasurementName] = useState('');
  const [dataColumnActive, setDataColumnActive] = useState(false);
  const [columnDeleteMode, setColumnDeleteMode] = useState(false);
  const [showMeasurementOverlays, setShowMeasurementOverlays] = useState(false);

  // Active snapshot (the phase whose data column is shown).
  const activeSnapshot = useMemo(
    () => snapshots.find(s => s.id === biomechSelectedPhaseId) ?? null,
    [snapshots, biomechSelectedPhaseId],
  );
  const activeSnapshotRef = useRef(activeSnapshot);
  activeSnapshotRef.current = activeSnapshot;

  // Whether the playhead is within 0.3s of the active snapshot. Polled via rAF
  // (fires even while paused). Stored as a BOOLEAN that only updates when it
  // FLIPS — so the moving playhead no longer re-renders the whole analysis tree
  // (toolbar/timeline/panels) ~10×/sec. Previously this was a 10 Hz numeric
  // `currentVideoTime` state whose only consumer was this boolean; that churn
  // was the root cause of the lower-left toolbar glitch.
  const [isNearActivePhase, setIsNearActivePhase] = useState(true);
  // Auto-return to LIVE when the playhead leaves the selected snapshot (play,
  // frame-step, or scrub). Without this the mode stayed 'snapshot' forever and
  // the live skeleton never resumed following the player. Orchestrated flows
  // (Generate capture, slow-mo replay) manage selection themselves and suppress
  // the autopilot while they drive the playhead.
  const exitSnapshotToLiveRef = useRef<() => void>(() => {});
  const modeAutopilotSuppressedRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const poll = (now: number) => {
      if (now - lastTick >= 100) {
        lastTick = now;
        const v = videoRef.current;
        if (v) {
          const snap = activeSnapshotRef.current;
          // Tight tolerance (~a few frames): a snapshot seek lands exactly on
          // timeSec, so stepping even slightly forward should drop the snapshot
          // column/overlays and return to live — never linger past the phase.
          const near = snap ? Math.abs(v.currentTime - snap.timeSec) < 0.12 : true;
          setIsNearActivePhase(prev => (prev === near ? prev : near));
          if (!near && snap && !modeAutopilotSuppressedRef.current) {
            exitSnapshotToLiveRef.current();
          }
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dataColumnVisible = (dataColumnActive && isNearActivePhase);
  const ballTrailEnabled = activeTool === 'ballShadow';

  // Data column header reflects the locked owner (visual feedback only).
  const measurementColumnTitle = useMemo(() => {
    if (analysisMode.kind === 'snapshot') return activeSnapshot?.label ?? 'Snapshot';
    return 'Data Column';
  }, [analysisMode, activeSnapshot]);

  // ── Snapshot helpers ─────────────────────────────────────────────────────
  /** Persist the live canvas/column state into the currently-active snapshot. */
  const saveActiveSnapshot = useCallback(() => {
    const id = biomechSelectedPhaseId;
    if (!id) return;
    const drawingsJson = canvasRef.current?.exportStrokes?.() ?? '';
    const overlayAdjustments = canvasRef.current?.getOverlayAdjustments?.() ?? {};
    const skeleton = canvasRef.current?.getSkeletonKeypoints?.() ?? undefined;
    const col = measurementColumnRef.current;
    setSnapshots(prev => prev.map(s => s.id === id ? {
      ...s,
      column: col.filter(m => m.type !== 'skeleton-angle'),
      overlaysOn: showMeasurementOverlays,
      overlayAdjustments,
      drawingsJson,
      ...(skeleton ? { skeleton } : {}),
    } : s));
  }, [biomechSelectedPhaseId, showMeasurementOverlays]);

  /** Switch to an existing snapshot: save current, restore target, seek video. */
  const selectSnapshot = useCallback((id: string) => {
    saveActiveSnapshot();
    const target = snapshots.find(s => s.id === id);
    setBiomechSelectedPhaseId(id);
    if (!target) return;
    // Mode isolation: SNAPSHOT column = snapshot measurements only. No merge of
    // LIVE skeleton-angle rows (those belong to LIVE mode).
    // scrubRetiredLabels: retired AI items (L/R Shoulder) may live on in columns
    // captured before their removal — snapshots self-heal on restore.
    setMeasurementColumn(scrubRetiredLabels(target.column));
    setShowMeasurementOverlays(target.overlaysOn);
    // Restore drawings first (importStrokes replaces all strokes atomically).
    canvasRef.current?.importStrokes?.(target.drawingsJson || '[]');
    // Restore overlay adjustments after drawings are in place.
    canvasRef.current?.setOverlayAdjustments?.(target.overlayAdjustments ?? {});
    // Restore skeleton keypoints so overlays render from stored pose.
    canvasRef.current?.setSkeletonKeypoints?.(target.skeleton ?? null, 'snapshot');
    if (videoRef.current) { videoRef.current.currentTime = target.timeSec; videoRef.current.pause(); }
  }, [saveActiveSnapshot, snapshots]);

  /**
   * Leave SNAPSHOT mode and return to LIVE: persist the departing snapshot,
   * release its canvas state (mode isolation — snapshot drawings/overlays must
   * not bleed into LIVE), and let the live skeleton resume following the player.
   */
  const exitSnapshotToLive = useCallback(() => {
    if (analysisModeRef.current.kind !== 'snapshot') return;
    saveActiveSnapshot();
    setBiomechSelectedPhaseId(null);
    setMeasurementColumn([]);
    setShowMeasurementOverlays(false);
    canvasRef.current?.importStrokes?.('[]');
    canvasRef.current?.setOverlayAdjustments?.({});
  }, [saveActiveSnapshot]);
  useEffect(() => { exitSnapshotToLiveRef.current = exitSnapshotToLive; }, [exitSnapshotToLive]);

  /**
   * Mode Guard: release SNAPSHOT ownership when entering FRAME mode so the two
   * domains are mutually exclusive (no lingering snapshot id while in a frame).
   * Persists any in-progress snapshot edits first (no-op if not in snapshot mode).
   */
  const releaseSnapshotOwnership = useCallback(() => {
    saveActiveSnapshot();
    setBiomechSelectedPhaseId(null);
  }, [saveActiveSnapshot]);

  /**
   * Manual "Create Snapshot" (spec §2/§8): freeze the current LIVE frame.
   * Copies the live drawings, data column, and skeleton into a new snapshot,
   * captures a screenshot, and enters SNAPSHOT mode on it. This is the single
   * snapshot-creation primitive (used by both Create Snapshot and AI Detect).
   */
  const createSnapshotFromLive = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v) return null;
    v.pause();
    const t = v.currentTime;
    saveActiveSnapshot(); // persist any in-progress edits to the previous active snapshot
    const drawingsJson = canvasRef.current?.exportStrokes?.() ?? '';
    const overlayAdjustments = canvasRef.current?.getOverlayAdjustments?.() ?? {};
    const skeleton = canvasRef.current?.getSkeletonKeypoints?.() ?? undefined;
    const liveColumn = scrubRetiredLabels(measurementColumnRef.current.filter(m => m.type !== 'skeleton-angle'));
    const overlay = canvasRef.current?.getCanvas?.();
    let screenshot: string | undefined;
    if (overlay) { try { screenshot = captureFrame(v, overlay); } catch { screenshot = undefined; } }
    const num = snapshots.length + 1;
    const snap = makeSnapshot(t, `Snapshot ${num}`, String(num));
    if (currentMediaIdRef.current) snap.mediaId = currentMediaIdRef.current;
    snap.drawingsJson = drawingsJson;
    snap.overlayAdjustments = overlayAdjustments;
    if (skeleton) snap.skeleton = skeleton;
    snap.column = liveColumn;
    snap.overlaysOn = showMeasurementOverlays;
    if (screenshot) snap.screenshot = screenshot;
    setSnapshots(prev => [...prev, snap]);
    // Enter SNAPSHOT mode.
    setBiomechSelectedPhaseId(snap.id);
    setMeasurementColumn(liveColumn);
    // Drawings are already on the canvas (copied from live); freeze the captured
    // pose with snapshot provenance so the live worker no longer owns the display.
    canvasRef.current?.setSkeletonKeypoints?.(skeleton ?? null, 'snapshot');
    setProcessingStatus(`Snapshot ${num} created`);
    return snap.id;
  }, [saveActiveSnapshot, snapshots.length, showMeasurementOverlays]);

  /** Delete a snapshot. If it was the active one, return cleanly to LIVE mode. */
  const deleteSnapshot = useCallback((id: string) => {
    setSnapshots(prev => prev.filter(s => s.id !== id));
    if (biomechSelectedPhaseId === id) {
      setBiomechSelectedPhaseId(null);
      setMeasurementColumn([]);
      setShowMeasurementOverlays(false);
      canvasRef.current?.importStrokes?.('[]');
      canvasRef.current?.setOverlayAdjustments?.({});
      canvasRef.current?.setSkeletonKeypoints?.(null, 'snapshot');
    }
  }, [biomechSelectedPhaseId]);

  // ── Generate: capture phase screenshots + slow-mo replay ─────────────────
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false);
  const [generateWorkspaceOpen, setGenerateWorkspaceOpen] = useState(false);
  // Stays true after the first Generate so the workspace keeps its local state
  // (order, selection, title, notes) across close/reopen within the session.
  const [generateWorkspaceMounted, setGenerateWorkspaceMounted] = useState(false);
  const [generateReplayRate, setGenerateReplayRate] = useState(0.25);
  /** Seconds each snapshot stays frozen during the replay/recorded video. */
  const [generateHoldSec, setGenerateHoldSec] = useState(3);
  const [replayActive, setReplayActive] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const replayAbortRef = useRef(false);
  // Metrics "section" the replay/recording travels over. Shown as draggable
  // start/end handles on the timeline once a snapshot exists; defaults to the
  // span of all snapshots so the whole stroke is covered.
  const [metricsSectionStart, setMetricsSectionStart] = useState<number | null>(null);
  const [metricsSectionEnd, setMetricsSectionEnd] = useState<number | null>(null);

  /** Seek the video to a time and resolve once the frame is ready. */
  const seekVideoTo = useCallback((t: number): Promise<void> => new Promise((resolve) => {
    const v = videoRef.current;
    if (!v) { resolve(); return; }
    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { v.removeEventListener('seeked', onSeeked); resolve(); }, 1500);
    v.addEventListener('seeked', onSeeked);
    v.currentTime = t;
  }), []);

  /** Generate: for each snapshot, seek + restore its drawings + capture a screenshot. */
  const handleGenerateSnapshots = useCallback(async () => {
    saveActiveSnapshot();
    const ordered = [...snapshots].sort((a, b) => a.timeSec - b.timeSec);
    if (ordered.length === 0) { setProcessingStatus('Create a snapshot first (Create Snapshot or AI Detect)'); return; }
    // Capture drives the playhead across snapshots — keep the mode autopilot
    // from clearing restored strokes between restore and capture.
    modeAutopilotSuppressedRef.current = true;
    setProcessingStatus('Capturing snapshot screenshots…');
    const video = videoRef.current;
    const overlay = canvasRef.current?.getCanvas?.();
    const updated: Snapshot[] = [];
    for (const snap of ordered) {
      await seekVideoTo(snap.timeSec);
      canvasRef.current?.importStrokes?.(snap.drawingsJson || '[]');
      canvasRef.current?.setOverlayAdjustments?.(snap.overlayAdjustments ?? {});
      canvasRef.current?.setSkeletonKeypoints?.(snap.skeleton ?? null, 'snapshot');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      let shot: string | undefined;
      if (video && overlay) {
        try { shot = captureFrame(video, overlay); } catch { shot = undefined; }
      }
      updated.push({ ...snap, screenshot: shot });
    }
    setSnapshots(prev => prev.map(s => updated.find(u => u.id === s.id) ?? s));
    modeAutopilotSuppressedRef.current = false;
    setGenerateWorkspaceMounted(true);
    setGenerateWorkspaceOpen(true);
    setProcessingStatus(`Generated ${ordered.length} snapshot screenshots`);
  }, [snapshots, saveActiveSnapshot, seekVideoTo]);

  const [generateVideoUrl, setGenerateVideoUrl] = useState<string | null>(null);
  const [generateVideoBlob, setGenerateVideoBlob] = useState<Blob | null>(null);
  const [generateRecording, setGenerateRecording] = useState(false);
  // While true, the visible analysis canvas paints the video itself (instead of
  // the native <video> underlay) so the on-screen canvas stream carries video +
  // overlay. Single rendering path for Generate export; restored after recording.
  const [exportForceVideoPaint, setExportForceVideoPaint] = useState(false);

  // Snapshot IDs the Generate workspace selected for the video (empty = all).
  const generateIncludedIdsRef = useRef<string[] | null>(null);

  /**
   * Section-driven slow-mo replay: travel the SELECTED timeline section, slow-
   * playing the real video the whole way and freezing on each snapshot as the
   * playhead passes it. Previously it jumped snapshot→snapshot and only ever
   * called play() when a *next* snapshot existed — so a single snapshot (or a
   * mostly-held sequence) recorded a frozen frame ("outputs the picture only").
   * Now the stroke actually plays. Optionally stops a passed-in recorder at end.
   */
  const handleReplaySnapshots = useCallback(async (
    recorder?: MediaRecorder | null,
    opts?: {
      /** Playback rate to traverse the section at (recording overrides this to a slow "master" rate). */
      playRate?: number;
      /** Scale factor for snapshot freeze durations (recording holds longer so retimed holds stay correct). */
      holdScale?: number;
    },
  ) => {
    const inc = generateIncludedIdsRef.current;
    const ordered = [...snapshots]
      .filter((s) => !inc || inc.includes(s.id))
      .sort((a, b) => a.timeSec - b.timeSec);
    if (ordered.length === 0) return;
    const v = videoRef.current;
    if (!v) return;

    // Section to travel: the coach's timeline selection, else the snapshot span
    // (padded) so there is real motion before the first and after the last phase.
    const secStart = metricsSectionStart ?? Math.max(0, ordered[0].timeSec - 0.3);
    const secEnd = Math.max(secStart + 0.1, metricsSectionEnd ?? (ordered[ordered.length - 1].timeSec + 0.3));
    const stops = ordered.filter((s) => s.timeSec >= secStart - 0.05 && s.timeSec <= secEnd + 0.05);

    const originalRate = v.playbackRate || 1;
    const replayRate = opts?.playRate ?? (generateReplayRate > 0 ? generateReplayRate : 0.25);
    replayAbortRef.current = false;
    setReplayActive(true);
    modeAutopilotSuppressedRef.current = true;
    const HOLD_MS = Math.max(0.5, generateHoldSec) * 1000 * (opts?.holdScale ?? 1);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Slow-play from the current position up to `target`, then pause.
    const playTo = async (target: number) => {
      if (!videoRef.current || target <= videoRef.current.currentTime + 0.02) return;
      v.playbackRate = replayRate;
      try { await v.play(); } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const check = () => {
          if (replayAbortRef.current || !videoRef.current) { resolve(); return; }
          if (videoRef.current.currentTime >= target - 0.02) { resolve(); return; }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      v.pause();
    };

    // Begin at the section start — in LIVE mode. Entering from the Generate
    // workspace usually leaves a snapshot selected, whose frozen pose otherwise
    // owns the display until the first hold ("skeleton froze up to the first
    // snapshot").
    releaseSnapshotOwnership();
    setMeasurementColumn([]);
    setShowMeasurementOverlays(false);
    canvasRef.current?.importStrokes?.('[]');
    canvasRef.current?.setOverlayAdjustments?.({});
    await seekVideoTo(secStart);
    v.pause();

    for (let i = 0; i < stops.length; i++) {
      if (replayAbortRef.current) break;
      const snap = stops[i];
      // Play the real video up to this phase — this is the stroke motion.
      await playTo(snap.timeSec);
      if (replayAbortRef.current) break;
      // Freeze on the phase with its drawings + skeleton restored.
      setReplayIndex(i);
      selectSnapshot(snap.id);
      await sleep(HOLD_MS);
      if (replayAbortRef.current) break;
      // Hand the display back to LIVE before the next motion segment — staying
      // in snapshot mode froze the skeleton for the rest of the recording (the
      // play→live effect is suppressed during replay). Snapshot drawings/column
      // belong to the hold; the motion plays clean with live tracking.
      releaseSnapshotOwnership();
      setMeasurementColumn([]);
      setShowMeasurementOverlays(false);
      canvasRef.current?.importStrokes?.('[]');
      canvasRef.current?.setOverlayAdjustments?.({});
    }
    // Follow-through: play out to the section end.
    if (!replayAbortRef.current) await playTo(secEnd);

    if (videoRef.current) { videoRef.current.pause(); videoRef.current.playbackRate = originalRate; }
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* noop */ } }
    modeAutopilotSuppressedRef.current = false;
    setReplayActive(false);
    setReplayIndex(null);
  }, [snapshots, seekVideoTo, selectSnapshot, releaseSnapshotOwnership, generateReplayRate, generateHoldSec, metricsSectionStart, metricsSectionEnd]);

  // Default the metrics section to the snapshot span; preserve manual drags.
  // (The same section doubles as the Precision-AI-Track range when skeleton is
  // on, so it is only cleared when neither consumer needs it.)
  useEffect(() => {
    if (snapshots.length === 0) {
      if (!skeletonEnabled) { setMetricsSectionStart(null); setMetricsSectionEnd(null); }
      return;
    }
    const times = snapshots.map(s => s.timeSec).sort((a, b) => a - b);
    const lo = times[0], hi = times[times.length - 1];
    setMetricsSectionStart(prev => prev == null ? Math.max(0, lo - 0.3) : prev);
    setMetricsSectionEnd(prev => prev == null ? hi + 0.3 : prev);
  }, [snapshots, skeletonEnabled]);

  // Skeleton on → make the section handles available (default: full video) so
  // the coach can scope the Precision AI Track like in Metrics/StroMotion.
  useEffect(() => {
    if (!skeletonEnabled || !videoSrc) return;
    const v = videoRef.current;
    const dur = v && isFinite(v.duration) ? v.duration : 0;
    if (dur <= 0) return;
    setMetricsSectionStart(prev => prev == null ? 0 : prev);
    setMetricsSectionEnd(prev => prev == null ? dur : prev);
  }, [skeletonEnabled, videoSrc]);

  // ── Precision AI Track (skeleton "bake") ─────────────────────────────────
  // FRAME-STEPPED pass: seek every frame time, detect on the PAUSED frame with
  // MediaPipe Pose Landmarker FULL (33 landmarks — real heel+toe on every
  // frame), then apply offline zero-lag smoothing. Deterministic and
  // frame-exact — strictly more precise than any slow-playback pass, because
  // samples land ON frames instead of at arbitrary wall-clock times.
  const [precisionTrackState, setPrecisionTrackState] = useState<'idle' | 'running' | 'ready'>('idle');
  const precisionAbortRef = useRef(false);

  const handlePrecisionTrack = useCallback(async (scope: 'all' | 'section') => {
    const v = videoRef.current;
    if (!v || !videoSrc) { setProcessingStatus('Load a video first'); return; }
    if (!skeletonEnabled) { setProcessingStatus('Enable Skeleton first, then run AI Track'); return; }
    if (precisionTrackState === 'running') { precisionAbortRef.current = true; return; } // second tap cancels
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (dur <= 0) { setProcessingStatus('Video not ready yet — try again'); return; }
    const start = scope === 'section' && metricsSectionStart != null ? Math.max(0, metricsSectionStart) : 0;
    const end = scope === 'section' && metricsSectionEnd != null ? Math.min(dur, metricsSectionEnd) : dur;
    if (end - start < 0.2) { setProcessingStatus('Selected section is too short to track'); return; }

    precisionAbortRef.current = false;
    setPrecisionTrackState('running');
    const originalRate = v.playbackRate || 1;
    try {
      v.pause();
      setProcessingStatus('Loading precision tracking model…');
      const mp = await import('@/lib/mediapipePose');
      await seekVideoTo(start);
      // Probe once: cold model init + first inference. Decides the engine for
      // the whole pass so MoveNet and MediaPipe coords never mix in one track.
      const probe = await mp.detectFullPoseOnFrame(v).catch(() => null);
      const useMediaPipe = !!probe;
      canvasRef.current?.startBakeCapture?.(!useMediaPipe);
      if (probe) canvasRef.current?.addBakeSample?.(v.currentTime, probe);

      // Epsilon-guarded frame seek (seekStroVideo pattern) — 'seeked' or 200 ms.
      const seekTo = (t: number) => new Promise<void>((resolve) => {
        const vv = videoRef.current;
        if (!vv) { resolve(); return; }
        if (Math.abs(vv.currentTime - t) < 0.0005 && !vv.seeking) { resolve(); return; }
        let done = false;
        const fin = () => { if (!done) { done = true; vv.removeEventListener('seeked', fin); resolve(); } };
        vv.addEventListener('seeked', fin, { once: true });
        vv.currentTime = t;
        window.setTimeout(fin, 200);
      });

      const FPS = 30;
      const step = 1 / FPS;
      const total = Math.max(1, Math.ceil((end - start) / step));
      const passT0 = performance.now();
      for (let k = 1; k <= total; k++) {
        if (precisionAbortRef.current) break;
        const t = Math.min(end, start + k * step);
        await seekTo(t);
        if (useMediaPipe) {
          const kps = await mp.detectFullPoseOnFrame(v).catch(() => null);
          if (kps) canvasRef.current?.addBakeSample?.(v.currentTime, kps);
        } else {
          // MoveNet fallback: the paused-frame 'seeked' detection (Canvas pose
          // scheduler) feeds the bake via the bridge hook — give it one beat.
          await new Promise((r) => setTimeout(r, 90));
        }
        if (k % 3 === 0 || k === total) {
          setProcessingStatus(`AI-tracking… ${Math.round((k / total) * 100)}% (frame-exact${useMediaPipe ? ' + real feet' : ''})`);
        }
      }
      const passMs = performance.now() - passT0;

      const kept = canvasRef.current?.finishBakeCapture?.({ start, end }) ?? 0;
      if (precisionAbortRef.current || kept < 2) {
        canvasRef.current?.clearBakedTrack?.();
        setPrecisionTrackState('idle');
        setProcessingStatus(precisionAbortRef.current ? 'AI Track cancelled' : 'AI Track found no skeleton in that range');
      } else {
        setPrecisionTrackState('ready');
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[PrecisionTrack] ${kept} frames in ${Math.round(passMs)}ms (${Math.round(passMs / Math.max(1, end - start))}ms per video-second, engine=${useMediaPipe ? 'mediapipe-full' : 'movenet'})`);
        }
        setProcessingStatus(`AI Track ready — ${kept} frame-exact poses locked. Play at any speed.`);
      }
    } finally {
      v.playbackRate = originalRate;
      void seekVideoTo(start);
    }
  }, [videoSrc, skeletonEnabled, precisionTrackState, metricsSectionStart, metricsSectionEnd, seekVideoTo]);

  const handlePrecisionTrackClear = useCallback(() => {
    canvasRef.current?.clearBakedTrack?.();
    setPrecisionTrackState('idle');
    setProcessingStatus('AI Track cleared — live tracking resumed');
  }, []);

  // The baked track dies with its video (Canvas clears it too) — reset the UI.
  useEffect(() => { setPrecisionTrackState('idle'); }, [videoSrc]);

  /**
   * Record the replay to MP4 — SLOW-MASTER strategy: the section is always
   * recorded with the video playing at ≤0.25× (the regime where pose detection
   * has time to converge → maximum-quality skeleton on every frame), then the
   * ffmpeg conversion retimes the master to the coach's chosen speed. Choosing
   * 1× still gets the 0.25×-quality skeleton. Holds are recorded proportionally
   * longer so they come out exactly `holdSec` after retiming.
   */
  const recordReplayToMp4 = useCallback(async (includedIds?: string[]) => {
    if (!snapshots.length || generateRecording) return;
    if (!canvasRef.current?.getCanvas?.()) { setProcessingStatus('Recording not supported on this device'); return; }
    // Honor the workspace's snapshot selection for the recorded video.
    generateIncludedIdsRef.current = includedIds && includedIds.length ? includedIds : null;

    setGenerateRecording(true);
    // Single export rendering path: force the visible, in-DOM analysis canvas to
    // paint the video itself, then capture that canvas (video + overlay). The
    // canvas stays attached to the DOM, which Safari captures far more reliably
    // than a detached offscreen canvas. Rendering mode is restored in `finally`.
    setExportForceVideoPaint(true);
    let stream: MediaStream | null = null;
    try {
      // Let the mode flip commit, then wait for a REAL video frame on the canvas
      // — capturing earlier encoded blank/overlay-only frames.
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const painted = await canvasRef.current?.waitForVideoPaint?.(60);
      if (!painted) { setProcessingStatus('Could not start video capture — try again'); return; }

      // Always a FRESH stream (a cached one goes stale after canvas resizes and
      // silently records a single frozen frame).
      stream = canvasRef.current?.captureStream?.(30) ?? null;
      if (!stream) { setProcessingStatus('Recording not supported on this device'); return; }
      const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
      const mime = mimeCandidates.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
      catch { setProcessingStatus('Recording failed to start'); return; }
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime.includes('mp4') ? 'video/mp4' : 'video/webm' }));
      });

      // Slow master: traverse at ≤0.25× regardless of the chosen speed; retime after.
      const targetRate = generateReplayRate > 0 ? generateReplayRate : 0.25;
      const masterRate = Math.min(0.25, targetRate);
      const holdScale = targetRate / masterRate;        // hold longer → correct after retime
      const retimeFactor = masterRate / targetRate;     // <1 speeds the master up

      setProcessingStatus(`Recording master at ${masterRate}× for best skeleton…`);
      recorder.start();
      await handleReplaySnapshots(recorder, { playRate: masterRate, holdScale });
      const webmBlob = await done;
      setProcessingStatus(retimeFactor < 1 ? `Rendering at ${targetRate}× speed…` : 'Converting to MP4…');
      let finalBlob = webmBlob;
      const conv = await convertWebmBlobToMp4(webmBlob, { retimeFactor });
      if (conv.ok) {
        finalBlob = conv.blob;
      } else if (retimeFactor < 1) {
        // Conversion failed and the master is slow — deliver it honestly.
        setProcessingStatus('MP4 conversion failed — video saved at recording speed');
      }
      if (generateVideoUrl) URL.revokeObjectURL(generateVideoUrl);
      const url = URL.createObjectURL(finalBlob);
      setGenerateVideoUrl(url);
      setGenerateVideoBlob(finalBlob);
      if (conv.ok) setProcessingStatus('Replay video ready — download below');
    } finally {
      // Freeing the capture track matters: a live track keeps compositing costs
      // on every canvas paint.
      try { stream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      setExportForceVideoPaint(false);
      setGenerateRecording(false);
    }
  }, [snapshots, generateRecording, generateVideoUrl, handleReplaySnapshots, generateReplayRate]);

  /** Replay from the Generate workspace: workspace hides itself; show the strip HUD meanwhile. */
  const handleWorkspaceReplay = useCallback(async (includedIds: string[]) => {
    generateIncludedIdsRef.current = includedIds.length ? includedIds : null;
    setSnapshotPanelOpen(true);
    await handleReplaySnapshots();
    setSnapshotPanelOpen(false);
  }, [handleReplaySnapshots]);

  const orderedSnapshots = useMemo(() => [...snapshots].sort((a, b) => a.timeSec - b.timeSec), [snapshots]);

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

    // Seek FIRST — both the pose fallback and the object detector read the
    // video's current frame.
    await seekStroVideo(timeSec);

    // Get skeleton keypoints near this frame time from the playback cache…
    const skFrames = canvasRef.current?.getSkeletonFrames?.() ?? [];
    const cached = skFrames.reduce<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number }> } | null>((best, f) => {
      if (!best || Math.abs(f.timeSeconds - timeSec) < Math.abs(best.timeSeconds - timeSec)) return f;
      return best;
    }, null);
    // …preferring the Precision AI Track pose, then cache, then on-demand.
    let keypointsForFrame = canvasRef.current?.getBakedPoseAt?.(timeSec)
      ?? (cached && Math.abs(cached.timeSeconds - timeSec) < 0.2 ? cached.keypoints : null);
    if (!keypointsForFrame) {
      keypointsForFrame = await canvasRef.current?.detectPoseAtTime?.(timeSec) ?? null;
    }
    if (!keypointsForFrame?.length) return false;

    const validKps = keypointsForFrame.filter(kp => kp.score >= 0.2);
    if (validKps.length < 4) return false;

    const kps = keypointsForFrame;
    const rWrist = kps[10], lWrist = kps[9], rElbow = kps[8], lElbow = kps[7];
    const bodyX = validKps.reduce((s, k) => s + k.x, 0) / validKps.length;
    const rDist = rWrist?.score >= 0.2 ? Math.abs(rWrist.x - bodyX) : 0;
    const lDist = lWrist?.score >= 0.2 ? Math.abs(lWrist.x - bodyX) : 0;
    const domWrist = rDist > lDist ? rWrist : lWrist;
    const domElbow = rDist > lDist ? rElbow : lElbow;

    const vw = video.videoWidth, vh = video.videoHeight;

    // ── OBJECT mode: find the IMPLEMENT box, not the player box ────────────
    if (stroObjectType !== 'player') {
      // 1. Real detection (COCO-SSD racket/bat) near the dominant wrist.
      if (domWrist?.score >= 0.2) {
        try {
          const { detectTennisRacketNearHint } = await import('@/lib/racketCocoDetect');
          const r = 0.16;
          const hint = {
            x: Math.max(0, domWrist.x / vw - r), y: Math.max(0, domWrist.y / vh - r),
            w: Math.min(1, 2 * r), h: Math.min(1, 2 * r),
          };
          const det = await Promise.race([
            detectTennisRacketNearHint(video, hint, { minScore: 0.18, searchExpand: 1.0 }),
            new Promise<null>((res) => setTimeout(() => res(null), 3000)),
          ]);
          if (det && det.score >= 0.18) {
            finishStroRegionSelect(index, {
              x: det.box.x * vw, y: det.box.y * vh, w: det.box.w * vw, h: det.box.h * vh,
            });
            return true;
          }
        } catch { /* detector unavailable — geometric fallback below */ }
      }
      // 2. Geometric fallback: a racket-sized box centered on the wrist→tip
      //    extension (NOT the whole player — a tight box keeps the motion-diff
      //    mask clean).
      if (domWrist?.score >= 0.2 && domElbow?.score >= 0.2) {
        const dx = domWrist.x - domElbow.x;
        const dy = domWrist.y - domElbow.y;
        const forearm = Math.hypot(dx, dy);
        if (forearm > 4) {
          const tipX = domWrist.x + dx * 1.4;
          const tipY = domWrist.y + dy * 1.4;
          const cx = (domWrist.x + tipX) / 2;
          const cy = (domWrist.y + tipY) / 2;
          const half = Math.max(forearm * 1.2, 40);
          finishStroRegionSelect(index, {
            x: Math.max(0, cx - half), y: Math.max(0, cy - half),
            w: Math.min(vw, cx + half) - Math.max(0, cx - half),
            h: Math.min(vh, cy + half) - Math.max(0, cy - half),
          });
          return true;
        }
      }
      return false;
    }

    // ── PLAYER mode: whole-body box extended along the dominant arm ────────
    const racketPoints: Array<{ x: number; y: number }> = [];
    if (domWrist?.score >= 0.2 && domElbow?.score >= 0.2) {
      const dx = domWrist.x - domElbow.x;
      const dy = domWrist.y - domElbow.y;
      racketPoints.push({ x: domWrist.x + dx * 1.5, y: domWrist.y + dy * 1.5 });
    }
    const allPoints = [...validKps, ...racketPoints];
    const xs = allPoints.map(kp => kp.x);
    const ys = allPoints.map(kp => kp.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = (maxX - minX) * 0.2;
    const padY = (maxY - minY) * 0.2;
    finishStroRegionSelect(index, {
      x: Math.max(0, minX - padX),
      y: Math.max(0, minY - padY),
      w: Math.min(vw, maxX + padX) - Math.max(0, minX - padX),
      h: Math.min(vh, maxY + padY) - Math.max(0, minY - padY),
    });
    return true;
  }, [stroMotionDraft, videoRef, canvasRef, seekStroVideo, finishStroRegionSelect, stroObjectType]);

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

  // ── StroMotion Generate render settings (drive preview rebuilds) ─────────
  const [stroGhostOpacity, setStroGhostOpacity] = useState<number | undefined>(undefined);
  const [stroVideoSpeed, setStroVideoSpeed] = useState(1);
  // Exported-video ghost timing: build-up (appear) / fade-behind (vanish) / all-on.
  const [stroLayerMode, setStroLayerMode] = useState<'appear' | 'vanish' | 'all'>('appear');
  const [stroExcludedFrames, setStroExcludedFrames] = useState<Set<number>>(new Set());

  const clearStroVideoPreview = useCallback(() => {
    setStroPreviewVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    stroPreviewVideoBlobRef.current = null;
  }, []);

  // Drop excluded-frame indices that no longer exist in the current draft.
  useEffect(() => {
    setStroExcludedFrames((prev) => {
      if (prev.size === 0) return prev;
      if (!stroMotionDraft) return new Set();
      const valid = new Set([...prev].filter((i) => stroMotionDraft.frames.some((f) => f.index === i)));
      return valid.size === prev.size ? prev : valid;
    });
  }, [stroMotionDraft]);

  /** Rebuild the StroMotion still-image preview with the current (or overridden) render settings. */
  const rebuildStroPreview = useCallback(async (opts?: {
    videoOrder?: 'forward' | 'reverse';
    opacity?: { value: number | undefined };
    excluded?: Set<number>;
  }) => {
    if (!stroMotionDraft) return;
    const excluded = opts?.excluded ?? stroExcludedFrames;
    const includedIndices = excluded.size > 0
      ? stroMotionDraft.frames.map((f) => f.index).filter((i) => !excluded.has(i))
      : undefined;
    const opacity = opts?.opacity ? opts.opacity.value : stroGhostOpacity;
    const pngUrl = await generateStroPreview({
      background: stroBackground,
      videoOrder: opts?.videoOrder ?? stroVideoOrder,
      endTimeSec: stroEndFrame,
      opacity,
      includedIndices,
    });
    if (pngUrl) setStroPreviewPngUrl(pngUrl);
  }, [stroMotionDraft, stroExcludedFrames, stroGhostOpacity, generateStroPreview, stroBackground, stroVideoOrder, stroEndFrame]);

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
      const exportResult = await canvasRef.current?.exportStroMotionVideo?.({ speed: stroVideoSpeed });
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
  }, [hydrateStroDraftForExport, stroVideoExportSupported, stroVideoSpeed]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const syncMeta = () => {
      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setStroVideoDuration(dur);
        setStroEndFrame((prev) => (prev <= stroStartFrame || prev > dur ? Math.min(Math.max(stroStartFrame + 1, 3), dur) : prev));
      }
      setStroVideoTime(v.currentTime || 0);
    };
    v.addEventListener('loadedmetadata', syncMeta);
    v.addEventListener('timeupdate', syncMeta);
    syncMeta();
    return () => {
      v.removeEventListener('loadedmetadata', syncMeta);
      v.removeEventListener('timeupdate', syncMeta);
    };
  }, [videoSrc, stroStartFrame]);

  // Phase markers are created explicitly via the Phases button handler.
  // No auto-proposal — phases only appear when the user chooses them.

  useEffect(() => {
    if (stroMotionActive && stroMotionHtml5Only && !stroMotionProcessing) {
      setStroMotionConfiguring(true);
    } else if (!stroMotionActive) {
      setStroMotionConfiguring(false);
    }
  }, [stroMotionActive, stroMotionHtml5Only, stroMotionProcessing, setStroMotionConfiguring]);

  const handleStroGenerate = useCallback(async () => {
    if (stroEndFrame <= stroStartFrame) {
      setProcessingStatus('End frame must be after start frame.');
      return;
    }
    if (!stroMotionDraft || !stroAllFramesExportReady) {
      setProcessingStatus(`Mark every frame Ready with a visible mask before generating (${stroReadyCount}/${stroMotionDraft?.frames.length ?? 0} ready).`);
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
    const pngUrl = await generateStroPreview({
      background: stroBackground,
      videoOrder: stroVideoOrder,
      endTimeSec: stroEndFrame,
      opacity: stroGhostOpacity,
      includedIndices: stroExcludedFrames.size > 0 && stroMotionDraft
        ? stroMotionDraft.frames.map((f) => f.index).filter((i) => !stroExcludedFrames.has(i))
        : undefined,
    });
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
    stroGhostOpacity,
    stroExcludedFrames,
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
        setProcessingStatus('Could not export PNG. Generate StroMotion first.');
      });
      return;
    }
    setProcessingStatus('Generate StroMotion first.');
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
      setProcessingStatus('Generate StroMotion first.');
      return;
    }
    if (!stroVideoExportSupported) return;
    const ok = await buildStroVideoPreview();
    if (!ok) {
      setProcessingStatus('Video preview failed. Try again or download PNG instead.');
      return;
    }
    setStroPreviewModalOpen(true);
  }, [buildStroVideoPreview, stroMotionDraft, stroVideoExportSupported]);

  const handleStroDownloadVideo = useCallback(() => {
    const blob = stroPreviewVideoBlobRef.current;
    if (!blob) {
      setProcessingStatus('Build the video preview first.');
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
      showLabels={panelShowLabels}
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
      onAutoSelectAll={async () => {
        const draft = stroMotionDraft;
        if (!draft) return;
        const pending = draft.frames.filter((f) => !f.selectionBox);
        if (pending.length === 0) { setProcessingStatus('All frames already have a selection.'); return; }
        setProcessingStatus(`AI detecting the player + racket in ${pending.length} frames…`);
        let ok = 0;
        for (let i = 0; i < pending.length; i++) {
          setProcessingStatus(`AI auto-detect: frame ${i + 1}/${pending.length}…`);
          const success = await autoSelectStroFrameFromSkeleton(pending[i].index);
          if (success) ok++;
        }
        void refreshStroPreviewFromDraft();
        setProcessingStatus(
          ok === 0
            ? 'Auto-detect could not find the player — make sure the player is visible, or use Select Area manually.'
            : `AI auto-selected ${ok}/${pending.length} frames. Review each, fix with Add brush if needed, then Generate.`,
        );
      }}
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

  /** Clear the Metrics/Snapshot analysis state (snapshots, data column, skeleton). */
  const resetMetrics = useCallback(() => {
    setSnapshots([]);
    setBiomechSelectedPhaseId(null);
    setMeasurementColumn([]);
    setDataColumnActive(false);
    setShowMeasurementOverlays(false);
    setSkeletonKeepAlive(false);
    setSkeletonLocked(false);
    skeletonFirstDetectedRef.current = false;
  }, []);

  const [screenshotSaving, setScreenshotSaving] = useState(false);
  const [screenshotPickerOpen, setScreenshotPickerOpen] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotPlayerList, setScreenshotPlayerList] = useState<Array<{ id: string; display_name: string }>>([]);
  const [screenshotNewPlayerName, setScreenshotNewPlayerName] = useState<string | null>(null);

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
      // Bring-your-own-cloud: the screenshot lives in the coach's Google Drive.
      // Supabase storage is the fallback (and the only path while the Google
      // export scopes are disabled pending verification).
      let imageUrl: string | null = null;
      if (ENABLE_GOOGLE_EXPORTS) {
        try {
          const driveRes = await fetch('/api/google/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: screenshotDataUrl, name: `${playerName.replace(/[^\w]+/g, '-')}-${Date.now()}.png` }),
          });
          if (driveRes.ok) {
            const body = await driveRes.json() as { url?: string };
            imageUrl = body.url ?? null;
          }
        } catch { /* fall back to Supabase */ }
      }

      if (!imageUrl) {
        const filename = `${userId}/${Date.now()}.png`;
        const path = await uploadDataUrl('analysis-screenshots', filename, screenshotDataUrl);
        if (path) {
          const { data: signed } = await supabase.storage.from('analysis-screenshots').createSignedUrl(path, 60 * 60 * 24 * 365);
          imageUrl = signed?.signedUrl ?? null;
        }
      }

      if (imageUrl) {
        const signed = { signedUrl: imageUrl };
        const res = await fetch(`/api/players/${playerId}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'technique',
            folder_label: `Analysis ${localDateTimeForFolder()}`,
            body_text: 'Screenshot from analysis session.',
            screenshots: [signed.signedUrl],
            source: 'analysis-screenshot',
          }),
        });
        if (!res.ok) {
          setProcessingStatus('Failed to save screenshot — try again');
          return;
        }
        // Best-effort: append to the player's Google Doc (AngleMotion/Players/<Name>).
        // A Docs failure must not fail the screenshot save. Skipped entirely
        // while the Google export scopes are disabled pending verification.
        if (ENABLE_GOOGLE_EXPORTS) {
          try {
            const docRes = await fetch(`/api/players/${playerId}/google-doc`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: signed.signedUrl, timestampLabel: localDateTimeForFolder() }),
            });
            if (docRes.ok) {
              setProcessingStatus(`Saved to ${playerName} + Google Doc`);
            } else {
              const docErr = (await docRes.json().catch(() => ({}))) as { error?: string };
              setProcessingStatus(`Saved to ${playerName} — Google Doc failed: ${docErr.error ?? `HTTP ${docRes.status}`}`);
            }
          } catch {
            setProcessingStatus(`Saved to ${playerName} (Google Doc skipped)`);
          }
        } else {
          setProcessingStatus(`Saved to ${playerName}`);
        }
      } else {
        setProcessingStatus('Upload failed — try again');
        return;
      }
      setScreenshotPickerOpen(false);
      setScreenshotDataUrl(null);
    } finally {
      setScreenshotSaving(false);
    }
  }, [screenshotDataUrl, handleScreenshotDownload]);

  const handleScreenshotCreateAndSave = useCallback(async () => {
    if (!screenshotNewPlayerName?.trim() || !screenshotDataUrl) return;
    setScreenshotSaving(true);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: screenshotNewPlayerName.trim() }),
      });
      if (!res.ok) { setProcessingStatus('Failed to create player — check the name and try again'); return; }
      const { player } = await res.json() as { player: { id: string; display_name: string } };
      setScreenshotNewPlayerName(null);
      await handleScreenshotSaveToPlayer(player.id, player.display_name);
    } finally {
      setScreenshotSaving(false);
    }
  }, [screenshotNewPlayerName, screenshotDataUrl, handleScreenshotSaveToPlayer]);

  /** Open report modal: requires at least one captured frame */
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

  // No warmup — Canvas creates the bridge on-demand when skeleton toggles.
  // The bridge handles worker creation, timeout, and fallback internally.

  // Auto-show data column when skeleton is enabled
  useEffect(() => {
    if (skeletonEnabled) setDataColumnActive(true);
  }, [skeletonEnabled]);

  // Auto-save measurement column into the active snapshot.
  // Skips when the non-angle column is structurally unchanged so the live
  // skeleton-angle flushes (every 500ms) don't churn the snapshots array.
  useEffect(() => {
    // Gated: only the snapshot domain may write the snapshot store.
    if (analysisMode.kind !== 'snapshot') return;
    const ownerId = analysisMode.snapshotId;
    const nonAngle = measurementColumn.filter(m => m.type !== 'skeleton-angle');
    setSnapshots(prev => {
      const cur = prev.find(s => s.id === ownerId);
      if (!cur) return prev;
      const same = cur.column.length === nonAngle.length
        && cur.column.every((c, i) => c.id === nonAngle[i].id && c.value === nonAngle[i].value);
      if (same) return prev;
      // Re-derive aiDetection/jointAngles from the column so edits stay in sync.
      const aiDetection: Record<string, number> = {};
      const jointAngles: Record<string, number> = {};
      for (const it of nonAngle) {
        if (it.type === 'angle') jointAngles[it.label] = it.value;
        aiDetection[it.label] = it.value;
      }
      return prev.map(s => s.id === ownerId
        ? { ...s, column: nonAngle, aiDetection, jointAngles } : s);
    });
  }, [measurementColumn, analysisMode]);

  // Live skeleton angle updates → data column (throttled to avoid render storms)
  const liveAnglesRef = useRef<Array<{ label: string; deg: number }>>([]);
  const angleThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ALL_ANGLE_LABELS = ['L Elbow', 'R Elbow', 'L Knee', 'R Knee'];

  const flushAnglesToColumn = useCallback(() => {
    // Mode isolation: live skeleton-angle rows belong to LIVE mode only. In
    // snapshot/frame mode the column is owned by that mode — do not inject.
    if (analysisModeRef.current.kind !== 'live') return;
    const current = liveAnglesRef.current;
    const angleMap = new Map(current.map(a => [a.label, a.deg]));
    const angleItems = ALL_ANGLE_LABELS.map(label => ({
      id: `skel-${label}`,
      label,
      value: angleMap.get(label) ?? 0,
      unit: '°',
      type: 'skeleton-angle',
    }));
    setMeasurementColumn(prev => {
      const nonAngle = prev.filter(m => m.type !== 'skeleton-angle');
      return [...nonAngle, ...angleItems];
    });
  }, []);

  const skeletonFirstDetectedRef = useRef(false);
  const handleSkeletonAnglesUpdate = useCallback((angles: Array<{ label: string; deg: number }>) => {
    liveAnglesRef.current = angles;
    if (!skeletonFirstDetectedRef.current && angles.length > 0) {
      skeletonFirstDetectedRef.current = true;
      setTimeout(() => setSkeletonConfirmOpen(true), 1500);
    }
    if (!angleThrottleRef.current) {
      angleThrottleRef.current = setTimeout(() => {
        angleThrottleRef.current = null;
        flushAnglesToColumn();
      }, 500);
    }
  }, [flushAnglesToColumn]);

  // Initialize all 4 angles when skeleton enables
  useEffect(() => {
    if (skeletonEnabled && dataColumnActive) {
      flushAnglesToColumn();
    }
  }, [skeletonEnabled, dataColumnActive, flushAnglesToColumn]);

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
      if (localStorage.getItem('anglemotion-toolbar-collapsed') === '1') {
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
        localStorage.setItem('anglemotion-toolbar-collapsed', next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

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

  // BUG 5: returning to playback exits SNAPSHOT mode → LIVE so the live skeleton
  // loop resumes (spec §9). Guarded so the slow-mo replay — which plays the video
  // while cycling snapshots — is not interrupted. LIVE starts with a clean overlay
  // (snapshot drawings/column belong to the snapshot, saved by release).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlayReturnLive = () => {
      if (biomechSelectedPhaseId && !replayActive && !generateRecording) {
        releaseSnapshotOwnership();
        setMeasurementColumn([]);
        setShowMeasurementOverlays(false);
        canvasRef.current?.importStrokes?.('[]');
        canvasRef.current?.setOverlayAdjustments?.({});
      }
    };
    video.addEventListener('play', onPlayReturnLive);
    return () => video.removeEventListener('play', onPlayReturnLive);
  }, [biomechSelectedPhaseId, replayActive, generateRecording, releaseSnapshotOwnership]);

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
      // Unmute after autoplay succeeds — user interaction has happened
      v.muted = false;
      setShowTapToPlay(false);
      await canvas?.waitForRender?.();
      return true;
    } catch (err: unknown) {
      console.warn('[AngleMotion] HTML5 play failed:', err);
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
      '--anglemotion-banner-bottom',
      `calc(${toolbarBottomReservePx}px + var(--anglemotion-install-banner-height, 0px))`,
    );
    return () => {
      document.documentElement.style.removeProperty('--anglemotion-banner-bottom');
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
    // Clear any lingering capture UI so a "clean session" never leaves the
    // countdown, step status, or download prompt behind. (Screen recording is
    // global now — if one is running, the floating widget keeps showing it.)
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
      // ── Media Layer: local-only in V1 (ADR-012) ──────────────────────────
      // The remote Supabase-upload path is DORMANT: playback runs on the local
      // blob, `remoteUrl` stays null, and durability comes from the Drive/
      // YouTube export. Do not re-enable without revisiting ADR-012.
      const asset: MediaAsset = { ...makeMediaAsset(url, file.size), status: 'ready' };
      currentMediaIdRef.current = asset.id;
      setMediaAssetA(asset);
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
      // UNCONDITIONAL pause: while B's play() promise is pending, vB.paused is
      // still true — the old `if (!vB.paused)` guard skipped the pause, the
      // promise then resolved, and B played on alone ("stop doesn't stop").
      // pause() during a pending play() simply rejects it (caught below).
      vB.pause();
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
        // A stopped — make CERTAIN B stops too before the loop exits (a pending
        // B play() promise can otherwise land after this and play on alone).
        vB.pause();
        playPendingB = false;
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
      setProcessingStatus('Could not access webcam. Please check browser permissions.');
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
      setProcessingStatus('Could not access microphone. Please check browser permissions.');
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
    downloadDataURL(canvas.toDataURL('image/png'), `angle-motion-screenshot-${Date.now()}.png`);
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
    downloadDataURL(crop.toDataURL('image/png'), `angle-motion-screenshot-${Date.now()}.png`);
  }, []);

  // (Recording completion now flows through the global RecordingProvider →
  // the completedRecording consumption effect above.)

  const handleResetRecordingSettings = useCallback(() => {
    setLayoutMode('youtube');
    if (webcamActive) void toggleWebcam();
    if (micActive) toggleMic();
  }, [webcamActive, micActive, toggleWebcam, toggleMic]);

  const downloadBlob = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `angle-motion-recording-${Date.now()}.${ext}`;
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
    a.download = `angle-motion-recording-${Date.now()}.${pack.ext}`;
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

  // Register this page's webcam/mic sources with the global recorder. The
  // engine snapshots the actual tracks at start() time, so these getters going
  // stale after navigation is harmless.
  useEffect(() => {
    registerRecordingSources({ getWebcamStream, getMicStream });
    return () => registerRecordingSources(null);
  }, [registerRecordingSources, getWebcamStream, getMicStream]);

  // Consume finished recordings (also covers "stopped while on another page" —
  // the blob waits in the provider until this page mounts again).
  useEffect(() => {
    if (!completedRecording) return;
    setRecordingSession({ videoBlob: completedRecording.blob, ext: completedRecording.ext, cropRegion: null });
    clearCompletedRecording();
  }, [completedRecording, clearCompletedRecording]);

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
      setProcessingStatus('No video loaded. Upload a video or paste a YouTube URL first.');
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
      setProcessingStatus('No swings detected. Play the video first, or enable Skeleton tool for AI-based detection.');
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
      setProcessingStatus('No swings detected yet. Enable Skeleton tool and play the video first.');
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
      setProcessingStatus('No skeleton frames available. Play the video with Skeleton tool enabled first.');
      return;
    }
    const { extractRacketTrail } = await import('@/lib/racketMultiplier');
    const swing = swings[swingIdx];
    const trail = extractRacketTrail(frames, swing.startTime, swing.endTime);
    if (trail.positions.length === 0) {
      setProcessingStatus('No wrist positions found in this swing segment.');
      return;
    }
    canvasRef.current?.setRacketTrail(trail);
  }, []);

  // ── Object Multiplier ─────────────────────────────────────────────────────
  const handleObjMultiplierCapture = useCallback(async () => {
    const region = canvasRef.current?.getObjMultiplierRegion();
    if (!region) {
      setProcessingStatus('Draw a rectangle on the video first to select a region.');
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
      setProcessingStatus('Object multiplier capture failed. Try again.');
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
              console.warn('[AngleMotion capture] MP4 conversion failed:', convErr);
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
    a.download = `angle-motion-capture.${ext}`;
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
      fd.append('video', new File([blob], `angle-motion-capture.${ext}`, { type: mime }));
      fd.append('title', `AngleMotion analysis ${localDateTimeForFolder()}`);
      const res = await fetch('/api/youtube/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setCaptureYoutubeUrl(typeof data.url === 'string' ? data.url : null);
      setShowCaptureSaveToast(false);
      setCaptureSaveModalOpen(true);
    } catch (e: unknown) {
      setProcessingStatus(e instanceof Error ? e.message : 'YouTube upload failed');
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
    resetMetrics();
  }, [applyMarkupToTargets, softClearStroMotion, resetMetrics]);

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
      // Self-heal "B plays but A never starts": whatever blocked A's own play,
      // retry it once; if it still refuses, stop B too — the pair either plays
      // together or not at all (never one-sided).
      window.setTimeout(() => {
        const a = videoRef.current, b = videoRefB.current;
        if (!a || !b) return;
        if (a.paused && !b.paused) {
          a.play().catch(() => {
            b.pause();
            setProcessingStatus('Could not start synced playback — press play again');
          });
        }
      }, 250);
    } else if (t < 0) {
      vB.currentTime = 0;
      vB.pause();
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
    // Unconditional — see onPauseA: the paused-guard skipped the pause while a
    // play() promise was pending, leaving B running after Stop.
    vB.pause();
  }, [playBothEnabled, videoBLoaded, videoBDuration]);

  const analysisTimelineExtras = useMemo(() => {
    const stroFrameStopMarkers = stroMotionActive && stroMotionHtml5Only && stroMotionDraft?.frames.length
      ? stroMotionDraft.frames.map((f) => ({
            id: `stro-stop-${f.index}`,
            time: f.timeSec,
            label: String(f.index + 1),
          }))
      : null;

    // Snapshot phase markers (green balls) — shown whenever snapshots exist and
    // we are not in StroMotion mode. Migrated off the removed frame workflow so
    // the Snapshot architecture owns the timeline markers directly.
    if (!stroMotionActive && stroMotionHtml5Only && (biomechPhaseMarkers || skeletonEnabled)) {
      return {
        // Draggable start/end handles delimiting the section the Metrics replay/
        // recording travels over — and, when the skeleton is on, the range the
        // Precision AI Track pass covers. Each handle moves independently and
        // the timeline does not re-zoom.
        trimRange: (metricsSectionStart != null && metricsSectionEnd != null)
          ? { start: metricsSectionStart, end: metricsSectionEnd } as { start: number; end: number }
          : null,
        onTrimChange: (start: number, end: number) => { setMetricsSectionStart(start); setMetricsSectionEnd(end); },
        trimAccent: '#34C759',
        onCurrentTime: undefined as undefined,
        phaseMarkers: biomechPhaseMarkers,
        selectedPhaseMarkerId: biomechSelectedPhaseId,
        onPhaseMarkerSelect: (id: string) => selectSnapshot(id),
        onPhaseMarkerChange: (id: string, time: number) => {
          setSnapshots(prev => prev.map(s => s.id === id ? { ...s, timeSec: time } : s));
        },
        phaseMarkerBounds: null as null,
        sampleMarkers: null as null,
        onSampleMarkerSelect: undefined,
        onSampleMarkerChange: undefined,
        sampleMarkerBounds: null as null,
        defaultZoomToTrim: false,
      };
    }
    if (stroMotionActive && stroMotionHtml5Only) {
      return {
        trimRange: stroMotionDraft?.frames.length ? { start: stroStartFrame, end: stroEndFrame } as { start: number; end: number } : null,
        // Coach can drag the section start/end handles on the timeline.
        onTrimChange: (start: number, end: number) => { setStroStartFrame(start); setStroEndFrame(end); },
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
      onTrimChange: undefined as undefined,
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
    biomechPhaseMarkers,
    biomechSelectedPhaseId,
    selectSnapshot,
    stroMotionActive,
    stroMotionHtml5Only,
    stroMotionDraft,
    stroStartFrame,
    stroEndFrame,
    stroEffectiveSampleTimes,
    seekStroVideo,
    updateStroFrameTime,
    setStroActiveFrameIndex,
    metricsSectionStart,
    metricsSectionEnd,
    skeletonEnabled,
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
onTrimChange={analysisTimelineExtras.onTrimChange}
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
onTrimChange={analysisTimelineExtras.onTrimChange}
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
    skeletonShowHeadDirection,
    onSkeletonShowHeadDirectionChange: setSkeletonShowHeadDirection,
    skeletonShowFootLine,
    onSkeletonShowFootLineChange:    setSkeletonShowFootLine,
    precisionTrackState,
    onPrecisionTrack:                (scope: 'all' | 'section') => { void handlePrecisionTrack(scope); },
    onPrecisionTrackClear:           handlePrecisionTrackClear,
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
    authContent: <AuthButton iconOnly={compactToolbarRail} />,
    onNavigate: (screen) => {
      if (screen === 'stromotion') {
        setStroMotionActive(true);
        // Import phase markers as StroMotion frame times ONLY if phases exist
        // Do NOT create default frames — user must explicitly add phases first
        if (biomechPhaseMarkers && biomechPhaseMarkers.length > 0) {
          const phaseTimes = biomechPhaseMarkers.map(m => m.time).sort((a, b) => a - b);
          const first = phaseTimes[0];
          const last = phaseTimes[phaseTimes.length - 1];
          if (first < last) {
            const count = Math.min(phaseTimes.length, 15);
            setStroStartFrame(Math.max(0, first - 0.5));
            setStroEndFrame(last + 0.5);
            setStroFrameCount(count as any);
            setStroSampleTimesOverride(phaseTimes.slice(0, 15));
            setProcessingStatus(`Imported ${count} phase markers as StroMotion frames`);
          }
        }
        // Auto-detect: if skeleton data exists, try auto-selecting areas for all frames
        setTimeout(() => {
          const draft = stroMotionDraft;
          if (!draft?.frames.length) return;
          const skFrames = canvasRef.current?.getSkeletonFrames?.() ?? [];
          if (skFrames.length < 3) return;
          const unselected = draft.frames.filter(f => !f.selectionBox);
          if (unselected.length > 0) {
            setProcessingStatus(`AI auto-detecting player in ${unselected.length} frames...`);
            (async () => {
              for (const frame of unselected) {
                await autoSelectStroFrameFromSkeleton(frame.index);
              }
              setProcessingStatus('AI detection complete — verify and adjust each frame');
            })();
          }
        }, 500);
      } else if (screen === 'aimetrics') {
        setStroMotionActive(false);
      } else if (screen === 'skeleton') {
        handleToolChange('skeleton');
        setSkeletonOverlayPaused(false);
        setSkeletonKeepAlive(true);
        canvasRef.current?.resetSkeleton();
        setSkeletonWaitingForClick(false);
        setSkeletonLocked(false);
        skeletonFirstDetectedRef.current = false;
        // Skeleton does NOT create a snapshot — it modifies the active one.
      } else if (screen === 'home') {
        setStroMotionActive(false);
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
    dataColumnActive,
    skeletonLocked,
    onSkeletonLockToggle:            () => { setSkeletonLocked(false); setSkeletonWaitingForClick(true); canvasRef.current?.setSkeletonWaitingForClick(true); setProcessingStatus('Click on the player to refocus skeleton'); },
    // Data Column is a LIVE display toggle only. It never creates a snapshot —
    // snapshots come only from Create Snapshot / AI Detect (spec §4).
    onDataColumnToggle:              () => { setDataColumnActive(v => !v); },
    onUndoMeasurement:               () => {
      setMeasurementColumn(prev => {
        const last = prev[prev.length - 1];
        if (last?.type === 'arrowAngle' || last?.type === 'angle' || last?.type === 'differential' || last?.type === 'ruler') {
          const aiTypes = new Set(['angle', 'arrowAngle', 'differential', 'ruler']);
          const nonAi = prev.filter(m => !aiTypes.has(m.type));
          setShowMeasurementOverlays(false);
          return nonAi;
        }
        return prev.slice(0, -1);
      });
    },
    onClearMeasurements:             () => { setMeasurementColumn([]); setProcessingStatus('Data column cleared'); },
    onAddNote:                       () => {
      const label = prompt('Label (left side):');
      if (!label?.trim()) return;
      const valueStr = prompt('Value (right side, leave empty for text-only):');
      const numVal = valueStr ? parseFloat(valueStr) : 0;
      const unit = valueStr && !isNaN(numVal) ? (prompt('Unit (°, px, m, etc):') ?? '') : '';
      setMeasurementColumn(prev => [...prev, {
        id: `note-${Date.now()}`,
        label: label.trim(),
        value: isNaN(numVal) ? 0 : numVal,
        unit: unit,
        type: 'note',
      }]);
    },
    measurementColumnItems:          measurementColumn,
    onDeleteMeasurement:             (id: string) => setMeasurementColumn(prev => prev.filter(m => m.id !== id)),
    onOpenPhases:                    () => { createSnapshotFromLive(); },
    onMetricsGenerate:               () => { void handleGenerateSnapshots(); },
    onAutoDetectMeasurements:        async () => {
      // Prefer the Precision-AI-Track pose at the CURRENT frame (video-time
      // exact); fall back to the latest live detection.
      const bakedKps = videoRef.current ? canvasRef.current?.getBakedPoseAt?.(videoRef.current.currentTime) ?? null : null;
      const skFrames = canvasRef.current?.getSkeletonFrames?.() ?? [];
      if (!bakedKps && skFrames.length === 0) { setProcessingStatus('Enable Skeleton and play the video first'); return; }
      const latest = skFrames[skFrames.length - 1];
      let kps = bakedKps ?? latest?.keypoints;
      if (!kps?.length) { setProcessingStatus('No skeleton detected — ensure tracking the player'); return; }
      // Enrich with REAL foot keypoints (MediaPipe heel + toe) when the pose has
      // none — one-shot on the current frame, time-boxed so AI Detect never hangs.
      if (skeletonShowFootLine && videoRef.current && !kps.some((k) => k?.name === 'left_foot_index' || k?.name === 'right_foot_index')) {
        try {
          setProcessingStatus('Detecting feet…');
          const feet = await Promise.race([
            import('@/lib/mediapipePose').then((m) => m.detectFeetOnFrame(videoRef.current!)),
            new Promise<null>((res) => setTimeout(() => res(null), 2000)),
          ]);
          if (feet) {
            const { footPointsToKeypoints } = await import('@/lib/mediapipePose');
            const extra = footPointsToKeypoints(feet);
            if (extra.length) kps = [...kps, ...extra];
          }
        } catch { /* feet unavailable — the anatomical estimate still applies */ }
      }
      // Capture the LIVE column before snapshot creation (spec §6 step 1).
      const liveCol = scrubRetiredLabels(measurementColumnRef.current.filter(m => m.type !== 'skeleton-angle'));
      // Step 2: compute AI measurements on the frozen pose.
      const { computePhaseMeasurements } = require('@/lib/biomechanics/measurements');
      const meas = computePhaseMeasurements('auto', 'AI Detect', 0, kps);
      const items: typeof measurementColumn = [];
      if (meas.jointAngles.leftElbowDeg != null) items.push({ id: `ai-le-${Date.now()}`, label: 'L Elbow', value: Math.round(meas.jointAngles.leftElbowDeg), unit: '°', type: 'angle' });
      if (meas.jointAngles.rightElbowDeg != null) items.push({ id: `ai-re-${Date.now()}`, label: 'R Elbow', value: Math.round(meas.jointAngles.rightElbowDeg), unit: '°', type: 'angle' });
      if (meas.jointAngles.leftKneeDeg != null) items.push({ id: `ai-lk-${Date.now()}`, label: 'L Knee', value: Math.round(meas.jointAngles.leftKneeDeg), unit: '°', type: 'angle' });
      if (meas.jointAngles.rightKneeDeg != null) items.push({ id: `ai-rk-${Date.now()}`, label: 'R Knee', value: Math.round(meas.jointAngles.rightKneeDeg), unit: '°', type: 'angle' });
      // L/R Foot direction takes the slot the (retired, not-useful) L/R Shoulder
      // joint angles used to occupy. Included only when the Foot line skeleton
      // toggle is ON — AI Detect mirrors what the coach chose to display.
      if (skeletonShowFootLine) {
        if (meas.footDirection.leftFootDeg != null) items.push({ id: `ai-lf-${Date.now()}`, label: 'L Foot', value: Math.round(meas.footDirection.leftFootDeg), unit: '°', type: 'arrowAngle' });
        if (meas.footDirection.rightFootDeg != null) items.push({ id: `ai-rf-${Date.now()}`, label: 'R Foot', value: Math.round(meas.footDirection.rightFootDeg), unit: '°', type: 'arrowAngle' });
      }
      // Shoulder and hip line angles (L→R direction) + differential
      const lShoulder = kps[5], rShoulder = kps[6], lHip = kps[11], rHip = kps[12];
      let shoulderDeg: number | null = null;
      let hipDeg: number | null = null;
      if (lShoulder?.score >= 0.2 && rShoulder?.score >= 0.2) {
        shoulderDeg = Math.round(Math.atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x) * 180 / Math.PI);
        items.push({ id: `ai-sa-${Date.now()}`, label: 'Shoulder (L→R)', value: shoulderDeg, unit: '°', type: 'arrowAngle' });
      }
      if (lHip?.score >= 0.2 && rHip?.score >= 0.2) {
        hipDeg = Math.round(Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x) * 180 / Math.PI);
        items.push({ id: `ai-ha-${Date.now()}`, label: 'Hip (L→R)', value: hipDeg, unit: '°', type: 'arrowAngle' });
      }
      if (shoulderDeg !== null && hipDeg !== null) {
        const diff = Math.abs(shoulderDeg - hipDeg);
        items.push({ id: `ai-shd-${Date.now()}`, label: 'Shoulder-Hip Diff', value: Math.round(diff), unit: '°', type: 'differential' });
      }
      // Head direction — only when its skeleton toggle is ON (mirrors display).
      const nose = kps[0], lEar = kps[3], rEar = kps[4];
      if (skeletonShowHeadDirection && nose?.score >= 0.2 && ((lEar?.score >= 0.2) || (rEar?.score >= 0.2))) {
        const earMidX = lEar?.score >= 0.2 && rEar?.score >= 0.2 ? (lEar.x + rEar.x) / 2 : (lEar?.score >= 0.2 ? lEar.x : rEar!.x);
        const earMidY = lEar?.score >= 0.2 && rEar?.score >= 0.2 ? (lEar.y + rEar.y) / 2 : (lEar?.score >= 0.2 ? lEar.y : rEar!.y);
        const headAngle = Math.round(((Math.atan2(nose.y - earMidY, nose.x - earMidX) * 180 / Math.PI) + 360) % 360);
        items.push({ id: `ai-hd-${Date.now()}`, label: 'Head Direction', value: headAngle, unit: '°', type: 'arrowAngle' });
      }
      if (meas.footSpacing?.distancePx != null) items.push({ id: `ai-fd-${Date.now()}`, label: 'Foot Distance', value: Math.round(meas.footSpacing.distancePx), unit: 'px', type: 'ruler' });
      // Racket angle — REAL detection first (COCO-SSD racket/bat near the dominant
      // wrist → wrist-to-implement-tip line), wrist-extension estimate as fallback.
      const rW = kps[10], lW = kps[9], rE = kps[8], lE = kps[7];
      const bodyCenter = (lShoulder?.score >= 0.2 && rShoulder?.score >= 0.2) ? (lShoulder.x + rShoulder.x) / 2 : 0;
      const domW = (rW?.score >= 0.2 && lW?.score >= 0.2) ? (Math.abs(rW.x - bodyCenter) > Math.abs(lW.x - bodyCenter) ? rW : lW) : (rW?.score >= 0.2 ? rW : lW);
      const domE = (rW?.score >= 0.2 && lW?.score >= 0.2) ? (Math.abs(rW.x - bodyCenter) > Math.abs(lW.x - bodyCenter) ? rE : lE) : (rW?.score >= 0.2 ? rE : lE);
      if (domW?.score >= 0.2) {
        let racketAngle: number | null = null;
        const v = videoRef.current;
        if (v && v.videoWidth > 0) {
          try {
            setProcessingStatus('Detecting racket…');
            const { detectTennisRacketNearHint } = await import('@/lib/racketCocoDetect');
            const vw = v.videoWidth, vh = v.videoHeight;
            const r = 0.14; // search square around the wrist (normalized)
            const hint = {
              x: Math.max(0, domW.x / vw - r), y: Math.max(0, domW.y / vh - r),
              w: Math.min(1, 2 * r), h: Math.min(1, 2 * r),
            };
            // Time-boxed: a cold model download must not hang AI Detect.
            const det = await Promise.race([
              detectTennisRacketNearHint(v, hint),
              new Promise<null>((res) => setTimeout(() => res(null), 2500)),
            ]);
            if (det && det.score >= 0.25) {
              // Implement tip = box point farthest from the wrist (corners + edge midpoints).
              const bx = det.box.x * vw, by = det.box.y * vh, bw = det.box.w * vw, bh = det.box.h * vh;
              const cand = [
                { x: bx, y: by }, { x: bx + bw, y: by }, { x: bx, y: by + bh }, { x: bx + bw, y: by + bh },
                { x: bx + bw / 2, y: by }, { x: bx + bw / 2, y: by + bh }, { x: bx, y: by + bh / 2 }, { x: bx + bw, y: by + bh / 2 },
              ];
              let tip = cand[0], dMax = -1;
              for (const c of cand) { const d = Math.hypot(c.x - domW.x, c.y - domW.y); if (d > dMax) { dMax = d; tip = c; } }
              racketAngle = Math.round(((Math.atan2(tip.y - domW.y, tip.x - domW.x) * 180 / Math.PI) + 360) % 360);
            }
          } catch { /* detection unavailable — fall back below */ }
        }
        // Fallback: dominant elbow→wrist extension.
        if (racketAngle == null && domE?.score >= 0.2) {
          racketAngle = Math.round(((Math.atan2(domW.y - domE.y, domW.x - domE.x) * 180 / Math.PI) + 360) % 360);
        }
        if (racketAngle != null) {
          items.push({ id: `ai-ra-${Date.now()}`, label: 'Racket Angle (est.)', value: racketAngle, unit: '°', type: 'arrowAngle' });
        }
      }
      if (items.length === 0) {
        setProcessingStatus('No measurements detected — ensure skeleton is tracking the player');
        return;
      }

      // Step 1: create the snapshot from LIVE — captures the frame screenshot,
      // drawings, and skeleton, and enters SNAPSHOT mode. (AI Detect captures at
      // creation so Generate stays read-only.)
      const newSnapId = createSnapshotFromLive();
      if (!newSnapId) return;

      // Step 3: inject AI results — captured live column + AI measurements.
      const fullCol = [...liveCol, ...items];
      const skSnapshot = kps.map(k => ({ x: k.x, y: k.y, score: k.score ?? 0, name: k.name ?? '' }));
      const aiDetection: Record<string, number> = {};
      const jointAngles: Record<string, number> = {};
      for (const it of items) {
        if (it.type === 'angle') jointAngles[it.label] = it.value;
        aiDetection[it.label] = it.value;
      }
      setDataColumnActive(true);
      // Step 4: editable traced lines — angle arrows on skeleton joints.
      setShowMeasurementOverlays(true);
      setMeasurementColumn(fullCol);
      // Freeze the exact pose the angles were computed from so overlays align.
      canvasRef.current?.setSkeletonKeypoints?.(skSnapshot, 'snapshot');
      setSnapshots(prev => prev.map(s => s.id === newSnapId ? {
        ...s,
        column: fullCol,
        aiDetection,
        jointAngles,
        skeleton: skSnapshot,
        overlaysOn: true,
      } : s));
      setProcessingStatus(`AI detected ${items.length} measurements`);
    },
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
        getCanvas={getCanvas}
        layoutMode={layoutMode as 'youtube' | 'reels'}
        onLayoutChange={setLayoutMode}
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
  // During StroMotion "Select Area" the rubber-band box is drawn on the overlay
  // canvas; if the native <video> underlay stays on top (zIndex 1) the box is
  // hidden behind it. Paint the video onto the canvas instead so the selection
  // is visible and the click/drag lands on the canvas.
  const useNativeHtml5Video = html5FileUpload && !stroCompositeActive && !stroSelectingObject && !exportForceVideoPaint;
  const paintVideoOnCanvasA = Boolean(
    (html5FileUpload && stroCompositeActive) ||
    (html5FileUpload && stroSelectingObject) ||
    (html5FileUpload && exportForceVideoPaint) ||
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
        className="anglemotion-video-toolbar"
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
      className="anglemotion-analysis-root"
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
              // Always present (0 when unused) — removing the property mid-rerender
              // alongside the `padding` shorthand triggers React style warnings.
              paddingBottom: reelsDesktop && hasVideoBContent ? toolbarBottomReservePx : 0,
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
                  skeletonKeepAlive={skeletonKeepAlive}
                  skeletonLocked={skeletonLocked}
                  skeletonWaitingForClick={skeletonWaitingForClick}
                  onSkeletonFocusSet={() => { setSkeletonWaitingForClick(false); setSkeletonConfirmOpen(false); setSkeletonLocked(true); }}
                  onSkeletonAnglesUpdate={handleSkeletonAnglesUpdate}
                  poseMode={analysisMode.kind}
                  showMeasurementOverlays={showMeasurementOverlays && isNearActivePhase}
                  measurementColumnItems={dataColumnVisible ? measurementColumn : null}
                  measurementColumnTitle={measurementColumnTitle}
                  measurementColumnPos={measurementColumnPos}
                  onMeasurementColumnDrag={setMeasurementColumnPos}
                  onMeasurementColumnRect={setMeasurementColumnRect}
                  columnDeleteMode={columnDeleteMode}
                  onMeasurementItemDelete={(id) => {
                    setMeasurementColumn(prev => {
                      const next = prev.filter(m => m.id !== id);
                      if (next.length === 0) setColumnDeleteMode(false);
                      return next;
                    });
                  }}
                  onMeasurementItemEdit={(id, newValue) => {
                    setMeasurementColumn(prev => prev.map(m =>
                      m.id === id ? { ...m, value: newValue } : m
                    ));
                  }}
                  onOverlayAngleEdit={(overlayId, deg) => {
                    // BUG 1: dragging an AI overlay line updates its column value
                    // (+ the derived Shoulder-Hip Diff). The column→snapshot
                    // auto-save persists it to the active snapshot only.
                    const labelMap: Record<string, string> = {
                      shoulder: 'Shoulder (L→R)', hip: 'Hip (L→R)', head: 'Head Direction',
                      lfoot: 'L Foot', rfoot: 'R Foot', racket: 'Racket Angle (est.)',
                    };
                    const label = labelMap[overlayId];
                    if (!label) return;
                    setMeasurementColumn(prev => {
                      let next = prev.map(m => m.label === label ? { ...m, value: deg } : m);
                      const sh = next.find(m => m.label === 'Shoulder (L→R)')?.value;
                      const hp = next.find(m => m.label === 'Hip (L→R)')?.value;
                      if (sh != null && hp != null) {
                        next = next.map(m => m.label === 'Shoulder-Hip Diff' ? { ...m, value: Math.abs(sh - hp) } : m);
                      }
                      return next;
                    });
                  }}
                  onMeasurementAdd={() => {
                    const label = prompt('Label:');
                    if (!label?.trim()) return;
                    const valStr = prompt('Value (empty for text-only):');
                    const val = valStr ? parseFloat(valStr) : 0;
                    const unit = valStr && !isNaN(val) ? (prompt('Unit (°, px, m):') ?? '') : '';
                    setMeasurementColumn(prev => [...prev, { id: `n-${Date.now()}`, label: label.trim(), value: isNaN(val) ? 0 : val, unit, type: 'note' }]);
                  }}
                  onMeasurementRemoveLast={() => setMeasurementColumn(prev => prev.slice(0, -1))}
                  onMeasurementCommit={(m) => {
                    if (dataColumnVisible) {
                      setPendingMeasurement(m);
                      setPendingMeasurementName(m.type === 'angle' ? 'Angle' : m.type === 'arrowAngle' ? 'Arrow angle' : 'Distance');
                    }
                  }}
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
                  stroMotionGhostOpacity={stroGhostOpacity}
                  stroMotionLayerMode={stroLayerMode}
                  stroMotionEndPlate={stroEndPlate}
                  stroMotionSubjectBox={null}
                  stroMotionFrameStops={stroMotionFrameStopsForCanvas}
                  stroMotionVisibleCount={stroVisibleCount}
                  stroMotionShowSkeleton={stroShowSkeleton}
                  skeletonShowAngles={skeletonShowAngles}
                  skeletonShowHeadLine={skeletonShowHeadLine}
                  skeletonShowHeadDirection={skeletonShowHeadDirection}
                  skeletonShowFootLine={skeletonShowFootLine}
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
                    onMeasurement={(value, unit) => {
                      if (dataColumnActive) {
                        setPendingMeasurement({ type: 'ruler', value, unit });
                        setPendingMeasurementName('Distance');
                      }
                    }}
                  />
                )}
                {/* Data column HTML overlay buttons — anchored to the live
                    canvas-drawn column rect so they track drag + resize exactly. */}
                {dataColumnVisible && measurementColumnRect && (
                  <div style={{
                    position: 'absolute',
                    left: measurementColumnRect.x,
                    top: measurementColumnRect.y + measurementColumnRect.h + 4,
                    zIndex: 15,
                    pointerEvents: 'none',
                  }}>
                    {/* + and − toggle buttons — sit just under the column */}
                    <div style={{
                      display: 'flex', gap: 4, pointerEvents: 'auto',
                    }}>
                      <button type="button" onClick={() => {
                        setColumnDeleteMode(false);
                        const label = prompt('Label:');
                        if (!label?.trim()) return;
                        const valStr = prompt('Value (empty for text-only):');
                        const val = valStr ? parseFloat(valStr) : 0;
                        const unit = valStr && !isNaN(val) ? (prompt('Unit (°, px, m):') ?? '') : '';
                        setMeasurementColumn(prev => [...prev, { id: `n-${Date.now()}`, label: label.trim(), value: isNaN(val) ? 0 : val, unit, type: 'note' }]);
                      }} style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none',
                        background: 'rgba(255,255,255,0.2)', color: '#fff',
                        fontSize: 16, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                      }}>+</button>
                      <button type="button" onClick={() => setColumnDeleteMode(d => !d)} style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none',
                        background: columnDeleteMode ? 'rgba(255,59,48,0.5)' : 'rgba(255,59,48,0.3)',
                        color: '#FF3B30',
                        fontSize: 16, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                      }}>−</button>
                    </div>
                    {columnDeleteMode && (
                      <div style={{ marginTop: 4, fontSize: 10, color: '#FF9F9F', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                        Tap a row to delete
                      </div>
                    )}
                  </div>
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
                      or drag and drop a video file here. See AngleMotion Academy in the Control Panel for import workflows.
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
                      poseMode={analysisMode.kind}
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
                AngleMotion — it only takes a moment.
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
                  {isProposingThisFrame ? 'Removing background…' : 'This frame has no selection yet'}
                </strong>
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                  {isProposingThisFrame
                    ? 'Auto background removal runs on the selected area. The editor opens when ready.'
                    : 'Draw a box around the player with Select Area to isolate them, then the mask editor opens.'}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                  {!isProposingThisFrame && (
                    <button
                      type="button"
                      onClick={() => { setStroEditingFrameIndex(null); handleStroSelectArea(stroEditingFrameIndex); }}
                      style={{
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: '#007AFF', color: '#fff', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      Select Area
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleStroCloseFrameEditor}
                    style={{
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
        frames={stroMotionDraft?.frames.map((f) => ({
          index: f.index,
          label: `F${f.index + 1}`,
          included: !stroExcludedFrames.has(f.index),
        }))}
        onToggleFrame={(i) => {
          const next = new Set(stroExcludedFrames);
          if (next.has(i)) next.delete(i); else next.add(i);
          // Never exclude every frame — the composite needs at least one.
          if (stroMotionDraft && next.size >= stroMotionDraft.frames.length) return;
          setStroExcludedFrames(next);
          void rebuildStroPreview({ excluded: next });
        }}
        videoOrder={stroVideoOrder}
        onVideoOrderChange={(o) => {
          setStroVideoOrder(o);
          clearStroVideoPreview();
          void rebuildStroPreview({ videoOrder: o });
        }}
        ghostOpacity={stroGhostOpacity}
        onGhostOpacityChange={(v) => {
          setStroGhostOpacity(v);
          clearStroVideoPreview();
          void rebuildStroPreview({ opacity: { value: v } });
        }}
        videoSpeed={stroVideoSpeed}
        onVideoSpeedChange={(s) => {
          setStroVideoSpeed(s);
          clearStroVideoPreview();
        }}
        layerMode={stroLayerMode}
        onLayerModeChange={(m) => {
          setStroLayerMode(m);
          clearStroVideoPreview();
        }}
        videoBlob={stroPreviewVideoBlobRef.current}
        settingsLines={[
          `Frames: ${stroMotionDraft?.frames.length ?? 0}${stroExcludedFrames.size > 0 ? ` (${(stroMotionDraft?.frames.length ?? 0) - stroExcludedFrames.size} included in still image)` : ''}`,
          `Direction: ${stroVideoOrder}`,
          `Ghost layers: ${stroLayerMode === 'appear' ? 'Build up' : stroLayerMode === 'vanish' ? 'Fade behind' : 'All on'}`,
          `Ghost transparency: ${stroGhostOpacity !== undefined ? `${Math.round(stroGhostOpacity * 100)}%` : 'Auto'}`,
          `Video speed: ${stroVideoSpeed}×`,
          `Background: ${stroBackground} frame`,
          `Clip: ${stroStartFrame.toFixed(2)}s – ${stroEndFrame.toFixed(2)}s`,
        ]}
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
            {screenshotSaving ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                borderRadius: 10, background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.3)',
              }}>
                <span className="animate-spin" style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: '2px solid rgba(0,122,255,0.3)', borderTopColor: '#007AFF',
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#007AFF' }}>
                  Saving… this takes a few seconds (upload + player record + Google Doc).
                </span>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: '#6E6E73' }}>
                Save to a player's docs, create a new player, or download directly.
              </p>
            )}
            {/* Create new player inline */}
            {!screenshotNewPlayerName && (
              <button type="button" onClick={() => setScreenshotNewPlayerName(' ')} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10,
                border: '1px dashed #007AFF', background: 'rgba(0,122,255,0.04)',
                color: '#007AFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%',
              }}>
                <Plus size={16} /> Create new player
              </button>
            )}
            {screenshotNewPlayerName !== null && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" placeholder="Player name..." autoFocus
                  value={screenshotNewPlayerName.trim() ? screenshotNewPlayerName : ''}
                  onChange={e => setScreenshotNewPlayerName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && screenshotNewPlayerName.trim()) handleScreenshotCreateAndSave(); }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D1D6', fontSize: 13 }}
                />
                <button type="button" disabled={!screenshotNewPlayerName.trim() || screenshotSaving}
                  onClick={handleScreenshotCreateAndSave}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#007AFF', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            )}
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

      {/* Measurement naming prompt */}
      {pendingMeasurement && createPortal(
        <div style={{
          position: 'fixed', bottom: 140, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9500, background: '#1D1D1F', borderRadius: 16,
          padding: '16px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', gap: 10, width: 280,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              {pendingMeasurement.value}{pendingMeasurement.unit}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{pendingMeasurement.type}</span>
          </div>
          <input
            type="text"
            placeholder="Name this measurement..."
            value={pendingMeasurementName}
            onChange={e => setPendingMeasurementName(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && pendingMeasurementName.trim()) {
                setMeasurementColumn(prev => [...prev, {
                  id: `m-${Date.now()}`,
                  label: pendingMeasurementName.trim(),
                  value: pendingMeasurement.value,
                  unit: pendingMeasurement.unit,
                  type: pendingMeasurement.type,
                }]);
                setPendingMeasurement(null);
                setPendingMeasurementName('');
              }
            }}
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => {
              if (pendingMeasurementName.trim()) {
                setMeasurementColumn(prev => [...prev, {
                  id: `m-${Date.now()}`,
                  label: pendingMeasurementName.trim(),
                  value: pendingMeasurement.value,
                  unit: pendingMeasurement.unit,
                  type: pendingMeasurement.type,
                }]);
              }
              setPendingMeasurement(null);
              setPendingMeasurementName('');
            }} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: '#007AFF', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Add to column
            </button>
            <button type="button" onClick={() => { setPendingMeasurement(null); setPendingMeasurementName(''); }} style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer',
            }}>
              Skip
            </button>
          </div>
          {/* Differential: if there's a previous arrowAngle in the column, offer to compute difference */}
          {pendingMeasurement.type === 'arrowAngle' && measurementColumn.some(m => m.type === 'arrowAngle') && (() => {
            const lastAngle = [...measurementColumn].reverse().find(m => m.type === 'arrowAngle');
            if (!lastAngle) return null;
            const diff = Math.abs(pendingMeasurement.value - lastAngle.value);
            return (
              <button type="button" onClick={() => {
                setMeasurementColumn(prev => [
                  ...prev,
                  { id: `m-${Date.now()}-a`, label: pendingMeasurementName.trim() || 'Angle 2', value: pendingMeasurement.value, unit: '°', type: 'arrowAngle' },
                  { id: `m-${Date.now()}-d`, label: `${lastAngle.label} ↔ ${pendingMeasurementName.trim() || 'Angle 2'} diff`, value: Math.round(diff), unit: '°', type: 'differential' },
                ]);
                setPendingMeasurement(null);
                setPendingMeasurementName('');
              }} style={{
                width: '100%', padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#5856D6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                Differential with "{lastAngle.label}": {Math.round(diff)}°
              </button>
            );
          })()}
        </div>,
        document.body,
      )}

      {/* Skeleton confirmation popup */}
      {skeletonConfirmOpen && createPortal(
        <div
          style={{
            position: 'fixed', bottom: 140, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9500, background: '#1D1D1F', borderRadius: 16,
            padding: '16px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            maxWidth: 320, width: '90%',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', textAlign: 'center' }}>
            Is the skeleton over the player?
          </span>
          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <button
              type="button"
              onClick={() => { setSkeletonConfirmOpen(false); setSkeletonWaitingForClick(false); setSkeletonLocked(true); canvasRef.current?.setSkeletonWaitingForClick(false); }}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: '#34C759', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Yes ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setSkeletonConfirmOpen(false);
                setSkeletonLocked(false);
                setSkeletonWaitingForClick(true);
                canvasRef.current?.setSkeletonWaitingForClick(true);
                setProcessingStatus('Click on the player to focus the skeleton');
              }}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: '#FF3B30', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              No — click player
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Waiting for click indicator */}
      {skeletonWaitingForClick && createPortal(
        <div
          style={{
            position: 'fixed', bottom: 140, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9500, background: '#007AFF', borderRadius: 12,
            padding: '10px 12px 10px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            👆 Click the player to aim — adjust as often as you like
          </span>
          <button
            type="button"
            onClick={() => {
              // Explicit confirm: the ONLY way to exit the click-to-focus session.
              setSkeletonWaitingForClick(false);
              setSkeletonLocked(true);
              canvasRef.current?.setSkeletonWaitingForClick(false);
              setProcessingStatus('Skeleton locked on player');
            }}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', background: '#fff',
              color: '#007AFF', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Lock ✓
          </button>
        </div>,
        document.body,
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
      {/* Recording engine + floating Play/Pause/Stop widget are GLOBAL now
          (RecordingProvider + FloatingRecordingIndicator in app/layout.tsx) —
          they survive navigation to any page, so nothing to mount here. */}

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

      {snapshotPanelOpen && (
        <React.Suspense fallback={null}>
          <SnapshotScrollPanel
            snapshots={orderedSnapshots}
            activeIndex={replayIndex}
            replaying={replayActive || generateRecording}
            videoUrl={generateVideoUrl}
            onSelectIndex={(i) => { const s = orderedSnapshots[i]; if (s) selectSnapshot(s.id); }}
            onDeleteIndex={(i) => { const s = orderedSnapshots[i]; if (s) deleteSnapshot(s.id); }}
            onReplay={() => { void recordReplayToMp4(); }}
            onDownloadVideo={() => {
              if (!generateVideoUrl) return;
              const a = document.createElement('a');
              a.href = generateVideoUrl;
              a.download = `anglemotion-replay-${Date.now()}.mp4`;
              a.click();
            }}
            onClose={() => { replayAbortRef.current = true; setSnapshotPanelOpen(false); }}
          />
        </React.Suspense>
      )}

      {generateWorkspaceMounted && (
        <React.Suspense fallback={null}>
          <GenerateWorkspace
            open={generateWorkspaceOpen}
            hidden={replayActive || generateRecording}
            onClose={() => setGenerateWorkspaceOpen(false)}
            snapshots={orderedSnapshots}
            videoUrl={generateVideoUrl}
            videoBlob={generateVideoBlob}
            recording={generateRecording}
            replaying={replayActive}
            playbackRate={generateReplayRate}
            onPlaybackRateChange={setGenerateReplayRate}
            holdSeconds={generateHoldSec}
            onHoldSecondsChange={setGenerateHoldSec}
            onReplay={(ids) => { void handleWorkspaceReplay(ids); }}
            onRecordVideo={(ids) => { void recordReplayToMp4(ids); }}
          />
        </React.Suspense>
      )}

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
