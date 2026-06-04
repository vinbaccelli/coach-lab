'use client';

/**
 * RecordingHub — the single, unified recording control surface.
 *
 * One ordered action grid (no nested toolbars, no duplicated controls):
 *   1. Layout 16:9
 *   2. Layout 9:16
 *   3. Screenshot — entire screen
 *   4. Screenshot — video frame
 *   5. Capture mode — entire screen
 *   6. Capture mode — selected area
 *   7. Start / Stop recording (toggle; also a sticky floating Stop while recording)
 *   8. Select recording area (opens metadata-only overlay)
 *   9. Webcam on/off
 *  10. Mic on/off
 *  11. Background removal on/off
 *  12. PiP shape (rectangle / circle)
 *  13. Reset recording settings
 *
 * Recording always captures the FULL screen; selected-area is metadata applied
 * after recording (see PostRecordingCropModal). This component is self-contained:
 * it only needs isRecording, recordingArea, layoutMode + callbacks.
 */

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  MicOff,
  Camera,
  CameraOff,
  Monitor,
  LayoutGrid,
  Image as ImageIcon,
  PanelLeftOpen,
  PanelLeftClose,
  Crop,
  Frame,
  Square,
  Circle,
  Scissors,
  RefreshCw,
  Download,
  X,
} from 'lucide-react';
import ScreenRecorder, { type ScreenRecorderHandle } from '@/components/ScreenRecorder';
import { RegionRecordOverlay, type ViewportRegion } from '@/components/RegionRecordOverlay';
import type { CropAspect } from '@/components/PostRecordingCropModal';
import type { WebcamPipMode } from '@/components/ToolPalette';

export type RecordingArea = { x: number; y: number; width: number; height: number; aspectRatio: CropAspect };

export interface RecordingHubContentProps {
  isRecording: boolean;
  onRecordingChange: (v: boolean) => void;
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  getMicStream: () => MediaStream | null;
  layoutMode: 'youtube' | 'reels';
  onLayoutChange: (mode: 'youtube' | 'reels') => void;
  onScreenRecordComplete?: (blob: Blob, ext: string) => void;

  /** Selected-area metadata (UI only — never affects capture). */
  recordingArea?: RecordingArea | null;
  onRecordingAreaChange?: (area: RecordingArea | null) => void;

  onScreenshotEntireScreen: () => void;
  onScreenshotVideoOnly: () => void;

  webcamActive: boolean;
  onWebcamToggle: () => void;
  micActive: boolean;
  micMuted: boolean;
  onMicToggle: () => void;
  webcamCutout?: boolean;
  onWebcamCutoutChange?: (v: boolean) => void;
  webcamPipMode?: WebcamPipMode;
  onWebcamPipModeChange?: (m: WebcamPipMode) => void;

  /** Clears area + capture mode + layout + webcam + mic state. */
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

function rowStyle(active?: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minWidth: 0,
    padding: '9px 10px',
    borderRadius: 10,
    border: active ? '1px solid #35679A' : '1px solid #E8E6E1',
    background: active ? 'rgba(53,103,154,0.10)' : '#FAF8F5',
    color: active ? '#35679A' : '#1A1A1A',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left' as const,
    overflow: 'hidden',
    touchAction: 'manipulation',
  };
}

function iconOnlyRowStyle(active?: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    minHeight: 36,
    maxHeight: 36,
    padding: 0,
    margin: '0 auto',
    borderRadius: 10,
    border: active ? '1px solid #35679A' : '1px solid #E8E6E1',
    background: active ? 'rgba(53,103,154,0.10)' : '#FAF8F5',
    color: active ? '#35679A' : '#1A1A1A',
    cursor: 'pointer',
    touchAction: 'manipulation',
    flexShrink: 0,
  };
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
        ...(danger ? { color: '#9a3412', borderColor: '#fca5a5', background: '#FFF7ED' } : null),
        ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
      }}
      onClick={disabled ? undefined : onClick}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      {iconOnly ? null : <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
    </button>
  );
}

export function RecordingHubContent(props: RecordingHubContentProps) {
  const {
    onRecordingChange,
    getCanvas,
    getWebcamStream,
    getMicStream,
    layoutMode,
    onLayoutChange,
    onScreenRecordComplete,
    recordingArea,
    onRecordingAreaChange,
    onScreenshotEntireScreen,
    onScreenshotVideoOnly,
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
  } = props;

  const io = hubIconOnly;
  const recorderRef = useRef<ScreenRecorderHandle | null>(null);
  const [screenRecording, setScreenRecording] = useState(false);
  const [areaOverlayOpen, setAreaOverlayOpen] = useState(false);

  const startBlocked = captureBusy && !screenRecording;
  const handleStartStop = () => {
    if (screenRecording) recorderRef.current?.stop();
    else if (!startBlocked) void recorderRef.current?.start();
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
              ...iconOnlyRowStyle(false),
              background: screenRecording ? '#FF3B30' : '#FAF8F5',
              borderColor: screenRecording ? '#FF3B30' : '#E8E6E1',
              color: screenRecording ? '#fff' : '#1A1A1A',
              ...(startBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : null),
            }
          : {
              ...rowStyle(false),
              justifyContent: 'center',
              background: screenRecording ? '#FF3B30' : '#16A34A',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              ...(startBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : null),
            }
      }
    >
      {screenRecording ? (
        <Square size={16} fill="currentColor" />
      ) : (
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: io ? '#FF3B30' : '#fff', display: 'inline-block', flexShrink: 0 }} />
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

      {areaOverlayOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <RegionRecordOverlay
            initialAspect={recordingArea?.aspectRatio ?? (layoutMode === 'reels' ? '9:16' : '16:9')}
            initialRegion={recordingArea ? { x: recordingArea.x, y: recordingArea.y, w: recordingArea.width, h: recordingArea.height } : null}
            onCancel={() => setAreaOverlayOpen(false)}
            onConfirm={(region: ViewportRegion, aspect: CropAspect) => {
              onRecordingAreaChange?.({ x: region.x, y: region.y, width: region.w, height: region.h, aspectRatio: aspect });
              setAreaOverlayOpen(false);
            }}
          />,
          document.body,
        )}

      {/* Sticky floating Stop — always reachable while recording, never inside scroll. */}
      {screenRecording &&
        typeof document !== 'undefined' &&
        createPortal(
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            title="Stop recording and save"
            style={{
              position: 'fixed',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200002,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 20px',
              borderRadius: 999,
              border: 'none',
              background: '#FF3B30',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 10px 30px rgba(255,59,48,0.4)',
            }}
          >
            <Square size={16} fill="currentColor" /> Stop recording
          </button>,
          document.body,
        )}

      <div data-tour-id="recording-hub" style={gridStyle}>
        {io && onToggleHubLabels ? (
          <HubRow
            iconOnly
            icon={hubLabelsExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            label={hubLabelsExpanded ? 'Collapse labels' : 'Expand labels'}
            onClick={onToggleHubLabels}
          />
        ) : null}

        {/* 1–2 Layout */}
        <HubRow active={layoutMode === 'youtube'} iconOnly={io} icon={<LayoutGrid size={16} />} label="16:9" title="16:9 layout" onClick={() => onLayoutChange('youtube')} />
        <HubRow active={layoutMode === 'reels'} iconOnly={io} icon={<LayoutGrid size={16} />} label="9:16" title="9:16 layout" onClick={() => onLayoutChange('reels')} />

        {/* 3–4 Screenshot */}
        <HubRow iconOnly={io} icon={<Monitor size={16} />} label="Screenshot screen" title="Screenshot entire screen" onClick={onScreenshotEntireScreen} />
        <HubRow iconOnly={io} icon={<ImageIcon size={16} />} label="Screenshot frame" title="Screenshot video frame" onClick={onScreenshotVideoOnly} />

        {/* 5 Start / Stop */}
        <div data-tour-id="tour-record-screen" style={{ width: '100%' }}>{startStopButton}</div>

        {/* 8 Select recording area */}
        <HubRow
          active={!!recordingArea || areaOverlayOpen}
          iconOnly={io}
          icon={<Frame size={16} />}
          label={recordingArea ? `Area set (${recordingArea.aspectRatio})` : 'Select area'}
          title="Select recording area"
          onClick={() => setAreaOverlayOpen(true)}
        />

        {/* 9 Webcam */}
        <div data-tour-id="tour-webcam" style={{ width: '100%' }}>
          <HubRow active={webcamActive} iconOnly={io} icon={webcamActive ? <CameraOff size={16} /> : <Camera size={16} />} label={webcamActive ? 'Webcam on' : 'Webcam off'} onClick={onWebcamToggle} />
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
          <HubRow active={!!webcamCutout} iconOnly={io} icon={<Scissors size={16} />} label={webcamCutout ? 'Background removed' : 'Background removal'} title="Webcam background removal" onClick={() => onWebcamCutoutChange(!webcamCutout)} />
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

        {/* Single persistent full-screen recorder, driven by the Start/Stop toggle.
            Always records the full getDisplayMedia stream — no crop params. */}
        <ScreenRecorder
          ref={recorderRef}
          headless
          mode="display"
          disabled={captureBusy}
          getCanvas={getCanvas}
          getWebcamStream={getWebcamStream}
          getMicStream={getMicStream}
          layoutMode={layoutMode}
          onRecordingChange={(v) => {
            setScreenRecording(v);
            onRecordingChange(v);
          }}
          promptDownload
          onRecordingComplete={onScreenRecordComplete}
        />

        {/* Embed / tab-capture feedback (separate feature). */}
        {io ? (
          <>
            {hubCaptureLoading ? (
              <HubRow
                iconOnly
                icon={<span style={{ width: 16, height: 16, border: '2px solid rgba(26,26,26,0.15)', borderTopColor: '#1A1A1A', borderRadius: '50%', animation: 'hubSpin 0.7s linear infinite' }} />}
                label="Loading video… tap to cancel"
                onClick={onHubCaptureCancel}
              />
            ) : null}
            {hubCaptureIsActive ? (
              <HubRow
                iconOnly
                active
                icon={<span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF3B30', animation: 'hubPulse 1.2s ease-in-out infinite' }} />}
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
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF3B30', animation: 'hubPulse 1.2s ease-in-out infinite' }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#FF3B30' }}>Recording…</span>
                <button type="button" style={{ ...rowStyle(), width: 'auto', padding: '6px 10px', fontSize: 12 }} onClick={onHubCaptureCancel}>Cancel</button>
              </FeedbackCard>
            ) : null}
            {captureDownloadStatus !== 'idle' ? (
              <FeedbackCard tone="info">
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1E40AF' }}>{captureDownloadStatus === 'preparing' ? 'Preparing download…' : 'Capture ready'}</span>
                <button type="button" style={{ ...rowStyle(), width: 'auto', padding: '6px 10px', fontSize: 12, background: '#2563EB', color: '#fff', border: 'none' }} onClick={onDownloadCapture} disabled={captureDownloadStatus === 'preparing'}>Download</button>
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
  return <span style={{ width: 18, height: 18, border: '2px solid rgba(26,26,26,0.15)', borderTopColor: '#1A1A1A', borderRadius: '50%', animation: 'hubSpin 0.7s linear infinite', flexShrink: 0 }} />;
}

function FeedbackCard({ children, tone }: { children: React.ReactNode; tone: 'muted' | 'rec' | 'info' }) {
  const bg = tone === 'rec' ? 'rgba(255,59,48,0.10)' : tone === 'info' ? '#EFF6FF' : 'rgba(0,0,0,0.04)';
  const border = tone === 'rec' ? 'rgba(255,59,48,0.35)' : tone === 'info' ? '#BFDBFE' : '#E8E6E1';
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
