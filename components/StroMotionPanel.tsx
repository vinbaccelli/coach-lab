'use client';

import React, { useMemo } from 'react';
import { Download, Layers, Play, Square, Trash2, X } from 'lucide-react';
import type {
  StroMotionOpacityMode,
  StroMotionRenderMode,
  StroMotionSamplingMode,
} from '@/lib/stroMotion';
import { STRO_MOTION_MAX_FRAMES } from '@/lib/stroMotion';

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--cl-text-muted, #888)',
        margin: '12px 0 6px',
      }}
    >
      {children}
    </div>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>
          {value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--cl-accent, #007AFF)' }}
      />
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 3,
        borderRadius: 10,
        background: 'var(--cl-surface-muted, rgba(0,0,0,0.06))',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          style={{
            flex: 1,
            padding: '8px 6px',
            borderRadius: 8,
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            background: value === opt.id ? 'var(--cl-accent, #007AFF)' : 'transparent',
            color: value === opt.id ? '#fff' : 'var(--cl-text, #111)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface StroMotionPanelProps {
  active: boolean;
  onActiveChange: (v: boolean) => void;
  videoDuration: number;
  currentTime: number;
  rangeStart: number;
  rangeEnd: number;
  onRangeStartChange: (t: number) => void;
  onRangeEndChange: (t: number) => void;
  onSetInFromPlayhead: () => void;
  onSetOutFromPlayhead: () => void;
  samplingMode: StroMotionSamplingMode;
  onSamplingModeChange: (m: StroMotionSamplingMode) => void;
  intervalFrames: number;
  onIntervalFramesChange: (n: number) => void;
  manualKeyframes: number[];
  onAddKeyframe: () => void;
  onRemoveKeyframe: (index: number) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  opacityMode: StroMotionOpacityMode;
  onOpacityModeChange: (m: StroMotionOpacityMode) => void;
  renderMode: StroMotionRenderMode;
  onRenderModeChange: (m: StroMotionRenderMode) => void;
  frameCount: number;
  isProcessing: boolean;
  progressCurrent: number;
  progressTotal: number;
  hasFrames: boolean;
  isReady: boolean;
  videoExportSupported: boolean;
  isExportingVideo?: boolean;
  onGenerate: () => void;
  onClear: () => void;
  onExportPng: () => void;
  onExportVideo: () => void;
  onPlayAnimated: () => void;
  onStopAnimated: () => void;
  isAnimating: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export default function StroMotionPanel({
  active,
  onActiveChange,
  videoDuration,
  currentTime,
  rangeStart,
  rangeEnd,
  onSetInFromPlayhead,
  onSetOutFromPlayhead,
  samplingMode,
  onSamplingModeChange,
  intervalFrames,
  onIntervalFramesChange,
  manualKeyframes,
  onAddKeyframe,
  onRemoveKeyframe,
  opacity,
  onOpacityChange,
  opacityMode,
  onOpacityModeChange,
  renderMode,
  onRenderModeChange,
  frameCount,
  isProcessing,
  progressCurrent,
  progressTotal,
  hasFrames,
  isReady,
  videoExportSupported,
  isExportingVideo = false,
  onGenerate,
  onClear,
  onExportPng,
  onExportVideo,
  onPlayAnimated,
  onStopAnimated,
  isAnimating,
  disabled,
  disabledReason,
}: StroMotionPanelProps) {
  const sortedManual = useMemo(
    () => [...manualKeyframes].sort((a, b) => a - b),
    [manualKeyframes],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px 12px' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.45, color: 'var(--cl-text-muted, #666)' }}>
        Stroboscopy: composite movement phases as overlapping ghost frames. Works with uploaded video files.
      </p>

      {disabled && disabledReason ? (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c0392b' }}>{disabledReason}</p>
      ) : null}

      <button
        type="button"
        onClick={() => onActiveChange(!active)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 10,
          border: active ? '2px solid var(--cl-accent, #007AFF)' : '1px solid var(--cl-border, #ddd)',
          background: active ? 'rgba(0,122,255,0.08)' : 'var(--cl-surface, #fff)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          fontSize: 13,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Layers size={18} />
        {active ? 'Stromotion active' : 'Enable Stromotion'}
      </button>

      {active && !disabled ? (
        <>
          <SectionLabel>1 — Range</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <div style={{ padding: 8, borderRadius: 8, background: 'var(--cl-surface-muted, rgba(0,0,0,0.04))' }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>In</div>
              <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(rangeStart)}</div>
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: 'var(--cl-surface-muted, rgba(0,0,0,0.04))' }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Out</div>
              <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{formatTimeShort(rangeEnd)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={onSetInFromPlayhead}
              style={chipBtnStyle}
            >
              Set In @ {formatTimeShort(currentTime)}
            </button>
            <button
              type="button"
              onClick={onSetOutFromPlayhead}
              style={chipBtnStyle}
            >
              Set Out @ {formatTimeShort(currentTime)}
            </button>
          </div>

          <SectionLabel>2 — Sampling</SectionLabel>
          <Segmented
            options={[
              { id: 'auto' as const, label: 'Auto interval' },
              { id: 'manual' as const, label: 'Manual keys' },
            ]}
            value={samplingMode}
            onChange={onSamplingModeChange}
          />

          {samplingMode === 'auto' ? (
            <RangeRow
              label="Every N frames"
              value={intervalFrames}
              min={1}
              max={30}
              step={1}
              onChange={onIntervalFramesChange}
            />
          ) : (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={onAddKeyframe} style={{ ...chipBtnStyle, width: '100%' }}>
                + Mark key frame @ {formatTimeShort(currentTime)}
              </button>
              {sortedManual.length > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    overflowX: 'auto',
                    padding: '8px 0',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {sortedManual.map((t, i) => {
                    const origIdx = manualKeyframes.indexOf(t);
                    return (
                      <div
                        key={`${t}-${i}`}
                        style={{
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 8,
                          background: 'var(--cl-surface-muted, rgba(0,0,0,0.06))',
                          fontSize: 11,
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {formatTimeShort(t)}
                        <button
                          type="button"
                          aria-label="Remove keyframe"
                          onClick={() => onRemoveKeyframe(origIdx)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--cl-text-muted)', margin: '6px 0 0' }}>
                  Scrub the video and mark 4–{STRO_MOTION_MAX_FRAMES} key positions.
                </p>
              )}
            </div>
          )}

          <SectionLabel>3 — Composite</SectionLabel>
          <RangeRow
            label="Ghost opacity"
            value={Math.round(opacity * 100)}
            min={10}
            max={100}
            step={5}
            onChange={(v) => onOpacityChange(v / 100)}
            suffix="%"
          />
          <Segmented
            options={[
              { id: 'temporal' as const, label: 'Temporal fade' },
              { id: 'uniform' as const, label: 'Uniform' },
            ]}
            value={opacityMode}
            onChange={onOpacityModeChange}
          />
          <div style={{ marginTop: 8 }}>
            <Segmented
              options={[
                { id: 'static' as const, label: 'Static' },
                { id: 'animated' as const, label: 'Animated' },
              ]}
              value={renderMode}
              onChange={onRenderModeChange}
            />
          </div>

          <SectionLabel>4 — Output</SectionLabel>
          {isProcessing ? (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Extracting frames… {progressCurrent} / {progressTotal}
            </div>
          ) : hasFrames ? (
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
              {frameCount} frames ready
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={onGenerate}
              disabled={isProcessing}
              style={primaryBtnStyle}
            >
              {isProcessing ? `Processing ${progressCurrent}/${progressTotal}` : 'Generate composite'}
            </button>
            {hasFrames ? (
              <>
                {renderMode === 'animated' ? (
                  <button
                    type="button"
                    onClick={isAnimating ? onStopAnimated : onPlayAnimated}
                    style={secondaryBtnStyle}
                  >
                    {isAnimating ? <Square size={14} /> : <Play size={14} />}
                    {isAnimating ? ' Stop animation' : ' Play animation'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onExportPng}
                  disabled={!isReady || isExportingVideo}
                  style={{
                    ...secondaryBtnStyle,
                    opacity: !isReady || isExportingVideo ? 0.5 : 1,
                    cursor: !isReady || isExportingVideo ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Download size={14} /> Export PNG
                </button>
                <button
                  type="button"
                  onClick={onExportVideo}
                  disabled={!isReady || isExportingVideo || !videoExportSupported}
                  style={{
                    ...secondaryBtnStyle,
                    opacity: !isReady || isExportingVideo || !videoExportSupported ? 0.5 : 1,
                    cursor: !isReady || isExportingVideo || !videoExportSupported ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Download size={14} /> {isExportingVideo ? 'Recording…' : 'Export Video'}
                </button>
                {!videoExportSupported ? (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-muted)', lineHeight: 1.4 }}>
                    Video export is not supported in Safari — use Export PNG instead.
                  </p>
                ) : null}
                <button type="button" onClick={onClear} style={dangerBtnStyle}>
                  <Trash2 size={14} /> Clear frames
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const chipBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 6px',
  borderRadius: 8,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--cl-accent, #007AFF)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--cl-border, #ddd)',
  background: 'var(--cl-surface, #fff)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  color: '#c0392b',
  borderColor: 'rgba(192,57,43,0.3)',
};
