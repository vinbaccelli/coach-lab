'use client';

/**
 * StroMotion Generate workspace — review + render settings + final export.
 *
 * Shows the composite still image and looping video preview, lets the coach
 * tune render settings (direction, ghost transparency, video speed, included
 * renders), add a title + notes, and run the final export: download PNG/video,
 * upload the video to YouTube (Unlisted) and create the Google Docs report
 * with the link auto-inserted (ExportService).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Download, X, FileText, Youtube, Loader2, ExternalLink } from 'lucide-react';
import { runExportPipeline } from '@/lib/export/exportService';
import { ENABLE_GOOGLE_EXPORTS, ENABLE_YOUTUBE_UPLOAD } from '@/lib/featureFlags';

export interface StroMotionFrameToggle {
  index: number;
  label: string;
  included: boolean;
}

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
  /** Render settings (owned by the analysis page; changes rebuild the preview). */
  frames?: StroMotionFrameToggle[];
  onToggleFrame?: (index: number) => void;
  videoOrder?: 'forward' | 'reverse';
  onVideoOrderChange?: (order: 'forward' | 'reverse') => void;
  /** undefined = default temporal fade ("Auto"). */
  ghostOpacity?: number;
  onGhostOpacityChange?: (opacity: number | undefined) => void;
  videoSpeed?: number;
  onVideoSpeedChange?: (speed: number) => void;
  /** Ghost-layer timing for the exported video. */
  layerMode?: 'appear' | 'vanish' | 'all';
  onLayerModeChange?: (mode: 'appear' | 'vanish' | 'all') => void;
  /** Final rendered video blob (for the YouTube upload step). */
  videoBlob?: Blob | null;
  /** Settings summary lines included in the Docs report. */
  settingsLines?: string[];
}

interface PlayerOption { id: string; display_name: string }

const OPACITY_OPTIONS: Array<{ label: string; value: number | undefined }> = [
  { label: 'Auto', value: undefined },
  { label: '80%', value: 0.8 },
  { label: '60%', value: 0.6 },
  { label: '40%', value: 0.4 },
];

const SPEED_OPTIONS = [0.25, 0.5, 1] as const;

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
  frames,
  onToggleFrame,
  videoOrder,
  onVideoOrderChange,
  ghostOpacity,
  onGhostOpacityChange,
  videoSpeed,
  onVideoSpeedChange,
  layerMode,
  onLayerModeChange,
  videoBlob,
  settingsLines,
}: StroMotionPreviewModalProps) {
  const [reportTitle, setReportTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [attachPlayerId, setAttachPlayerId] = useState('');
  const [includeVideoUpload, setIncludeVideoUpload] = useState(ENABLE_YOUTUBE_UPLOAD);
  const [newPlayerName, setNewPlayerName] = useState<string | null>(null);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [resultDocUrl, setResultDocUrl] = useState<string | null>(null);
  const [resultYoutubeUrl, setResultYoutubeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReportTitle((prev) => prev || `StroMotion — ${new Date().toLocaleDateString()}`);
    fetch('/api/players')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { players?: PlayerOption[] } | null) => { if (body?.players) setPlayers(body.players); })
      .catch(() => {});
  }, [open]);

  /** Create a player inline and select it — report generation stays continuous. */
  const handleCreatePlayer = useCallback(async () => {
    const name = newPlayerName?.trim();
    if (!name || creatingPlayer) return;
    setCreatingPlayer(true);
    setExportError(null);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      });
      const body = (await res.json().catch(() => ({}))) as { player?: PlayerOption; error?: string };
      if (!res.ok || !body.player) {
        setExportError(body.error ?? 'Could not create the player — try again.');
        return;
      }
      setPlayers((prev) => [...prev, body.player!].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      setAttachPlayerId(body.player.id);
      setNewPlayerName(null);
    } finally {
      setCreatingPlayer(false);
    }
  }, [newPlayerName, creatingPlayer]);

  const handleExportReport = useCallback(async () => {
    if (exporting || !pngUrl) return;
    setExporting(true);
    setExportError(null);
    setResultDocUrl(null);
    setResultYoutubeUrl(null);
    try {
      const result = await runExportPipeline({
        title: reportTitle.trim() || 'AngleMotion — StroMotion',
        videoBlob: ENABLE_YOUTUBE_UPLOAD && includeVideoUpload && videoBlob ? videoBlob : null,
        sections: [{
          heading: 'StroMotion composite',
          image: pngUrl,
          notes: notes.trim() || undefined,
        }],
        settingsLines,
        playerId: attachPlayerId || null,
        onProgress: setExportStatus,
      });
      if (!result.ok) {
        setExportError(result.error ?? 'Export failed — try again.');
        if (result.youtubeUrl) setResultYoutubeUrl(result.youtubeUrl);
        return;
      }
      setResultDocUrl(result.docUrl ?? null);
      setResultYoutubeUrl(result.youtubeUrl ?? null);
      setExportStatus(null);
    } finally {
      setExporting(false);
    }
  }, [exporting, pngUrl, reportTitle, includeVideoUpload, videoBlob, notes, settingsLines, attachPlayerId]);

  if (!open) return null;

  const showLoading = !pngUrl;
  const hasSettings = !!(onVideoOrderChange || onGhostOpacityChange || onVideoSpeedChange || onLayerModeChange || (frames && onToggleFrame));

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="StroMotion Generate"
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
          width: 'min(1240px, 100%)',
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
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>StroMotion — Generate & Export</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
              Review the still image and looping video, tune the render, then export.
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
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

        {hasSettings && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Render settings</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              {onVideoOrderChange && (
                <div style={settingGroup}>
                  <span style={settingLabel}>Direction</span>
                  {(['forward', 'reverse'] as const).map((o) => (
                    <button key={o} type="button" onClick={() => onVideoOrderChange(o)}
                      style={{ ...chipBtn, ...(videoOrder === o ? chipActive : {}) }}>
                      {o === 'forward' ? 'Forward' : 'Reverse'}
                    </button>
                  ))}
                </div>
              )}
              {onGhostOpacityChange && (
                <div style={settingGroup}>
                  <span style={settingLabel}>Ghost transparency</span>
                  {OPACITY_OPTIONS.map((o) => (
                    <button key={o.label} type="button" onClick={() => onGhostOpacityChange(o.value)}
                      style={{ ...chipBtn, ...(ghostOpacity === o.value ? chipActive : {}) }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {onVideoSpeedChange && (
                <div style={settingGroup}>
                  <span style={settingLabel}>Video speed</span>
                  {SPEED_OPTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => onVideoSpeedChange(s)}
                      style={{ ...chipBtn, ...(videoSpeed === s ? chipActive : {}) }}>
                      {s}×
                    </button>
                  ))}
                </div>
              )}
              {onLayerModeChange && (
                <div style={settingGroup}>
                  <span style={settingLabel}>Ghost layers (video)</span>
                  {([['appear', 'Build up'], ['vanish', 'Fade behind'], ['all', 'All on']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => onLayerModeChange(m)}
                      title={m === 'appear' ? 'Ghosts turn on as the player passes each position' : m === 'vanish' ? 'All ghosts shown, each turns off once passed' : 'Every ghost visible the whole clip'}
                      style={{ ...chipBtn, ...(layerMode === m ? chipActive : {}) }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {frames && onToggleFrame && frames.length > 0 && (
              <div style={settingGroup}>
                <span style={settingLabel}>Included renders (still image)</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {frames.map((f) => (
                    <button key={f.index} type="button" onClick={() => onToggleFrame(f.index)}
                      style={{ ...chipBtn, ...(f.included ? chipActive : { opacity: 0.5 }) }}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Export panel — hidden until Google verification approves the export scopes */}
        {ENABLE_GOOGLE_EXPORTS ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Export report</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Report title"
              aria-label="Report title"
              style={{ flex: '2 1 260px', fontSize: 13, fontWeight: 600, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
            />
            <select
              value={attachPlayerId}
              onChange={(e) => setAttachPlayerId(e.target.value)}
              aria-label="Attach to player"
              style={{ flex: '1 1 220px', fontSize: 12, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
            >
              <option value="">No player — just create the report</option>
              {players.map((p) => <option key={p.id} value={p.id}>Attach to {p.display_name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setNewPlayerName((v) => (v === null ? '' : null))}
              style={{ ...secondaryBtn, padding: '8px 12px', whiteSpace: 'nowrap' }}
            >
              + New player
            </button>
          </div>
          {newPlayerName !== null && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="New player name…"
                autoFocus
                aria-label="New player name"
                onKeyDown={(e) => { if (e.key === 'Enter' && newPlayerName.trim()) void handleCreatePlayer(); }}
                style={{ flex: 1, fontSize: 12, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
              />
              <button
                type="button"
                disabled={!newPlayerName.trim() || creatingPlayer}
                onClick={() => void handleCreatePlayer()}
                style={{ ...actionBtn, padding: '8px 14px', fontSize: 12 }}
              >
                {creatingPlayer ? <Loader2 size={13} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Coach notes for the report…"
            rows={2}
            style={{ width: '100%', resize: 'vertical', fontSize: 12, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {ENABLE_YOUTUBE_UPLOAD && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                <input type="checkbox" checked={includeVideoUpload} onChange={(e) => setIncludeVideoUpload(e.target.checked)} disabled={!videoBlob} />
                <Youtube size={13} /> Upload video to YouTube (Unlisted)
              </label>
            )}
            {ENABLE_YOUTUBE_UPLOAD && !videoBlob && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Build the video preview first to include it.</span>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => void handleExportReport()} disabled={exporting || !pngUrl} style={actionBtn}>
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              {exporting ? (exportStatus ?? 'Exporting…') : 'Export Google Docs report'}
            </button>
          </div>
          {exportError && <p style={{ margin: 0, fontSize: 11, color: '#FF453A', fontWeight: 600 }}>{exportError}</p>}
          {(resultDocUrl || resultYoutubeUrl) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {resultDocUrl && (
                <a href={resultDocUrl} target="_blank" rel="noreferrer" style={resultLink}>
                  <ExternalLink size={12} /> Open Google Docs report
                </a>
              )}
              {resultYoutubeUrl && (
                <a href={resultYoutubeUrl} target="_blank" rel="noreferrer" style={resultLink}>
                  <ExternalLink size={12} /> Open YouTube video (Unlisted)
                </a>
              )}
            </div>
          )}
        </div>
        ) : null}

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

const settingGroup: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const settingLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.55)',
  fontWeight: 600,
};

// Longhand border properties only — mixing the `border` shorthand with a
// conditional `borderColor` override triggers React rerender style warnings.
const chipBtn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255,255,255,0.2)',
  background: 'transparent',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const chipActive: React.CSSProperties = {
  background: '#007AFF',
  borderColor: '#007AFF',
};

const resultLink: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#4DA3FF',
  textDecoration: 'none',
  fontWeight: 600,
};
