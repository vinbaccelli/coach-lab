'use client';

/**
 * Metrics Generate workspace — READ-ONLY over snapshots.
 *
 * Shows the generated snapshot sequence with large image/video previews and
 * drives the final export (PNG download, MP4 download, YouTube upload,
 * Google Docs report, attach-to-player). Order, selection, report title and
 * per-snapshot report notes are LOCAL workspace state — snapshots are never
 * mutated here (product rule: Generate never modifies snapshots).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Download, Play, Video, FileText, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Youtube, Loader2, ExternalLink } from 'lucide-react';
import type { Snapshot } from '@/lib/snapshots';
import { runExportPipeline } from '@/lib/export/exportService';
import { ENABLE_YOUTUBE_UPLOAD } from '@/lib/featureFlags';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1] as const;

export interface GenerateWorkspaceProps {
  open: boolean;
  /** Keep mounted but visually hidden (state survives replay/record passes). */
  hidden?: boolean;
  onClose: () => void;
  /** Time-ordered snapshots (already screenshot-captured by Generate). */
  snapshots: Snapshot[];
  /** Rendered replay video (object URL) + blob, when recorded. */
  videoUrl: string | null;
  videoBlob: Blob | null;
  recording: boolean;
  replaying: boolean;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  /** Seconds each snapshot stays frozen during replay/recorded video. */
  holdSeconds: number;
  onHoldSecondsChange: (sec: number) => void;
  /** Replay the sequence on the analysis canvas (workspace hides meanwhile). */
  onReplay: () => void;
  /** Record the replay to MP4 (workspace hides meanwhile). */
  onRecordVideo: () => void;
}

interface PlayerOption { id: string; display_name: string }

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function GenerateWorkspace({
  open,
  hidden = false,
  onClose,
  snapshots,
  videoUrl,
  videoBlob,
  recording,
  replaying,
  playbackRate,
  onPlaybackRateChange,
  holdSeconds,
  onHoldSecondsChange,
  onReplay,
  onRecordVideo,
}: GenerateWorkspaceProps) {
  // ── Local, non-destructive workspace state ────────────────────────────────
  const [order, setOrder] = useState<string[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'image' | 'video'>('image');
  const [reportTitle, setReportTitle] = useState('');
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [attachPlayerId, setAttachPlayerId] = useState<string>('');
  const [includeVideoUpload, setIncludeVideoUpload] = useState(ENABLE_YOUTUBE_UPLOAD);
  const [newPlayerName, setNewPlayerName] = useState<string | null>(null);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [resultDocUrl, setResultDocUrl] = useState<string | null>(null);
  const [resultYoutubeUrl, setResultYoutubeUrl] = useState<string | null>(null);

  // Sync local order/selection with the snapshot set (id-stable: user reorder
  // and exclusions survive prop updates; only NEW snapshots default to included).
  const seenIdsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = snapshots.map((s) => s.id);
    setOrder((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
    setIncluded((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      ids.forEach((id) => { if (!seenIdsRef.current.has(id)) next.add(id); });
      return next;
    });
    seenIdsRef.current = new Set(ids);
    setSelectedId((prev) => (prev && ids.includes(prev) ? prev : ids[0] ?? null));
  }, [snapshots]);

  useEffect(() => {
    if (!open) return;
    setReportTitle((prev) => prev || `Stroke analysis — ${new Date().toLocaleDateString()}`);
    // Load players for the attach prompt (best-effort; offline still exports).
    fetch('/api/players')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { players?: PlayerOption[] } | null) => { if (body?.players) setPlayers(body.players); })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (videoUrl) setPreviewTab('video');
  }, [videoUrl]);

  const byId = useMemo(() => new Map(snapshots.map((s) => [s.id, s])), [snapshots]);
  const orderedSnaps = useMemo(
    () => order.map((id) => byId.get(id)).filter((s): s is Snapshot => !!s),
    [order, byId],
  );
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const includedSnaps = useMemo(() => orderedSnaps.filter((s) => included.has(s.id)), [orderedSnaps, included]);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const toggleInclude = useCallback((id: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleDownloadImage = useCallback(() => {
    if (!selected?.screenshot) return;
    downloadDataUrl(selected.screenshot, `${selected.label.replace(/[^\w]+/g, '-')}-${Date.now()}.png`);
  }, [selected]);

  const handleDownloadAllImages = useCallback(() => {
    includedSnaps.forEach((s, i) => {
      if (!s.screenshot) return;
      window.setTimeout(() => downloadDataUrl(s.screenshot as string, `${String(i + 1).padStart(2, '0')}-${s.label.replace(/[^\w]+/g, '-')}.png`), i * 250);
    });
  }, [includedSnaps]);

  const handleDownloadVideo = useCallback(() => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `anglemotion-replay-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [videoUrl]);

  const sectionsForReport = useCallback(() => includedSnaps.map((s, i) => ({
    heading: `${i + 1}. ${s.label} — ${s.timeSec.toFixed(2)}s`,
    image: s.screenshot,
    lines: s.column.map((m) => `${m.label}: ${Math.round(m.value * 10) / 10}${m.unit}`),
    notes: (noteOverrides[s.id] ?? s.notes ?? '').trim() || undefined,
  })), [includedSnaps, noteOverrides]);

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
    if (exporting || includedSnaps.length === 0) return;
    setExporting(true);
    setExportError(null);
    setResultDocUrl(null);
    setResultYoutubeUrl(null);
    try {
      const result = await runExportPipeline({
        title: reportTitle.trim() || 'AngleMotion — Stroke analysis',
        videoBlob: ENABLE_YOUTUBE_UPLOAD && includeVideoUpload && videoBlob ? videoBlob : null,
        sections: sectionsForReport(),
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
  }, [exporting, includedSnaps.length, reportTitle, includeVideoUpload, videoBlob, sectionsForReport, attachPlayerId]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Generate workspace"
      style={{
        position: 'fixed', inset: 0, zIndex: 10050,
        background: 'rgba(0,0,0,0.85)',
        display: hidden ? 'none' : 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        width: 'min(1280px, 100%)', height: 'min(860px, 96vh)',
        background: '#101014', borderRadius: 16, border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Generate — Review & Export</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
              Read-only review of {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}. Reorder and select what goes into the export — the analysis itself is not modified.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Generate workspace" style={iconBtn}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>
          {/* Preview column */}
          <div style={{ flex: '1 1 62%', minWidth: 0, display: 'flex', flexDirection: 'column', padding: 16, gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setPreviewTab('image')} style={previewTab === 'image' ? tabActive : tabIdle}>Image preview</button>
              <button type="button" onClick={() => setPreviewTab('video')} style={previewTab === 'video' ? tabActive : tabIdle}>Video preview</button>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Replay speed</span>
                {SPEED_OPTIONS.map((r) => (
                  <button key={r} type="button" onClick={() => onPlaybackRateChange(r)}
                    style={{ ...speedBtn, ...(playbackRate === r ? { background: '#007AFF', borderColor: '#007AFF' } : {}) }}>
                    {r}×
                  </button>
                ))}
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginLeft: 10 }}>Freeze per snapshot</span>
                {[1, 2, 3, 5].map((s) => (
                  <button key={s} type="button" onClick={() => onHoldSecondsChange(s)}
                    style={{ ...speedBtn, ...(holdSeconds === s ? { background: '#007AFF', borderColor: '#007AFF' } : {}) }}>
                    {s}s
                  </button>
                ))}
              </div>
            </div>

            <div style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: 12, background: '#000', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {previewTab === 'image' && orderedSnaps.length > 1 && (() => {
                const idx = orderedSnaps.findIndex((s) => s.id === selectedId);
                const go = (dir: -1 | 1) => {
                  const next = orderedSnaps[idx + dir];
                  if (next) setSelectedId(next.id);
                };
                return (
                  <>
                    <button type="button" aria-label="Previous snapshot" onClick={() => go(-1)} disabled={idx <= 0}
                      style={{ ...navArrow, left: 10, opacity: idx <= 0 ? 0.25 : 1 }}>
                      <ChevronLeft size={20} />
                    </button>
                    <button type="button" aria-label="Next snapshot" onClick={() => go(1)} disabled={idx < 0 || idx >= orderedSnaps.length - 1}
                      style={{ ...navArrow, right: 10, opacity: idx < 0 || idx >= orderedSnaps.length - 1 ? 0.25 : 1 }}>
                      <ChevronRight size={20} />
                    </button>
                    <span style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.75)', background: 'rgba(0,0,0,0.55)', padding: '3px 10px', borderRadius: 10 }}>
                      {idx + 1} / {orderedSnaps.length}
                    </span>
                  </>
                );
              })()}
              {previewTab === 'image' ? (
                selected?.screenshot ? (
                  <img src={selected.screenshot} alt={selected.label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>No screenshot for this snapshot — run Generate again.</span>
                )
              ) : videoUrl ? (
                <video src={videoUrl} controls playsInline loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                    No replay video yet. Record the slow-motion replay to preview and export it.
                  </p>
                  <button type="button" onClick={onRecordVideo} disabled={recording || replaying} style={primaryBtn}>
                    {recording ? <Loader2 size={15} className="animate-spin" /> : <Video size={15} />} {recording ? 'Recording…' : 'Record replay video'}
                  </button>
                </div>
              )}
            </div>

            {/* Preview actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={onReplay} disabled={replaying || recording} style={secondaryBtn}>
                <Play size={14} /> {replaying ? 'Replaying…' : 'Replay on canvas'}
              </button>
              <button type="button" onClick={onRecordVideo} disabled={recording || replaying} style={secondaryBtn}>
                <Video size={14} /> {recording ? 'Recording…' : videoUrl ? 'Re-record video' : 'Record video'}
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={handleDownloadImage} disabled={!selected?.screenshot} style={secondaryBtn}>
                <Download size={14} /> Image
              </button>
              <button type="button" onClick={handleDownloadAllImages} disabled={!includedSnaps.some((s) => s.screenshot)} style={secondaryBtn}>
                <Download size={14} /> All images
              </button>
              <button type="button" onClick={handleDownloadVideo} disabled={!videoUrl} style={secondaryBtn}>
                <Download size={14} /> MP4
              </button>
            </div>
          </div>

          {/* Right column: snapshot list + export */}
          <div style={{ flex: '1 1 38%', minWidth: 320, maxWidth: 460, borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
                Snapshot sequence · {includedSnaps.length}/{orderedSnaps.length} included
              </div>
              {orderedSnaps.map((s, i) => {
                const isSelected = s.id === selectedId;
                const isIncluded = included.has(s.id);
                return (
                  <div key={s.id} style={{
                    display: 'flex', gap: 8, padding: 8, borderRadius: 10,
                    background: isSelected ? 'rgba(0,122,255,0.14)' : 'rgba(255,255,255,0.04)',
                    border: isSelected ? '1px solid rgba(0,122,255,0.6)' : '1px solid rgba(255,255,255,0.07)',
                    opacity: isIncluded ? 1 : 0.45,
                  }}>
                    <button type="button" onClick={() => { setSelectedId(s.id); setPreviewTab('image'); }}
                      style={{ border: 'none', padding: 0, background: '#000', borderRadius: 6, overflow: 'hidden', width: 84, height: 52, flexShrink: 0, cursor: 'pointer' }}>
                      {s.screenshot
                        ? <img src={s.screenshot} alt={s.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>No capture</span>}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 0 }}>
                          <input type="checkbox" checked={isIncluded} onChange={() => toggleInclude(s.id)} aria-label={`Include ${s.label}`} />
                          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i + 1}. {s.label}</span>
                        </label>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>{s.timeSec.toFixed(2)}s</span>
                        <div style={{ flex: 1 }} />
                        <button type="button" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="Move up" style={miniBtn}><ChevronUp size={13} /></button>
                        <button type="button" onClick={() => move(s.id, 1)} disabled={i === orderedSnaps.length - 1} aria-label="Move down" style={miniBtn}><ChevronDown size={13} /></button>
                      </div>
                      {s.column.length > 0 && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.column.map((m) => `${m.label} ${Math.round(m.value * 10) / 10}${m.unit}`).join(' · ')}
                        </div>
                      )}
                      <textarea
                        value={noteOverrides[s.id] ?? s.notes ?? ''}
                        onChange={(e) => setNoteOverrides((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="Report note for this snapshot…"
                        rows={1}
                        style={{
                          width: '100%', marginTop: 4, resize: 'vertical', fontSize: 11,
                          background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 6,
                          border: '1px solid rgba(255,255,255,0.1)', padding: '4px 6px',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {orderedSnaps.length === 0 && (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>No snapshots yet — create snapshots (AI Detect or Phases) and press Generate.</p>
              )}
            </div>

            {/* Export panel */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="Report title"
                aria-label="Report title"
                style={{ width: '100%', fontSize: 13, fontWeight: 600, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={attachPlayerId}
                  onChange={(e) => setAttachPlayerId(e.target.value)}
                  aria-label="Attach to player"
                  style={{ flex: 1, fontSize: 12, background: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
                >
                  <option value="">No player — just create the report</option>
                  {players.map((p) => <option key={p.id} value={p.id}>Attach to {p.display_name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setNewPlayerName((v) => (v === null ? '' : null))}
                  style={{ ...secondaryBtn, padding: '8px 10px', whiteSpace: 'nowrap' }}
                >
                  + New player
                </button>
                {ENABLE_YOUTUBE_UPLOAD && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={includeVideoUpload} onChange={(e) => setIncludeVideoUpload(e.target.checked)} disabled={!videoBlob} />
                    <Youtube size={13} /> Upload video
                  </label>
                )}
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
                    style={{ ...primaryBtn, padding: '8px 14px', fontSize: 12 }}
                  >
                    {creatingPlayer ? <Loader2 size={13} className="animate-spin" /> : 'Create'}
                  </button>
                </div>
              )}
              <button type="button" onClick={() => void handleExportReport()} disabled={exporting || includedSnaps.length === 0} style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}>
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                {exporting ? (exportStatus ?? 'Exporting…') : 'Export Google Docs report'}
              </button>
              {ENABLE_YOUTUBE_UPLOAD && includeVideoUpload && !videoBlob && (
                <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Record the replay video first to include it (uploaded Unlisted to your YouTube).</p>
              )}
              {exportError && <p style={{ margin: 0, fontSize: 11, color: '#FF453A', fontWeight: 600 }}>{exportError}</p>}
              {(resultDocUrl || resultYoutubeUrl) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderRadius: 10, border: 'none', background: '#007AFF', color: '#fff',
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
  borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
  color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer',
};

const tabActive: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: '#007AFF',
  color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
};

const tabIdle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
  background: 'transparent', color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontSize: 12, cursor: 'pointer',
};

// Longhand border only — conditional borderColor over a border shorthand
// triggers React rerender style warnings.
const speedBtn: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6,
  borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.2)',
  background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};

const miniBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
  background: 'transparent', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 0,
};

const resultLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
  color: '#4DA3FF', textDecoration: 'none', fontWeight: 600,
};

const navArrow: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 2,
  width: 36, height: 36, borderRadius: '50%',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.25)',
  background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};
