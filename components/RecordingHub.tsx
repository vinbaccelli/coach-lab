'use client';

/**
 * RecordingHub — panel opened from the left toolbar.
 * All state lives in page.tsx; this component is presentational.
 */

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Video,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  ChevronLeft,
  Monitor,
  UploadCloud,
  LayoutGrid,
  Image as ImageIcon,
  PanelLeftOpen,
  PanelLeftClose,
  Crop,
} from 'lucide-react';
import ScreenRecorder from '@/components/ScreenRecorder';
import { RegionRecordOverlay, type ViewportRegion } from '@/components/RegionRecordOverlay';

export interface RecordingHubContentProps {
  isRecording: boolean;
  onRecordingChange: (v: boolean) => void;
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  getMicStream: () => MediaStream | null;
  getCropRegion: () => { x: number; y: number; w: number; h: number } | null;
  layoutMode: 'youtube' | 'reels';
  onScreenRecordComplete?: (blob: Blob, ext: string) => void;

  webcamActive: boolean;
  onWebcamToggle: () => void;
  micActive: boolean;
  micMuted: boolean;
  onMicToggle: () => void;

  onLayoutChange: (mode: 'youtube' | 'reels') => void;
  onScreenshotEntireScreen: () => void;
  onScreenshotVideoOnly: () => void;

  onFileDropped: (file: File, target: 'A' | 'B') => void;

  hubCaptureLoading: boolean;
  hubCaptureTarget: 'A' | 'B' | null;
  hubCaptureIsActive: boolean;
  onHubCaptureCancel: () => void;
  captureDownloadStatus: 'idle' | 'preparing' | 'ready_mp4' | 'ready_webm';
  onDownloadCapture: () => void;
  onDismissCaptureDownload: () => void;

  screenRecordDownloadPending?: boolean;
  onScreenRecordDownloadYes?: () => void;
  onScreenRecordDownloadNo?: () => void;
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

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#9CA3AF',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '14px 0 6px',
};

const DIVIDER: React.CSSProperties = {
  height: 1,
  background: '#F0EDE8',
  margin: '6px 0',
};

function rowStyle(active?: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '9px 10px',
    borderRadius: 10,
    border: active ? '1px solid #35679A' : '1px solid #E8E6E1',
    background: active ? 'rgba(53,103,154,0.08)' : '#FAF8F5',
    color: active ? '#35679A' : '#1A1A1A',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left' as const,
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
    background: active ? 'rgba(53,103,154,0.08)' : '#FAF8F5',
    color: active ? '#35679A' : '#1A1A1A',
    cursor: 'pointer',
    touchAction: 'manipulation',
    flexShrink: 0,
  };
}

function SectionLabel({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  if (hidden) return null;
  return <div style={SECTION_LABEL}>{children}</div>;
}

function HubRow({
  active,
  onClick,
  icon,
  label,
  iconOnly,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  iconOnly?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      style={iconOnly ? iconOnlyRowStyle(active) : rowStyle(active)}
      onClick={onClick}
    >
      {icon}
      {iconOnly ? null : label}
    </button>
  );
}

export function RecordingHubContent(props: RecordingHubContentProps) {
  const {
    onRecordingChange,
    getCanvas,
    getWebcamStream,
    getMicStream,
    getCropRegion,
    layoutMode,
    onScreenRecordComplete,
    webcamActive,
    onWebcamToggle,
    micActive,
    micMuted,
    onMicToggle,
    onLayoutChange,
    onScreenshotEntireScreen,
    onScreenshotVideoOnly,
    onFileDropped,
    hubCaptureLoading,
    hubCaptureTarget,
    hubCaptureIsActive,
    onHubCaptureCancel,
    captureDownloadStatus,
    onDownloadCapture,
    onDismissCaptureDownload,
    screenRecordDownloadPending,
    onScreenRecordDownloadYes,
    onScreenRecordDownloadNo,
    hubIconOnly = false,
    hubLabelsExpanded = false,
    onToggleHubLabels,
  } = props;

  const [isDragOver, setIsDragOver] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);
  const [pendingDropFile, setPendingDropFile] = useState<File | null>(null);
  const [regionOverlayOpen, setRegionOverlayOpen] = useState(false);
  const [regionAspect, setRegionAspect] = useState<'16:9' | '9:16'>(layoutMode === 'reels' ? '9:16' : '16:9');
  const [viewportRegion, setViewportRegion] = useState<ViewportRegion>({ x: 0, y: 0, w: 320, h: 568 });

  const handleDropZoneFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('video/')) return;
    setPendingDropFile(file);
  };

  const confirmDropTarget = (slot: 'A' | 'B') => {
    if (!pendingDropFile) return;
    onFileDropped(pendingDropFile, slot);
    setPendingDropFile(null);
  };

  const compactStackStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: '100%',
  };

  const layoutRows = (
    <>
      <HubRow
        active={layoutMode === 'youtube'}
        iconOnly={hubIconOnly}
        icon={<LayoutGrid size={16} />}
        label="16:9"
        title="16:9 layout"
        onClick={() => onLayoutChange('youtube')}
      />
      <HubRow
        active={layoutMode === 'reels'}
        iconOnly={hubIconOnly}
        icon={<LayoutGrid size={16} />}
        label="9:16"
        title="9:16 layout"
        onClick={() => onLayoutChange('reels')}
      />
    </>
  );

  const recordBlock = (
    <div
      data-tour-id="tour-record-screen"
      style={{
        padding: hubIconOnly ? 0 : 12,
        borderRadius: 12,
        border: hubIconOnly ? 'none' : '1px solid rgba(255,255,255,0.25)',
        background: hubIconOnly ? 'transparent' : 'rgba(255,255,255,0.08)',
        marginBottom: hubIconOnly ? 0 : 8,
        display: 'flex',
        flexDirection: 'column',
        gap: hubIconOnly ? 4 : 10,
        alignItems: hubIconOnly ? 'center' : undefined,
        width: '100%',
      }}
    >
      {hubIconOnly ? null : (
        <p style={{ margin: 0, fontSize: 12, color: '#4B5563', lineHeight: 1.45 }}>
          Full display records your entire screen (like Google Meet). Selected area crops to a movable frame.
        </p>
      )}
      {hubIconOnly ? (
        <>
          <ScreenRecorder
            mode="display"
            compactIcon
            getCanvas={getCanvas}
            getWebcamStream={getWebcamStream}
            getMicStream={getMicStream}
            getCropRegion={getCropRegion}
            layoutMode={layoutMode}
            onRecordingChange={onRecordingChange}
            promptDownload
            onRecordingComplete={onScreenRecordComplete}
          />
          <button
            type="button"
            title="Select area to record"
            aria-label="Select area to record"
            style={{
              ...iconOnlyRowStyle(regionOverlayOpen),
            }}
            onClick={() => setRegionOverlayOpen((v) => !v)}
          >
            <Crop size={16} />
          </button>
          {regionOverlayOpen ? (
            <ScreenRecorder
              mode="display"
              compactIcon
              getCanvas={getCanvas}
              getWebcamStream={getWebcamStream}
              getMicStream={getMicStream}
              getCropRegion={getCropRegion}
              getViewportCropRegion={() => viewportRegion}
              layoutMode={layoutMode}
              onRecordingChange={onRecordingChange}
              promptDownload
              onRecordingComplete={onScreenRecordComplete}
            />
          ) : null}
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>Full screen</div>
            <ScreenRecorder
              mode="display"
              getCanvas={getCanvas}
              getWebcamStream={getWebcamStream}
              getMicStream={getMicStream}
              getCropRegion={getCropRegion}
              layoutMode={layoutMode}
              onRecordingChange={onRecordingChange}
              promptDownload
              onRecordingComplete={onScreenRecordComplete}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>Selected area</div>
            <button
              type="button"
              style={{ ...rowStyle(regionOverlayOpen), marginBottom: 8 }}
              onClick={() => setRegionOverlayOpen((v) => !v)}
            >
              <Crop size={16} />
              {regionOverlayOpen ? 'Hide area frame' : 'Set recording area'}
            </button>
            {regionOverlayOpen ? (
              <ScreenRecorder
                mode="display"
                getCanvas={getCanvas}
                getWebcamStream={getWebcamStream}
                getMicStream={getMicStream}
                getCropRegion={getCropRegion}
                getViewportCropRegion={() => viewportRegion}
                layoutMode={layoutMode}
                onRecordingChange={onRecordingChange}
                promptDownload
                onRecordingComplete={onScreenRecordComplete}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes hubSpin { to { transform: rotate(360deg); } }
        @keyframes hubPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
      {regionOverlayOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <RegionRecordOverlay
            aspect={regionAspect}
            onAspectChange={setRegionAspect}
            region={viewportRegion}
            onRegionChange={setViewportRegion}
            onClose={() => setRegionOverlayOpen(false)}
          />,
          document.body,
        )}
      <div data-tour-id="recording-hub">
        {hubIconOnly ? (
          <div style={compactStackStyle}>
            {onToggleHubLabels ? (
              <HubRow
                iconOnly
                icon={hubLabelsExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                label={hubLabelsExpanded ? 'Collapse labels' : 'Expand labels'}
                title={hubLabelsExpanded ? 'Collapse labels' : 'Expand labels'}
                onClick={onToggleHubLabels}
              />
            ) : null}
            {layoutRows}
            <HubRow
              active={webcamActive}
              iconOnly
              icon={webcamActive ? <CameraOff size={16} /> : <Camera size={16} />}
              label={webcamActive ? 'Webcam on' : 'Webcam off'}
              onClick={onWebcamToggle}
            />
            <HubRow
              active={micActive && !micMuted}
              iconOnly
              icon={micMuted || !micActive ? <MicOff size={16} /> : <Mic size={16} />}
              label={micMuted ? 'Mic muted' : micActive ? 'Mic on' : 'Mic off'}
              onClick={onMicToggle}
            />
            {recordBlock}
          </div>
        ) : (
          <>
            <SectionLabel>Layout</SectionLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <HubRow
                  active={layoutMode === 'youtube'}
                  icon={<LayoutGrid size={16} />}
                  label="16:9"
                  title="16:9 layout"
                  onClick={() => onLayoutChange('youtube')}
                />
              </div>
              <div style={{ flex: 1 }}>
                <HubRow
                  active={layoutMode === 'reels'}
                  icon={<LayoutGrid size={16} />}
                  label="9:16"
                  title="9:16 layout"
                  onClick={() => onLayoutChange('reels')}
                />
              </div>
            </div>
            <div style={DIVIDER} />
            <SectionLabel>Screenshot</SectionLabel>
            <HubRow icon={<Monitor size={16} />} label="Entire screen" onClick={onScreenshotEntireScreen} />
            <HubRow icon={<ImageIcon size={16} />} label="Video frame" onClick={onScreenshotVideoOnly} />
            <div style={DIVIDER} />
            <SectionLabel>Record screen</SectionLabel>
            {recordBlock}
            <div style={DIVIDER} />
            <SectionLabel>Webcam</SectionLabel>
            <div data-tour-id="tour-webcam">
              <HubRow
                active={webcamActive}
                icon={webcamActive ? <CameraOff size={16} /> : <Camera size={16} />}
                label={webcamActive ? 'Webcam on' : 'Webcam off'}
                onClick={onWebcamToggle}
              />
            </div>
            <div style={DIVIDER} />
            <SectionLabel>Microphone</SectionLabel>
            <HubRow
              active={micActive && !micMuted}
              icon={micMuted || !micActive ? <MicOff size={16} /> : <Mic size={16} />}
              label={micMuted ? 'Mic muted' : micActive ? 'Mic on' : 'Mic off'}
              onClick={onMicToggle}
            />
            <div style={DIVIDER} />
            <SectionLabel>Upload video</SectionLabel>
            {uploadSection()}
          </>
        )}
        {hubIconOnly ? null : (
          <>
            {screenRecordDownloadPending && downloadPrompt()}
            {hubCaptureLoading && captureLoading()}
            {!hubCaptureLoading && hubCaptureTarget && !hubCaptureIsActive && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#166534', lineHeight: 1.45 }}>
                Video loaded — recording on the video panel.
              </p>
            )}
            {hubCaptureIsActive && captureActive()}
            {captureDownloadStatus !== 'idle' && captureDownload()}
          </>
        )}
      </div>
    </>
  );

  function uploadSection() {
    return (
      <div data-tour-id="tour-upload">
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#4B5563', lineHeight: 1.5 }}>
          Drop an MP4 from your device, or use Coach Lab Academy for YouTube / Instagram import workflows.
        </p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => dropInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            handleDropZoneFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '18px 12px',
            borderRadius: 12,
            border: `2px dashed ${isDragOver ? '#35679A' : 'rgba(255,255,255,0.35)'}`,
            background: isDragOver ? 'rgba(53,103,154,0.12)' : 'rgba(255,255,255,0.08)',
            cursor: 'pointer',
            marginBottom: 14,
          }}
        >
          <UploadCloud size={22} style={{ color: isDragOver ? '#35679A' : '#9CA3AF' }} />
          <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
            Drop downloaded video here
          </span>
        </div>
        <input
          ref={dropInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleDropZoneFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {pendingDropFile ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: '1px solid #E5E5E5',
              background: '#FAFAFA',
            }}
          >
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
              Load &ldquo;{pendingDropFile.name}&rdquo; into:
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={{ ...rowStyle(), flex: 1, justifyContent: 'center' }}
                onClick={() => confirmDropTarget('A')}
              >
                Left video
              </button>
              <button
                type="button"
                style={{ ...rowStyle(), flex: 1, justifyContent: 'center' }}
                onClick={() => confirmDropTarget('B')}
              >
                Right video
              </button>
            </div>
            <button
              type="button"
              style={{ ...rowStyle(), width: '100%', marginTop: 8, justifyContent: 'center', color: '#6B7280' }}
              onClick={() => setPendingDropFile(null)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function downloadPrompt() {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 12,
          background: '#F0FDF4',
          border: '1px solid #BBF7D0',
          marginBottom: 8,
        }}
      >
        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#166534' }}>
          Download recording as MP4?
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={{ ...rowStyle(), flex: 1, justifyContent: 'center', background: '#16A34A', color: '#fff', border: 'none' }}
            onClick={onScreenRecordDownloadYes}
          >
            Yes
          </button>
          <button
            type="button"
            style={{ ...rowStyle(), flex: 1, justifyContent: 'center' }}
            onClick={onScreenRecordDownloadNo}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  function captureLoading() {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.25)',
          marginBottom: 8,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            border: '2px solid rgba(26,26,26,0.15)',
            borderTopColor: '#1A1A1A',
            borderRadius: '50%',
            animation: 'hubSpin 0.7s linear infinite',
            flexShrink: 0,
          }}
        />
        Loading video…
      </div>
    );
  }

  function captureActive() {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(255,59,48,0.12)',
          border: '1px solid rgba(255,59,48,0.35)',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#FF3B30',
            animation: 'hubPulse 1.2s ease-in-out infinite',
          }}
        />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#FF3B30' }}>Recording…</span>
        <button
          type="button"
          style={{ ...rowStyle(), padding: '6px 10px', fontSize: 12 }}
          onClick={onHubCaptureCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  function captureDownload() {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 12,
          background: '#EFF6FF',
          border: '1px solid #BFDBFE',
          marginBottom: 8,
        }}
      >
        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#1E40AF' }}>
          {captureDownloadStatus === 'preparing' ? 'Preparing download…' : 'Capture ready'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={{ ...rowStyle(), flex: 1, justifyContent: 'center', background: '#2563EB', color: '#fff', border: 'none' }}
            onClick={onDownloadCapture}
            disabled={captureDownloadStatus === 'preparing'}
          >
            Download
          </button>
          <button
            type="button"
            style={{ ...rowStyle(), flex: 1, justifyContent: 'center' }}
            onClick={onDismissCaptureDownload}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
}

/** @deprecated Use RecordingHubContent inside ToolPalette. */
export default function RecordingHub(_props: RecordingHubProps) {
  return null;
}
