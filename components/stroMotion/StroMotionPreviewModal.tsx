'use client';

import React from 'react';
import { Download, X } from 'lucide-react';

export interface StroMotionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  pngUrl: string | null;
  videoUrl: string | null;
  videoExportSupported: boolean;
  isGenerating?: boolean;
  isBuildingVideo?: boolean;
  errorMessage?: string | null;
  onBuildVideo?: () => void;
  onDownloadPng?: () => void;
  onDownloadVideo?: () => void;
}

export default function StroMotionPreviewModal({
  open,
  onClose,
  pngUrl,
  videoUrl,
  videoExportSupported,
  isGenerating = false,
  isBuildingVideo = false,
  errorMessage = null,
  onBuildVideo,
  onDownloadPng,
  onDownloadVideo,
}: StroMotionPreviewModalProps) {
  if (!open) return null;

  const showLoading = !pngUrl;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="StroMotion preview"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10060,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(1200px, 100%)',
          maxHeight: '94vh',
          overflow: 'auto',
          background: '#141416',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review StroMotion</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
              Check the still image and looping video before downloading.
            </p>
            {errorMessage ? (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#FF453A', fontWeight: 600 }}>
                {errorMessage}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close preview" style={iconBtn}>
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Still image</div>
            {showLoading ? (
              <div
                style={{
                  minHeight: 280,
                  borderRadius: 10,
                  border: '1px dashed rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: 14,
                }}
              >
                {isGenerating ? 'Generating StroMotion image…' : 'Waiting for preview…'}
              </div>
            ) : (
              <>
                <img
                  src={pngUrl}
                  alt="StroMotion composite"
                  style={{
                    width: '100%',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: '#000',
                  }}
                />
                {onDownloadPng ? (
                  <button type="button" onClick={onDownloadPng} style={actionBtn}>
                    <Download size={16} /> Download PNG
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Video preview</div>
            {videoUrl ? (
              <>
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: '#000',
                    maxHeight: 'min(60vh, 520px)',
                  }}
                />
                {onDownloadVideo ? (
                  <button type="button" onClick={onDownloadVideo} style={actionBtn}>
                    <Download size={16} /> Download Video
                  </button>
                ) : null}
              </>
            ) : videoExportSupported ? (
              <div
                style={{
                  minHeight: 200,
                  borderRadius: 10,
                  border: '1px dashed rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 24,
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: 13,
                }}
              >
                {isBuildingVideo ? (
                  'Building video preview…'
                ) : onBuildVideo ? (
                  <button type="button" onClick={onBuildVideo} style={actionBtn}>
                    Build video preview
                  </button>
                ) : (
                  'Video preview unavailable.'
                )}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                Video preview is not supported in this browser — download the PNG instead.
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  cursor: 'pointer',
};

const actionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 10,
  border: 'none',
  background: '#007AFF',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'transparent',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};
