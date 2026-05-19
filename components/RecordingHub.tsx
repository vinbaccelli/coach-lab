'use client';

/**
 * RecordingHub — centralized recording-studio panel.
 *
 * Renders two things:
 *  1. A compact trigger button that lives inline in the header.
 *  2. A fixed slide-in panel (right side on desktop, bottom sheet on mobile)
 *     that aggregates all recording/media controls without duplicating any state.
 *
 * All state lives in page.tsx. This component is purely presentational.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Video,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  X,
  Monitor,
  UploadCloud,
  ExternalLink,
} from 'lucide-react';
import ScreenRecorder from '@/components/ScreenRecorder';
import type { WebcamPipMode } from '@/components/ToolPalette';

export interface RecordingHubProps {
  // ── Panel state ──────────────────────────────────────────────────────
  isOpen: boolean;
  onToggle: () => void;
  /** Rendered inside a narrow (icon-only) context, e.g. reels mobile view. */
  compact?: boolean;
  /** True when rendering over a dark background (reels layout). */
  darkChrome?: boolean;
  /** Whether the coach is on a mobile device (switches panel to bottom sheet). */
  isMobile?: boolean;

  // ── Session recording ────────────────────────────────────────────────
  /** Reflects the ScreenRecorder's active-recording flag (for button badge). */
  isRecording: boolean;
  onRecordingChange: (v: boolean) => void;
  // Passthrough props for the embedded ScreenRecorder instance:
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  getMicStream: () => MediaStream | null;
  getCropRegion: () => { x: number; y: number; w: number; h: number } | null;
  layoutMode: 'youtube' | 'reels';

  // ── Webcam overlay ───────────────────────────────────────────────────
  webcamActive: boolean;
  onWebcamToggle: () => void;
  webcamCutout: boolean;
  onWebcamCutoutChange: (v: boolean) => void;
  webcamOpacity: number;
  onWebcamOpacityChange: (v: number) => void;
  webcamPipMode: WebcamPipMode;
  onWebcamPipModeChange: (mode: WebcamPipMode) => void;

  // ── Microphone ───────────────────────────────────────────────────────
  micActive: boolean;
  onMicToggle: () => void;

  // ── Layout selector ──────────────────────────────────────────────────
  onLayoutChange: (mode: 'youtube' | 'reels') => void;

  // ── Screenshot ───────────────────────────────────────────────────────
  onScreenshot: () => void;

  // ── Load video ───────────────────────────────────────────────────────
  urlInput: string;
  onUrlInputChange: (v: string) => void;
  urlTarget: 'A' | 'B';
  onUrlTargetChange: (v: 'A' | 'B') => void;
  onUrlSubmit: () => void;
  urlLoadPhase: string | null;
  urlLoadError: string | null;
  onClearUrlError: () => void;
  onUploadA: () => void;
  onUploadB: () => void;
  /**
   * Called when the coach drops or selects a file from the Publer drop zone.
   * The file is handed directly to the page-level handler that creates a blob
   * URL and applies it to the correct video slot — no hidden-input simulation.
   */
  onFileDropped: (file: File, target: 'A' | 'B') => void;

  // ── Alternative — Screen Record ──────────────────────────────────────────
  /**
   * Load the given URL as an embed into `target`, then trigger
   * prepareEmbedCapturePhase once the embed becomes ready.
   */
  onHubCaptureLoad: (url: string, target: 'A' | 'B') => void;
  /** True while the embed is mounting (3-second timer). */
  hubCaptureLoading: boolean;
  /** Which slot the hub capture is targeting (null when idle). */
  hubCaptureTarget: 'A' | 'B' | null;
  /**
   * True when prepareEmbedCapturePhase has finished and the coach must click
   * "Share Screen" to call getDisplayMedia from a user gesture.
   */
  hubCaptureAwaitingShare: boolean;
  /** True while the screen recording is actively in progress. */
  hubCaptureIsActive: boolean;
  /** Must be called directly from a button click (user-gesture token). */
  onHubCaptureShare: () => void;
  onHubCaptureCancel: () => void;
  captureDownloadStatus: 'idle' | 'preparing' | 'ready_mp4' | 'ready_webm';
  onDownloadCapture: () => void;
}

// ── Shared style primitives ─────────────────────────────────────────────────

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

// ── Component ───────────────────────────────────────────────────────────────

export default function RecordingHub({
  isOpen,
  onToggle,
  compact = false,
  darkChrome = false,
  isMobile = false,
  isRecording,
  onRecordingChange,
  getCanvas,
  getWebcamStream,
  getMicStream,
  getCropRegion,
  layoutMode,
  webcamActive,
  onWebcamToggle,
  webcamCutout,
  onWebcamCutoutChange,
  webcamOpacity,
  onWebcamOpacityChange,
  webcamPipMode,
  onWebcamPipModeChange,
  micActive,
  onMicToggle,
  onLayoutChange,
  onScreenshot,
  urlInput,
  onUrlInputChange,
  urlTarget,
  onUrlTargetChange,
  onUrlSubmit,
  urlLoadPhase,
  urlLoadError,
  onClearUrlError,
  onUploadA,
  onUploadB,
  onFileDropped,
  onHubCaptureLoad,
  hubCaptureLoading,
  hubCaptureTarget,
  hubCaptureAwaitingShare,
  hubCaptureIsActive,
  onHubCaptureShare,
  onHubCaptureCancel,
  captureDownloadStatus,
  onDownloadCapture,
}: RecordingHubProps) {
  const urlInputRef = useRef<HTMLInputElement>(null);
  /** Separate URL state for the Publer helper — does NOT trigger the existing URL-load pipeline. */
  const [publerUrl, setPublerUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);
  /** Local state for the hub's screen-record URL input and slot selector. */
  const [altUrl, setAltUrl] = useState('');
  const [altTarget, setAltTarget] = useState<'A' | 'B'>('A');

  // Auto-focus URL field when panel opens so the coach can immediately paste.
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => urlInputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const openInPubler = () => {
    const base = 'https://publer.com/tools/video-downloader';
    const url = publerUrl.trim()
      ? `${base}?url=${encodeURIComponent(publerUrl.trim())}`
      : 'https://publer.com';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDropZoneFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('video/')) return;
    onFileDropped(file, urlTarget);
  };

  // ── Trigger button ────────────────────────────────────────────────────────
  const triggerBtnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: compact ? 28 : 30,
    padding: compact ? '0 8px' : '0 12px',
    borderRadius: 8,
    fontSize: compact ? 11 : 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
    whiteSpace: 'nowrap',
    touchAction: 'manipulation',
  };

  const triggerBtn = (
    <button
      type="button"
      onClick={onToggle}
      title="Recording Studio"
      aria-label="Recording Studio"
      data-tour-id="recording-hub"
      style={{
        ...triggerBtnBase,
        border: isRecording
          ? '1px solid rgba(255,59,48,0.45)'
          : isOpen
          ? '1px solid #35679A'
          : darkChrome
          ? '1px solid rgba(255,255,255,0.22)'
          : '1px solid #E5E5E5',
        background: isRecording
          ? 'rgba(255,59,48,0.10)'
          : isOpen
          ? 'rgba(53,103,154,0.10)'
          : darkChrome
          ? 'rgba(0,0,0,0.35)'
          : '#FFFFFF',
        color: isRecording
          ? '#FF3B30'
          : isOpen
          ? '#35679A'
          : darkChrome
          ? '#FFFFFF'
          : '#1A1A1A',
      }}
    >
      {isRecording ? (
        <>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#FF3B30',
              animation: 'hubRecPulse 1.2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          REC
        </>
      ) : (
        <>
          <Video size={13} strokeWidth={2} />
          Studio
        </>
      )}
    </button>
  );

  // ── Panel ─────────────────────────────────────────────────────────────────
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: 'min(82dvh, 620px)',
        borderRadius: '16px 16px 0 0',
        zIndex: 200,
        background: 'rgba(250, 249, 247, 0.99)',
        border: '1px solid rgba(0,0,0,0.06)',
        borderBottom: 'none',
        boxShadow: '0 -8px 48px rgba(0,0,0,0.14)',
        backdropFilter: 'blur(22px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.15)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'hubSlideUp 200ms ease-out',
      }
    : {
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 'min(300px, 100vw)',
        zIndex: 200,
        background: 'rgba(250, 249, 247, 0.99)',
        borderLeft: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '-6px 0 40px rgba(0,0,0,0.10)',
        backdropFilter: 'blur(22px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.15)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'hubSlideIn 200ms ease-out',
      };

  return (
    <>
      {triggerBtn}

      {isOpen && (
        <>
          <style>{`
            @keyframes hubSlideIn {
              from { opacity: 0; transform: translateX(20px); }
              to   { opacity: 1; transform: none; }
            }
            @keyframes hubSlideUp {
              from { opacity: 0; transform: translateY(16px); }
              to   { opacity: 1; transform: none; }
            }
            @keyframes hubRecPulse {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.22; }
            }
            @keyframes hubSpin {
              to { transform: rotate(360deg); }
            }
          `}</style>

          {/* Backdrop — click anywhere outside panel to close. */}
          <div
            onClick={onToggle}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 199,
              background: 'rgba(0,0,0,0.18)',
            }}
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-label="Recording Studio"
            style={panelStyle}
          >
            {/* ── Panel header ── */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 16px 12px',
                borderBottom: '1px solid #F0EDE8',
                flexShrink: 0,
              }}
            >
              <Video size={16} strokeWidth={2} style={{ color: '#35679A', flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', flex: 1 }}>
                Recording Studio
              </span>
              <button
                type="button"
                onClick={onToggle}
                aria-label="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid #E5E5E5',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch',
                padding: '0 12px',
                paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
              }}
            >

              {/* ════ Session recording ════ */}
              <div style={SECTION_LABEL}>Session recording</div>
              <div
                style={{
                  padding: '12px',
                  borderRadius: 12,
                  border: '1px solid #E8E6E1',
                  background: '#FAFAF8',
                }}
              >
                <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
                  Records the canvas — video, drawings, skeleton overlay, and webcam PiP.
                  Mic (preferred) or webcam audio is captured when enabled below.
                </p>
                <ScreenRecorder
                  getCanvas={getCanvas}
                  getWebcamStream={getWebcamStream}
                  getMicStream={getMicStream}
                  getCropRegion={getCropRegion}
                  layoutMode={layoutMode}
                  onRecordingChange={onRecordingChange}
                />
              </div>

              <div style={DIVIDER} />

              {/* ════ Webcam overlay ════ */}
              <div style={SECTION_LABEL}>Webcam overlay</div>
              <button
                type="button"
                style={rowStyle(webcamActive)}
                onClick={onWebcamToggle}
              >
                {webcamActive ? <CameraOff size={16} /> : <Camera size={16} />}
                {webcamActive ? 'Turn camera off' : 'Turn camera on'}
              </button>

              {webcamActive && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <label
                    style={{ ...rowStyle(webcamCutout), cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onWebcamCutoutChange(!webcamCutout);
                    }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={webcamCutout}
                      style={{ width: 16, height: 16, flexShrink: 0, pointerEvents: 'none' }}
                    />
                    Background removal
                  </label>

                  <div style={{ padding: '4px 4px 0' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>
                      Opacity&nbsp;({Math.round(webcamOpacity * 100)}%)
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(webcamOpacity * 100)}
                      onChange={(e) => onWebcamOpacityChange(Number(e.target.value) / 100)}
                      style={{ width: '100%', accentColor: '#35679A' }}
                    />
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#9CA3AF',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '4px 0 4px',
                    }}
                  >
                    PiP shape
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['rectangle', 'circle'] as WebcamPipMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        style={{
                          ...rowStyle(webcamPipMode === m),
                          flex: 1,
                          justifyContent: 'center',
                        }}
                        onClick={() => onWebcamPipModeChange(m)}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>

                  <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>
                    Drag the PiP on the canvas to reposition it.
                  </p>
                </div>
              )}

              <div style={DIVIDER} />

              {/* ════ Microphone ════ */}
              <div style={SECTION_LABEL}>Microphone</div>
              <button
                type="button"
                style={rowStyle(micActive)}
                onClick={onMicToggle}
              >
                {micActive ? <MicOff size={16} /> : <Mic size={16} />}
                {micActive ? 'Mic on — tap to disable' : 'Enable microphone'}
              </button>
              {micActive && (
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 12,
                    color: '#059669',
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}
                >
                  Mic audio will be mixed into session recordings.
                </p>
              )}

              <div style={DIVIDER} />

              {/* ════ Layout ════ */}
              <div style={SECTION_LABEL}>Layout</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  style={{
                    ...rowStyle(layoutMode === 'youtube'),
                    flex: 1,
                    justifyContent: 'center',
                  }}
                  onClick={() => onLayoutChange('youtube')}
                >
                  16:9
                </button>
                <button
                  type="button"
                  style={{
                    ...rowStyle(layoutMode === 'reels'),
                    flex: 1,
                    justifyContent: 'center',
                  }}
                  onClick={() => onLayoutChange('reels')}
                >
                  9:16
                </button>
              </div>

              <div style={DIVIDER} />

              {/* ════ Screenshot ════ */}
              <div style={SECTION_LABEL}>Screenshot</div>
              <button
                type="button"
                style={rowStyle()}
                onClick={() => {
                  onScreenshot();
                  onToggle();
                }}
              >
                <Monitor size={16} />
                Capture current frame
              </button>

              <div style={DIVIDER} />

              {/* ════ Recommended: Publer workflow ════ */}
              <div
                style={{
                  ...SECTION_LABEL,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>Recommended</span>
                <span
                  style={{
                    background: '#35679A',
                    color: '#FFFFFF',
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '2px 5px',
                    borderRadius: 4,
                    letterSpacing: '0.04em',
                    lineHeight: 1,
                  }}
                >
                  EASIEST
                </span>
              </div>

              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 12,
                  color: '#3C3C3C',
                  lineHeight: 1.5,
                }}
              >
                The easiest way to load any video from YouTube, Instagram, or TikTok
              </p>

              {/* Publer URL row */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  type="text"
                  placeholder="Paste video URL…"
                  value={publerUrl}
                  onChange={(e) => setPublerUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      openInPubler();
                    }
                  }}
                  style={{
                    flex: 1,
                    height: 36,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #E8E8ED',
                    fontSize: 13,
                    outline: 'none',
                    minWidth: 0,
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                  }}
                />
                <button
                  type="button"
                  onClick={openInPubler}
                  title="Open in Publer video downloader"
                  style={{
                    height: 36,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#35679A',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    touchAction: 'manipulation',
                  }}
                >
                  <ExternalLink size={12} strokeWidth={2.5} />
                  Open in Publer
                </button>
              </div>

              {/* Instructions */}
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 11,
                  color: '#6B7280',
                  lineHeight: 1.5,
                  fontStyle: 'italic',
                }}
              >
                Download the video from Publer, then drag it here or click to upload
              </p>

              {/* ── Drop zone ── */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Drop video file to load into slot ${urlTarget}`}
                onClick={() => dropInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dropInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  handleDropZoneFile(e.dataTransfer.files?.[0]);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '18px 12px',
                  borderRadius: 12,
                  border: `2px dashed ${isDragOver ? '#35679A' : '#D1D5DB'}`,
                  background: isDragOver ? 'rgba(53,103,154,0.06)' : '#FAFAF8',
                  cursor: 'pointer',
                  transition: 'border-color 0.12s ease, background 0.12s ease',
                  marginBottom: 6,
                  touchAction: 'manipulation',
                }}
              >
                <UploadCloud
                  size={22}
                  strokeWidth={1.5}
                  style={{ color: isDragOver ? '#35679A' : '#9CA3AF' }}
                />
                <div style={{ textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      fontWeight: 600,
                      color: isDragOver ? '#35679A' : '#1A1A1A',
                    }}
                  >
                    {isDragOver ? 'Drop to load' : `Drop video here — slot ${urlTarget}`}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: '#9CA3AF',
                      marginTop: 2,
                    }}
                  >
                    or click to browse
                  </span>
                </div>
              </div>

              {/* Hidden file input for click-to-browse inside the drop zone */}
              <input
                ref={dropInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleDropZoneFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />

              <div style={DIVIDER} />

              {/* ════ Load video ════ */}
              <div style={SECTION_LABEL}>Load video</div>

              {/* URL row */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <select
                  value={urlTarget}
                  onChange={(e) => onUrlTargetChange(e.target.value as 'A' | 'B')}
                  aria-label="URL target panel"
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #E5E5E5',
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                    padding: '0 8px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>

                <input
                  ref={urlInputRef}
                  type="text"
                  placeholder="Paste video URL…"
                  value={urlInput}
                  onChange={(e) => onUrlInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onUrlSubmit();
                    }
                  }}
                  style={{
                    flex: 1,
                    height: 38,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #E8E8ED',
                    fontSize: 13,
                    outline: 'none',
                    minWidth: 0,
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                  }}
                />
              </div>

              {/* Load button */}
              <button
                type="button"
                onClick={onUrlSubmit}
                disabled={!!urlLoadPhase}
                style={{
                  ...rowStyle(),
                  justifyContent: 'center',
                  marginBottom: 6,
                  background: urlLoadPhase ? '#F3F4F6' : '#1A1A1A',
                  color: urlLoadPhase ? '#6B7280' : '#FFFFFF',
                  border: 'none',
                  opacity: urlLoadPhase ? 0.7 : 1,
                }}
              >
                {urlLoadPhase ? (
                  <>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      style={{ animation: 'hubSpin 1s linear infinite', flexShrink: 0 }}
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="#6B7280"
                        strokeWidth="2"
                        strokeDasharray="28"
                        strokeDashoffset="8"
                        strokeLinecap="round"
                      />
                    </svg>
                    {urlLoadPhase}
                  </>
                ) : (
                  'Load'
                )}
              </button>

              {/* URL error */}
              {urlLoadError && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: '#FFF5F5',
                    border: '1px solid #FFD0D0',
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: '#CC3333',
                      lineHeight: 1.45,
                      marginBottom: 8,
                    }}
                  >
                    {urlLoadError}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        onClearUrlError();
                        onUrlSubmit();
                      }}
                      style={{
                        ...rowStyle(),
                        flex: 1,
                        justifyContent: 'center',
                        fontSize: 12,
                        height: 30,
                        padding: '0 10px',
                        background: '#007AFF',
                        color: '#fff',
                        border: 'none',
                      }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClearUrlError();
                        onUploadA();
                      }}
                      style={{
                        ...rowStyle(),
                        flex: 1,
                        justifyContent: 'center',
                        fontSize: 12,
                        height: 30,
                        padding: '0 10px',
                      }}
                    >
                      Upload instead
                    </button>
                  </div>
                </div>
              )}

              {/* Upload A/B */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={onUploadA}
                  style={{ ...rowStyle(), flex: 1, justifyContent: 'center', fontSize: 12 }}
                >
                  Upload A
                </button>
                <button
                  type="button"
                  onClick={onUploadB}
                  style={{ ...rowStyle(), flex: 1, justifyContent: 'center', fontSize: 12 }}
                >
                  Upload B
                </button>
              </div>

              <div style={DIVIDER} />

              {/* ════ Alternative — Screen Record ════ */}
              <div style={{ ...SECTION_LABEL, color: '#6B7280' }}>Alternative — Screen Record</div>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 10px', lineHeight: 1.5 }}>
                Works with any URL your browser can play. CoachLab will screen-record the video
                as it plays.
              </p>

              {/* Slot + URL input */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select
                  value={altTarget}
                  onChange={(e) => setAltTarget(e.target.value as 'A' | 'B')}
                  disabled={hubCaptureLoading || hubCaptureAwaitingShare || hubCaptureIsActive}
                  aria-label="Screen-record target panel"
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #E5E5E5',
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                    padding: '0 8px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                    opacity: (hubCaptureLoading || hubCaptureAwaitingShare || hubCaptureIsActive) ? 0.5 : 1,
                  }}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>

                <input
                  type="text"
                  placeholder="Paste any video URL…"
                  value={altUrl}
                  onChange={(e) => setAltUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && altUrl.trim() && !hubCaptureLoading && !hubCaptureAwaitingShare && !hubCaptureIsActive) {
                      e.preventDefault();
                      onHubCaptureLoad(altUrl.trim(), altTarget);
                    }
                  }}
                  disabled={hubCaptureLoading || hubCaptureAwaitingShare || hubCaptureIsActive}
                  style={{
                    flex: 1,
                    height: 38,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #E8E8ED',
                    fontSize: 13,
                    outline: 'none',
                    minWidth: 0,
                    background: '#FFFFFF',
                    color: '#1A1A1A',
                    opacity: (hubCaptureLoading || hubCaptureAwaitingShare || hubCaptureIsActive) ? 0.5 : 1,
                  }}
                />
              </div>

              {/* ── Idle: Prepare button ── */}
              {!hubCaptureLoading && !hubCaptureAwaitingShare && !hubCaptureIsActive && (
                <button
                  type="button"
                  disabled={!altUrl.trim()}
                  onClick={() => {
                    if (altUrl.trim()) onHubCaptureLoad(altUrl.trim(), altTarget);
                  }}
                  style={{
                    ...rowStyle(),
                    justifyContent: 'center',
                    marginBottom: 6,
                    background: altUrl.trim() ? '#1A1A1A' : '#F3F4F6',
                    color: altUrl.trim() ? '#FFFFFF' : '#9CA3AF',
                    border: 'none',
                    opacity: altUrl.trim() ? 1 : 0.6,
                  }}
                >
                  <Monitor size={14} style={{ flexShrink: 0 }} />
                  Prepare &amp; Record
                </button>
              )}

              {/* ── Loading: embed mounting ── */}
              {hubCaptureLoading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#F8F9FA',
                    border: '1px solid #E5E5E5',
                    marginBottom: 6,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    style={{ animation: 'hubSpin 1s linear infinite', flexShrink: 0 }}
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="#6B7280"
                      strokeWidth="2"
                      strokeDasharray="28"
                      strokeDashoffset="8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>
                    Loading video — please wait…
                  </span>
                  <button
                    type="button"
                    onClick={() => { onHubCaptureCancel(); setAltUrl(''); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#9CA3AF',
                      padding: 2,
                      lineHeight: 1,
                    }}
                    aria-label="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* ── Awaiting share: show audio warning + Share Screen button ── */}
              {hubCaptureAwaitingShare && !hubCaptureIsActive && (
                <>
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      marginBottom: 8,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                      Please wait — turn your volume up and remove headphones if you want
                      audio recorded.
                    </p>
                  </div>

                  {/* IMPORTANT: this button click calls getDisplayMedia — must be a direct
                      user gesture with no awaits before the call on Safari. */}
                  <button
                    type="button"
                    onClick={onHubCaptureShare}
                    style={{
                      ...rowStyle(),
                      justifyContent: 'center',
                      marginBottom: 6,
                      background: '#007AFF',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 700,
                    }}
                  >
                    <Monitor size={14} style={{ flexShrink: 0 }} />
                    Share Screen to Record
                  </button>

                  <button
                    type="button"
                    onClick={() => { onHubCaptureCancel(); setAltUrl(''); }}
                    style={{
                      ...rowStyle(),
                      justifyContent: 'center',
                      marginBottom: 6,
                      fontSize: 12,
                      color: '#6B7280',
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}

              {/* ── Recording in progress ── */}
              {hubCaptureIsActive && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#FFF5F5',
                    border: '1px solid #FFD0D0',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#EF4444',
                      flexShrink: 0,
                      animation: 'hubPulse 1.2s ease-in-out infinite',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#991B1B', flex: 1 }}>
                    Recording in progress — do not switch tabs
                  </span>
                </div>
              )}

              {/* ── Download ready after recording ── */}
              {(captureDownloadStatus === 'ready_mp4' || captureDownloadStatus === 'ready_webm') &&
                !hubCaptureLoading &&
                !hubCaptureAwaitingShare &&
                !hubCaptureIsActive && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    marginBottom: 6,
                  }}
                >
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#166534' }}>
                    Recording saved to slot {hubCaptureTarget ?? ''}. Want a copy?
                  </p>
                  <button
                    type="button"
                    onClick={onDownloadCapture}
                    style={{
                      ...rowStyle(),
                      justifyContent: 'center',
                      fontSize: 12,
                      height: 30,
                      padding: '0 10px',
                      background: '#16A34A',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    Download {captureDownloadStatus === 'ready_mp4' ? 'MP4' : 'WebM'}
                  </button>
                </div>
              )}
              {captureDownloadStatus === 'preparing' &&
                !hubCaptureLoading &&
                !hubCaptureAwaitingShare &&
                !hubCaptureIsActive && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#F8F9FA',
                    border: '1px solid #E5E5E5',
                    marginBottom: 6,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    style={{ animation: 'hubSpin 1s linear infinite', flexShrink: 0 }}
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="#6B7280"
                      strokeWidth="2"
                      strokeDasharray="28"
                      strokeDashoffset="8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span style={{ fontSize: 12, color: '#374151' }}>
                    Processing your video…
                  </span>
                </div>
              )}

            </div>
          </div>
        </>
      )}
    </>
  );
}
