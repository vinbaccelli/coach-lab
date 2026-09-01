'use client';

/**
 * RecordingHub — the single, unified recording control surface.
 *
 * One ordered action grid (no nested toolbars, no duplicated controls):
 *   1. Layout toggle (16:9 ↔ 9:16)
 *   2. Screenshot (entire area or select area)
 *   3. Start / Stop recording (toggle; also a sticky floating Stop while recording)
 *   4. Webcam on/off
 *   5. Mic on/off
 *   6. Background removal on/off
 *   7. PiP shape (rectangle / circle)
 *   8. Reset recording settings
 *
 * Recording always captures the FULL screen; crop/trim is chosen after recording
 * (see PostRecordingCropModal).
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  MicOff,
  Camera,
  CameraOff,
  RectangleHorizontal,
  RectangleVertical,
  Image as ImageIcon,
  PanelLeftOpen,
  PanelLeftClose,
  Square,
  Circle,
  RefreshCw,
  Download,
  AlertCircle,
} from 'lucide-react';
import { useRecording } from '@/contexts/RecordingContext';
import { RegionRecordOverlay, type ViewportRegion } from '@/components/RegionRecordOverlay';
import type { WebcamPipMode } from '@/components/ToolPalette';

export interface RecordingHubContentProps {
  // Recording itself is owned by the GLOBAL RecordingProvider (app/layout.tsx)
  // so it survives route navigation; the hub is just its control surface.
  getCanvas: () => HTMLCanvasElement | null;
  layoutMode: 'youtube' | 'reels';
  onLayoutChange: (mode: 'youtube' | 'reels') => void;

  onScreenshotEntireArea: () => void;
  onScreenshotSelectArea: (region: ViewportRegion) => void;

  webcamActive: boolean;
  onWebcamToggle: () => void;
  micActive: boolean;
  micMuted: boolean;
  onMicToggle: () => void;
  webcamCutout?: boolean;
  onWebcamCutoutChange?: (v: boolean) => void;
  webcamPipMode?: WebcamPipMode;
  onWebcamPipModeChange?: (m: WebcamPipMode) => void;

  /** Clears layout + webcam + mic state. */
  onResetRecordingSettings?: () => void;

  // Embed / tab-capture status (separate feature — kept as feedback only).
  hubCaptureLoading: boolean;
  hubCaptureTarget: 'A' | 'B' | null;
  hubCaptureIsActive: boolean;
  onHubCaptureCancel: () => void;
  captureDownloadStatus: 'idle' | 'preparing' | 'ready_mp4' | 'ready_webm';
  onDownloadCapture: () => void;
  onDismissCaptureDownload: () => void;
  /** True while an embed/tab capture is running — blocks starting a screen recording. */
  captureBusy?: boolean;

  /** Compact toolbar: icons only until labels expanded. */
  hubIconOnly?: boolean;
  hubLabelsExpanded?: boolean;
  onToggleHubLabels?: () => void;
  /** Surface recorder errors in the hub UI (required for headless mode on mobile). */
  onRecordingError?: (message: string) => void;
}

/** @deprecated Overlay panel — use RecordingHubContent inside ToolPalette instead. */
export interface RecordingHubProps extends RecordingHubContentProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
  toolbarLeftInset?: number;
  urlTarget: 'A' | 'B';
  onUrlTargetChange: (v: 'A' | 'B') => void;
  onHubCaptureLoad: (url: string, target: 'A' | 'B') => void;
  hubCaptureAwaitingShare: boolean;
  onHubCaptureShare: () => void;
}

function rowStyle(active?: boolean, pressed?: boolean): React.CSSProperties {
  let background = 'var(--cl-bg-panel)';
  let color = 'var(--cl-text-primary)';
  let border = '1px solid var(--cl-border)';
  if (active) {
    background = 'var(--cl-accent)';
    color = 'var(--cl-text-on-fill)';
    border = '1px solid var(--cl-accent)';
  } else if (pressed) {
    background = 'var(--cl-accent-pressed)';
    color = 'var(--cl-accent)';
  }
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minWidth: 0,
    minHeight: 44,
    padding: '9px 10px',
    borderRadius: 10,
    border,
    background,
    color,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left' as const,
    // Labels wrap to two lines instead of being ellipsised on the narrow phone
    // rail (matches ToolPalette's rowBase). minHeight keeps the touch target.
    whiteSpace: 'normal' as const,
    overflowWrap: 'break-word' as const,
    height: 'auto',
    touchAction: 'manipulation',
  };
}

function iconOnlyRowStyle(active?: boolean, pressed?: boolean): React.CSSProperties {
  let background = 'var(--cl-bg-panel)';
  let color = 'var(--cl-text-primary)';
  let border = '1px solid var(--cl-border)';
  if (active) {
    background = 'var(--cl-accent)';
    color = 'var(--cl-text-on-fill)';
    border = '1px solid var(--cl-accent)';
  } else if (pressed) {
    background = 'var(--cl-accent-pressed)';
    color = 'var(--cl-accent)';
  }
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minHeight: 44,
    maxHeight: 44,
    padding: 0,
    margin: '0 auto',
    borderRadius: 10,
    border,
    background,
    color,
    cursor: 'pointer',
    touchAction: 'manipulation',
    flexShrink: 0,
  };
}

function BackgroundRemovalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M6 16 L10 12 L14 15 L18 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <path
        d="M15 17 H21 V23 H15 Z"
        fill="url(#cl-bg-checker)"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <defs>
        <pattern id="cl-bg-checker" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="2" height="2" fill="#D1D1D6" />
          <rect x="2" y="2" width="2" height="2" fill="#D1D1D6" />
          <rect x="2" width="2" height="2" fill="#FFFFFF" />
          <rect y="2" width="2" height="2" fill="#FFFFFF" />
        </pattern>
      </defs>
    </svg>
  );
}

function RecordStartIcon({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--cl-destructive)',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}

function HubRow({
  active,
  onClick,
  icon,
  label,
  iconOnly,
  title,
  disabled,
  danger,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  iconOnly?: boolean;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const base = iconOnly ? iconOnlyRowStyle(active) : rowStyle(active);
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      style={{
        ...base,
        ...(danger ? { color: 'var(--cl-destructive)', borderColor: 'var(--cl-border)', background: 'var(--cl-bg-panel)' } : null),
        ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
        ...(iconOnly ? { overflow: 'hidden' } : null),
      }}
      onClick={disabled ? undefined : onClick}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      {iconOnly ? null : (
        <span
          style={{
            minWidth: 0,
            flex: 1,
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
            lineHeight: 1.25,
          }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

export function RecordingHubContent(props: RecordingHubContentProps) {
  const {
    getCanvas,
    layoutMode,
    onLayoutChange,
    onScreenshotEntireArea,
    onScreenshotSelectArea,
    webcamActive,
    onWebcamToggle,
    micActive,
    micMuted,
    onMicToggle,
    webcamCutout,
    onWebcamCutoutChange,
    webcamPipMode,
    onWebcamPipModeChange,
    onResetRecordingSettings,
    hubCaptureLoading,
    hubCaptureTarget,
    hubCaptureIsActive,
    onHubCaptureCancel,
    captureDownloadStatus,
    onDownloadCapture,
    onDismissCaptureDownload,
    captureBusy = false,
    hubIconOnly = false,
    hubLabelsExpanded = false,
    onToggleHubLabels,
    onRecordingError,
  } = props;

  const io = hubIconOnly;
  // Global recorder — lives in RecordingProvider (app/layout.tsx), so the
  // recording keeps running and the floating widget follows across every route.
  const { recState, startRecording, stopRecording, error: globalRecError } = useRecording();
  const screenRecording = recState === 'recording' || recState === 'paused' || recState === 'stopped';
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
  const [screenshotAreaOpen, setScreenshotAreaOpen] = useState(false);

  // Surface provider errors in the hub UI (and to the page toast, if wired).
  React.useEffect(() => {
    if (globalRecError) {
      setRecorderError(globalRecError);
      onRecordingError?.(globalRecError);
    }
  }, [globalRecError, onRecordingError]);

  const startBlocked = captureBusy && !screenRecording;
  const handleStartStop = () => {
    if (screenRecording) void stopRecording();
    else if (!startBlocked) {
      setRecorderError(null);
      void startRecording();
    }
  };

  const gridStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: io ? 'center' : 'stretch',
    gap: 6,
    width: '100%',
    minWidth: 0,
  };

  const startStopButton = (
    <button
      type="button"
      onClick={handleStartStop}
      disabled={startBlocked}
      title={screenRecording ? 'Stop recording' : startBlocked ? 'Another capture is in progress' : 'Start recording'}
      aria-label={screenRecording ? 'Stop recording' : 'Start recording'}
      style={
        io
          ? {
              ...iconOnlyRowStyle(screenRecording),
              background: 'var(--cl-bg-panel)',
              borderColor: screenRecording ? 'var(--cl-destructive)' : 'var(--cl-border)',
              color: screenRecording ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
              ...(startBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : null),
              ...(screenRecording ? { background: 'var(--cl-destructive)', color: 'var(--cl-text-on-fill)' } : null),
            }
          : {
              ...rowStyle(false),
              justifyContent: 'center',
              background: screenRecording ? 'var(--cl-destructive)' : 'var(--cl-bg-panel)',
              color: screenRecording ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
              border: screenRecording ? 'none' : '1px solid var(--cl-border)',
              fontWeight: 600,
              ...(startBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : null),
            }
      }
    >
      {screenRecording ? (
        <Square size={16} fill="currentColor" />
      ) : (
        <RecordStartIcon size={io ? 14 : 12} />
      )}
      {io ? null : <span>{screenRecording ? 'Stop recording' : 'Start recording'}</span>}
    </button>
  );

  return (
    <>
      <style>{`
        @keyframes hubSpin { to { transform: rotate(360deg); } }
        @keyframes hubPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      `}</style>

      {screenshotModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Screenshot options"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200001,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              background: 'rgba(0,0,0,0.45)',
            }}
            onPointerDown={() => setScreenshotModalOpen(false)}
          >
            <div
              style={{
                width: 'min(360px, 100%)',
                borderRadius: 16,
                background: 'var(--cl-bg-panel)',
                border: '1px solid var(--cl-border)',
                boxShadow: '0 20px 48px rgba(0,0,0,0.18)',
                padding: '18px 16px 16px',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cl-text-primary)', marginBottom: 12 }}>Screenshot</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...rowStyle(), justifyContent: 'center', fontWeight: 600 }}
                  onClick={() => {
                    setScreenshotModalOpen(false);
                    onScreenshotEntireArea();
                  }}
                >
                  Entire area
                </button>
                <button
                  type="button"
                  style={{ ...rowStyle(), justifyContent: 'center', fontWeight: 600 }}
                  onClick={() => {
                    setScreenshotModalOpen(false);
                    setScreenshotAreaOpen(true);
                  }}
                >
                  Select area
                </button>
                <button
                  type="button"
                  style={{ ...rowStyle(), justifyContent: 'center', color: 'var(--cl-text-secondary)' }}
                  onClick={() => setScreenshotModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {screenshotAreaOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <RegionRecordOverlay
            initialAspect={layoutMode === 'reels' ? '9:16' : '16:9'}
            onCancel={() => setScreenshotAreaOpen(false)}
            onConfirm={(region) => {
              setScreenshotAreaOpen(false);
              onScreenshotSelectArea(region);
            }}
          />,
          document.body,
        )}

      {/* No sticky Stop portal here anymore — the GLOBAL floating Play/Pause/
          Stop + timer widget (FloatingRecordingIndicator, app/layout.tsx)
          follows the coach across every page while recording. */}

      <div data-tour-id="recording-hub" className={io ? 'anglemotion-recording-hub--icon-only' : undefined} style={gridStyle}>
        {recorderError ? (
          // The icon-only rail used to show ONLY an AlertCircle here, so on a
          // phone a fatal "screen recording is not supported" read as the button
          // doing nothing at all. The rail is narrow, not silent: show the text
          // too (wrapped), tappable to dismiss, in both layouts.
          <div
            role="alert"
            title={recorderError}
            onClick={() => setRecorderError(null)}
            style={{
              display: 'flex',
              flexDirection: io ? 'column' : 'row',
              alignItems: io ? 'center' : 'flex-start',
              gap: 6,
              width: '100%',
              padding: io ? '8px 4px' : '6px 2px',
              borderRadius: 10,
              border: '1px solid #fca5a5',
              background: '#FFF7ED',
              color: '#9a3412',
              cursor: 'pointer',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <p
              style={{
                margin: 0,
                fontSize: io ? 10 : 11,
                lineHeight: 1.35,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                textAlign: io ? 'center' : 'left',
              }}
            >
              {recorderError}
            </p>
          </div>
        ) : null}
        {io && onToggleHubLabels ? (
          <HubRow
            iconOnly
            icon={hubLabelsExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            label={hubLabelsExpanded ? 'Collapse labels' : 'Expand labels'}
            onClick={onToggleHubLabels}
          />
        ) : null}

        {/* Layout toggle */}
        <HubRow
          iconOnly={io}
          icon={layoutMode === 'youtube' ? <RectangleVertical size={16} /> : <RectangleHorizontal size={16} />}
          label={layoutMode === 'youtube' ? 'Switch to 9:16' : 'Switch to 16:9'}
          title={layoutMode === 'youtube' ? 'Switch to 9:16 layout' : 'Switch to 16:9 layout'}
          onClick={() => onLayoutChange(layoutMode === 'youtube' ? 'reels' : 'youtube')}
        />

        {/* Screenshot */}
        <HubRow
          iconOnly={io}
          icon={<ImageIcon size={16} />}
          label="Screenshot"
          title="Screenshot"
          onClick={() => setScreenshotModalOpen(true)}
        />

        {/* Start / Stop */}
        <div data-tour-id="tour-record-screen" style={{ width: '100%' }}>{startStopButton}</div>

        {/* Webcam */}
        <div data-tour-id="tour-webcam" style={{ width: '100%' }}>
          <HubRow active={webcamActive} iconOnly={io} icon={webcamActive ? <Camera size={16} /> : <CameraOff size={16} />} label={webcamActive ? 'Webcam on' : 'Webcam off'} onClick={onWebcamToggle} />
        </div>

        {/* 10 Mic */}
        <HubRow
          active={micActive && !micMuted}
          iconOnly={io}
          icon={micMuted || !micActive ? <MicOff size={16} /> : <Mic size={16} />}
          label={micMuted ? 'Mic muted' : micActive ? 'Mic on' : 'Mic off'}
          onClick={onMicToggle}
        />

        {/* 11 Background removal */}
        {onWebcamCutoutChange ? (
          <HubRow active={!!webcamCutout} iconOnly={io} icon={<BackgroundRemovalIcon size={16} />} label={webcamCutout ? 'Background removed' : 'Background removal'} title="Webcam background removal" onClick={() => onWebcamCutoutChange(!webcamCutout)} />
        ) : null}

        {/* 12 PiP shape */}
        {onWebcamPipModeChange ? (
          <HubRow
            iconOnly={io}
            icon={webcamPipMode === 'circle' ? <Circle size={16} /> : <Square size={16} />}
            label={webcamPipMode === 'circle' ? 'PiP: circle' : 'PiP: rectangle'}
            title="Webcam PiP shape"
            onClick={() => onWebcamPipModeChange(webcamPipMode === 'circle' ? 'rectangle' : 'circle')}
          />
        ) : null}

        {/* 13 Reset */}
        {onResetRecordingSettings ? (
          <HubRow iconOnly={io} danger icon={<RefreshCw size={16} />} label="Reset recording" title="Reset recording settings" onClick={onResetRecordingSettings} />
        ) : null}

        {/* The recorder engine itself lives in RecordingProvider (app/layout.tsx)
            — nothing to mount here; handleStartStop drives it via context. */}

        {/* Embed / tab-capture feedback (separate feature). */}
        {io ? (
          <>
            {hubCaptureLoading ? (
              <HubRow
                iconOnly
                icon={<span style={{ width: 16, height: 16, border: '2px solid rgba(26,26,26,0.15)', borderTopColor: 'var(--cl-text-primary)', borderRadius: '50%', animation: 'hubSpin 0.7s linear infinite' }} />}
                label="Loading video… tap to cancel"
                onClick={onHubCaptureCancel}
              />
            ) : null}
            {hubCaptureIsActive ? (
              <HubRow
                iconOnly
                active
                icon={<span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--cl-destructive)', animation: 'hubPulse 1.2s ease-in-out infinite' }} />}
                label="Recording… tap to cancel"
                onClick={onHubCaptureCancel}
              />
            ) : null}
            {captureDownloadStatus !== 'idle' ? (
              <HubRow iconOnly active icon={<Download size={16} />} label={captureDownloadStatus === 'preparing' ? 'Preparing download…' : 'Download capture'} onClick={onDownloadCapture} />
            ) : null}
          </>
        ) : (
          <>
            {hubCaptureLoading ? <FeedbackCard tone="muted"><Spinner /> Loading video…</FeedbackCard> : null}
            {!hubCaptureLoading && hubCaptureTarget && !hubCaptureIsActive ? (
              <p style={{ margin: '2px 0', fontSize: 12, color: '#166534', lineHeight: 1.45 }}>Video loaded — recording on the video panel.</p>
            ) : null}
            {hubCaptureIsActive ? (
              <FeedbackCard tone="rec">
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cl-destructive)', animation: 'hubPulse 1.2s ease-in-out infinite' }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--cl-destructive)' }}>Recording…</span>
                <button type="button" style={{ ...rowStyle(), width: 'auto', padding: '6px 10px', fontSize: 12 }} onClick={onHubCaptureCancel}>Cancel</button>
              </FeedbackCard>
            ) : null}
            {captureDownloadStatus !== 'idle' ? (
              <FeedbackCard tone="info">
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1E40AF' }}>{captureDownloadStatus === 'preparing' ? 'Preparing download…' : 'Capture ready'}</span>
                <button type="button" style={{ ...rowStyle(), width: 'auto', padding: '6px 10px', fontSize: 12, background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', border: 'none' }} onClick={onDownloadCapture} disabled={captureDownloadStatus === 'preparing'}>Download</button>
                <button type="button" style={{ ...rowStyle(), width: 'auto', padding: '6px 10px', fontSize: 12 }} onClick={onDismissCaptureDownload}>Dismiss</button>
              </FeedbackCard>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function Spinner() {
  return <span style={{ width: 18, height: 18, border: '2px solid rgba(26,26,26,0.15)', borderTopColor: 'var(--cl-text-primary)', borderRadius: '50%', animation: 'hubSpin 0.7s linear infinite', flexShrink: 0 }} />;
}

function FeedbackCard({ children, tone }: { children: React.ReactNode; tone: 'muted' | 'rec' | 'info' }) {
  const bg = tone === 'rec' ? 'rgba(255,59,48,0.10)' : tone === 'info' ? '#EFF6FF' : 'rgba(0,0,0,0.04)';
  const border = tone === 'rec' ? 'rgba(255,59,48,0.35)' : tone === 'info' ? '#BFDBFE' : 'var(--cl-border)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: bg, border: `1px solid ${border}`, minWidth: 0 }}>
      {children}
    </div>
  );
}

/** @deprecated Use RecordingHubContent inside ToolPalette. */
export default function RecordingHub(_props: RecordingHubProps) {
  return null;
}
