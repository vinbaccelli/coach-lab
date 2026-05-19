'use client';

/**
 * RecordingHub — panel opened from the left toolbar.
 * All state lives in page.tsx; this component is presentational.
 */

import React, { useEffect, useRef, useState } from 'react';
import { normalizeWebUrlInput } from '@/lib/embedUrl';
import {
  Video,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  ChevronLeft,
  Monitor,
  UploadCloud,
  ExternalLink,
  LayoutGrid,
  Image as ImageIcon,
} from 'lucide-react';
import ScreenRecorder from '@/components/ScreenRecorder';

export interface RecordingHubProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
  /** Desktop: distance from left edge (toolbar width + gap). */
  toolbarLeftInset?: number;

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

  urlTarget: 'A' | 'B';
  onUrlTargetChange: (v: 'A' | 'B') => void;
  onFileDropped: (file: File, target: 'A' | 'B') => void;

  onHubCaptureLoad: (url: string, target: 'A' | 'B') => void;
  hubCaptureLoading: boolean;
  hubCaptureTarget: 'A' | 'B' | null;
  hubCaptureAwaitingShare: boolean;
  hubCaptureIsActive: boolean;
  onHubCaptureShare: () => void;
  onHubCaptureCancel: () => void;
  captureDownloadStatus: 'idle' | 'preparing' | 'ready_mp4' | 'ready_webm';
  onDownloadCapture: () => void;
  onDismissCaptureDownload: () => void;

  screenRecordDownloadPending?: boolean;
  onScreenRecordDownloadYes?: () => void;
  onScreenRecordDownloadNo?: () => void;
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={SECTION_LABEL}>{children}</div>;
}

export default function RecordingHub(props: RecordingHubProps) {
  const {
    isOpen,
    onClose,
    isMobile = false,
    toolbarLeftInset = 220,
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
    urlTarget,
    onUrlTargetChange,
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
    onDismissCaptureDownload,
    screenRecordDownloadPending,
    onScreenRecordDownloadYes,
    onScreenRecordDownloadNo,
  } = props;

  const [publerUrl, setPublerUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);
  const [altUrl, setAltUrl] = useState('');
  const [altTarget, setAltTarget] = useState<'A' | 'B'>('A');
  const altLoadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const queueAltUrlLoad = (raw: string, immediate = false) => {
    const normalized = normalizeWebUrlInput(raw);
    if (!normalized) return;
    if (altLoadDebounceRef.current) clearTimeout(altLoadDebounceRef.current);
    const run = () => onHubCaptureLoad(normalized, altTarget);
    if (immediate) {
      run();
      return;
    }
    altLoadDebounceRef.current = setTimeout(run, 400);
  };

  useEffect(() => {
    return () => {
      if (altLoadDebounceRef.current) clearTimeout(altLoadDebounceRef.current);
    };
  }, []);

  const handleAltUrlChange = (value: string) => {
    setAltUrl(value);
    if (normalizeWebUrlInput(value)) queueAltUrlLoad(value);
  };

  const handleAltUrlPaste = (value: string) => {
    setAltUrl(value);
    queueAltUrlLoad(value, true);
  };

  if (!isOpen) return null;

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
        left: toolbarLeftInset,
        top: 12,
        bottom: 12,
        width: 'min(320px, calc(100vw - 24px))',
        zIndex: 200,
        background: 'rgba(250, 249, 247, 0.99)',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
        backdropFilter: 'blur(22px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.15)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'hubSlideIn 200ms ease-out',
      };

  return (
    <>
      <style>{`
        @keyframes hubSlideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes hubSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes hubSpin { to { transform: rotate(360deg); } }
        @keyframes hubPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>

      <div
        onClick={onClose}
        aria-hidden
        style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.18)' }}
      />

      <div role="dialog" aria-modal="true" aria-label="Recording Hub" data-tour-id="recording-hub" style={panelStyle}>
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Recording Hub"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #E5E5E5',
              background: '#FFFFFF',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <Video size={16} style={{ color: '#35679A' }} />
          <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Recording Hub</span>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '0 12px',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {/* 1 Layout */}
          <SectionLabel>Layout</SectionLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              style={{ ...rowStyle(layoutMode === 'youtube'), flex: 1, justifyContent: 'center' }}
              onClick={() => onLayoutChange('youtube')}
            >
              <LayoutGrid size={16} />
              16:9
            </button>
            <button
              type="button"
              style={{ ...rowStyle(layoutMode === 'reels'), flex: 1, justifyContent: 'center' }}
              onClick={() => onLayoutChange('reels')}
            >
              <LayoutGrid size={16} />
              9:16
            </button>
          </div>

          <div style={DIVIDER} />

          {/* 2 Screenshot */}
          <SectionLabel>Screenshot</SectionLabel>
          <button type="button" style={rowStyle()} onClick={onScreenshotEntireScreen}>
            <Monitor size={16} />
            Entire screen
          </button>
          <button
            type="button"
            style={{ ...rowStyle(), marginTop: 6 }}
            onClick={onScreenshotVideoOnly}
          >
            <ImageIcon size={16} />
            Video only
          </button>

          <div style={DIVIDER} />

          {/* 3 Record Screen */}
          <SectionLabel>Record Screen</SectionLabel>
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1px solid #E8E6E1',
              background: '#FAFAF8',
              marginBottom: 8,
            }}
          >
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
              Share your screen, window, or tab. Webcam and mic are included when enabled below.
            </p>
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

          {screenRecordDownloadPending && (
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
          )}

          <div style={DIVIDER} />

          {/* 4 Webcam */}
          <SectionLabel>Webcam</SectionLabel>
          <button type="button" style={rowStyle(webcamActive)} onClick={onWebcamToggle}>
            {webcamActive ? <CameraOff size={16} /> : <Camera size={16} />}
            {webcamActive ? 'Webcam on' : 'Webcam off'}
          </button>

          <div style={DIVIDER} />

          {/* 5 Mic */}
          <SectionLabel>Microphone</SectionLabel>
          <button type="button" style={rowStyle(micActive && !micMuted)} onClick={onMicToggle}>
            {micMuted || !micActive ? <MicOff size={16} /> : <Mic size={16} />}
            {micMuted ? 'Mic muted' : micActive ? 'Mic on' : 'Mic off'}
          </button>

          <div style={DIVIDER} />

          {/* 6 Load Video */}
          <SectionLabel>Load Video with URL</SectionLabel>

          <div data-tour-id="load-video">
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>
            Recommended — fastest way to load any video
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#3C3C3C', lineHeight: 1.5 }}>
            The easiest way to load videos from YouTube, Instagram or TikTok
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              type="text"
              placeholder="Paste video URL…"
              value={publerUrl}
              onChange={(e) => setPublerUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), openInPubler())}
              style={{
                flex: 1,
                height: 36,
                padding: '0 10px',
                borderRadius: 8,
                border: '1px solid #E8E8ED',
                fontSize: 13,
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={openInPubler}
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
                flexShrink: 0,
              }}
            >
              <ExternalLink size={12} />
              Open in Publer
            </button>
          </div>

          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#6B7280', fontStyle: 'italic' }}>
            Download the video from Publer, then drop it here
          </p>

          <select
            value={urlTarget}
            onChange={(e) => onUrlTargetChange(e.target.value as 'A' | 'B')}
            style={{
              width: '100%',
              height: 34,
              marginBottom: 8,
              borderRadius: 8,
              border: '1px solid #E5E5E5',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <option value="A">Video A</option>
            <option value="B">Video B</option>
          </select>

          <div
            role="button"
            tabIndex={0}
            onClick={() => dropInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
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
              border: `2px dashed ${isDragOver ? '#35679A' : '#D1D5DB'}`,
              background: isDragOver ? 'rgba(53,103,154,0.06)' : '#FAFAF8',
              cursor: 'pointer',
              marginBottom: 14,
            }}
          >
            <UploadCloud size={22} style={{ color: isDragOver ? '#35679A' : '#9CA3AF' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Drop or click — slot {urlTarget}
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
          </div>

          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#6B7280' }}>
            Alternative — use if Publer does not work
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select
              value={altTarget}
              onChange={(e) => setAltTarget(e.target.value as 'A' | 'B')}
              disabled={hubCaptureIsActive}
              style={{ height: 38, borderRadius: 8, border: '1px solid #E5E5E5', fontSize: 12, fontWeight: 700 }}
            >
              <option value="A">Video A</option>
              <option value="B">Video B</option>
            </select>
            <input
              type="text"
              placeholder="Paste any video URL…"
              value={altUrl}
              onChange={(e) => handleAltUrlChange(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted) {
                  e.preventDefault();
                  handleAltUrlPaste(pasted);
                }
              }}
              disabled={hubCaptureIsActive}
              style={{ flex: 1, height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid #E8E8ED', fontSize: 13, outline: 'none', minWidth: 0 }}
            />
          </div>

          {hubCaptureLoading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                background: '#F5F5F4',
                border: '1px solid #E5E5E5',
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#1A1A1A',
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
          )}

          {!hubCaptureLoading && hubCaptureTarget && !hubCaptureIsActive && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#166534', lineHeight: 1.45 }}>
              Video loaded — choose record options on the video panel, then tap Start Recording.
            </p>
          )}

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
                marginBottom: 8,
                fontSize: 12,
                color: '#991B1B',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#EF4444',
                  animation: 'hubPulse 1.2s ease-in-out infinite',
                }}
              />
              Recording in progress…
            </div>
          )}

          {(captureDownloadStatus === 'ready_mp4' || captureDownloadStatus === 'ready_webm') &&
            !hubCaptureLoading &&
            !hubCaptureAwaitingShare &&
            !hubCaptureIsActive && (
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
                Would you like to download a copy as MP4?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...rowStyle(), flex: 1, justifyContent: 'center', background: '#16A34A', color: '#fff', border: 'none' }}
                  onClick={onDownloadCapture}
                >
                  Download
                </button>
                <button
                  type="button"
                  style={{ ...rowStyle(), flex: 1, justifyContent: 'center' }}
                  onClick={onDismissCaptureDownload}
                >
                  No thanks
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
