'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

export interface FrameMetricsReportFrame {
  index: number;
  timeSec: number;
  label: string;
  imageUrl: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  frames: FrameMetricsReportFrame[];
  playerName?: string;
  onSaveToDoc?: (frames: FrameMetricsReportFrame[]) => Promise<void>;
  isSaving?: boolean;
  savedDocUrl?: string | null;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export default function FrameMetricsReportModal({
  open,
  onClose,
  frames,
  playerName,
  onSaveToDoc,
  isSaving = false,
  savedDocUrl = null,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [editableNotes, setEditableNotes] = useState<Record<number, string>>(
    () => Object.fromEntries(frames.map(f => [f.index, f.notes]))
  );

  const frame = frames[activeIdx];
  const totalFrames = frames.length;

  const prev = useCallback(() => setActiveIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setActiveIdx(i => Math.min(totalFrames - 1, i + 1)), [totalFrames]);

  const handleDownloadCurrent = useCallback(() => {
    if (!frame) return;
    const a = document.createElement('a');
    a.href = frame.imageUrl;
    a.download = `frame-metrics-${frame.label.replace(/\s+/g, '-')}.png`;
    a.click();
  }, [frame]);

  const handleDownloadAll = useCallback(async () => {
    if (!frames.length) return;

    // Build a grid canvas: frames side by side with notes below
    const FRAME_W = 640;
    const NOTES_H = 80;
    const PAD = 16;
    const cols = Math.min(frames.length, 3);
    const rows = Math.ceil(frames.length / cols);

    const loadImage = (url: string): Promise<HTMLImageElement> =>
      new Promise((res, rej) => {
        const img = new window.Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });

    const imgs = await Promise.all(frames.map(f => loadImage(f.imageUrl)));
    const frameH = imgs[0] ? Math.round((imgs[0].naturalHeight / imgs[0].naturalWidth) * FRAME_W) : 360;
    const cellH = frameH + NOTES_H + PAD * 2;
    const cellW = FRAME_W + PAD * 2;

    const canvas = document.createElement('canvas');
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    frames.forEach((f, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW + PAD;
      const y = row * cellH + PAD;
      const img = imgs[i];
      if (img) ctx.drawImage(img, x, y, FRAME_W, frameH);

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.fillText(f.label, x, y + frameH + 18);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px -apple-system, sans-serif';

      // Notes text wrapped
      const notes = editableNotes[f.index] ?? f.notes;
      const words = notes.split(' ');
      let line = '';
      let lineY = y + frameH + 34;
      const maxW = FRAME_W;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, x, lineY);
          line = word;
          lineY += 14;
          if (lineY > y + cellH - PAD) break;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, x, lineY);
    });

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `frame-metrics-report${playerName ? `-${playerName}` : ''}.png`;
    a.click();
  }, [frames, editableNotes, playerName]);

  const handleSaveToDocs = useCallback(async () => {
    if (!onSaveToDoc) return;
    const withNotes = frames.map(f => ({ ...f, notes: editableNotes[f.index] ?? f.notes }));
    await onSaveToDoc(withNotes);
  }, [frames, editableNotes, onSaveToDoc]);

  if (!open || !frames.length) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Frame Metrics Report"
      style={{
        position: 'fixed', inset: 0, zIndex: 10060,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 'min(900px,100%)', maxHeight: '94vh',
        background: '#0f0f18', borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <FileText size={16} color="#60A5FA" />
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', flex: 1 }}>
            Frame Metrics Report
            {playerName && <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 8, fontWeight: 400 }}>— {playerName}</span>}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
            {activeIdx + 1} / {totalFrames}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Carousel */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Dot indicators */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '12px 0 4px' }}>
            {frames.map((_, i) => (
              <button key={i} onClick={() => setActiveIdx(i)} style={{
                width: i === activeIdx ? 20 : 8, height: 8, borderRadius: 4,
                background: i === activeIdx ? '#3B82F6' : 'rgba(255,255,255,0.2)',
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'all 0.2s',
              }} />
            ))}
          </div>

          {/* Main frame view */}
          {frame && (
            <div style={{ padding: '12px 24px 0' }}>
              <div style={{ position: 'relative' }}>
                <img
                  src={frame.imageUrl}
                  alt={frame.label}
                  style={{ width: '100%', borderRadius: 10, display: 'block', background: '#000' }}
                />
                {/* Nav arrows */}
                {activeIdx > 0 && (
                  <button onClick={prev} style={{
                    position: 'absolute', left: -16, top: '50%', transform: 'translateY(-50%)',
                    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ChevronLeft size={18} />
                  </button>
                )}
                {activeIdx < totalFrames - 1 && (
                  <button onClick={next} style={{
                    position: 'absolute', right: -16, top: '50%', transform: 'translateY(-50%)',
                    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>

              {/* Frame label + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{frame.label}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{formatTime(frame.timeSec)}</span>
              </div>

              {/* Editable notes */}
              <div style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>
                  Measurement notes (saved with report):
                </label>
                <textarea
                  value={editableNotes[frame.index] ?? ''}
                  onChange={e => setEditableNotes(prev => ({ ...prev, [frame.index]: e.target.value }))}
                  placeholder="e.g. Hip angle: 45° · Shoulder rotation: 30° · Foot distance: 0.85 m"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff', fontSize: 13, lineHeight: 1.5,
                    resize: 'vertical', boxSizing: 'border-box',
                    outline: 'none', fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          )}

          {/* Thumbnail strip */}
          {totalFrames > 1 && (
            <div style={{
              display: 'flex', gap: 8, padding: '12px 24px',
              overflowX: 'auto',
            }}>
              {frames.map((f, i) => (
                <button key={f.index} onClick={() => setActiveIdx(i)} style={{
                  flex: '0 0 80px', height: 56,
                  border: i === activeIdx ? '2px solid #3B82F6' : '2px solid transparent',
                  borderRadius: 6, overflow: 'hidden', cursor: 'pointer', padding: 0, background: '#000',
                }}>
                  <img src={f.imageUrl} alt={f.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <button onClick={handleDownloadCurrent} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', fontSize: 13,
          }}>
            <Image size={14} /> Download frame
          </button>

          <button onClick={() => { void handleDownloadAll(); }} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', fontSize: 13,
          }}>
            <Download size={14} /> Download all ({totalFrames})
          </button>

          <div style={{ flex: 1 }} />

          {savedDocUrl ? (
            <a href={savedDocUrl} target="_blank" rel="noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: 'none', background: '#4ADE80',
              color: '#052e16', fontWeight: 700, fontSize: 13, textDecoration: 'none',
            }}>
              <CheckCircle2 size={14} /> Open in Google Docs
            </a>
          ) : onSaveToDoc ? (
            <button onClick={() => { void handleSaveToDocs(); }} disabled={isSaving} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: 'none', cursor: isSaving ? 'default' : 'pointer',
              background: '#3B82F6', color: '#fff', fontWeight: 700, fontSize: 13,
              opacity: isSaving ? 0.7 : 1,
            }}>
              {isSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={14} />}
              {isSaving ? 'Saving…' : 'Save to Player Docs'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
