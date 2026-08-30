'use client';

import React from 'react';

/**
 * LazyPanelBoundary — a LOCAL Suspense + error boundary for a lazily-loaded panel.
 *
 * WHY THIS EXISTS.
 * app/analysis/page.tsx loads several heavy panels with React.lazy
 * (StroMotionPanel, FrameMaskEditor, StroMotionPreviewModal). None of them had a
 * Suspense boundary of their own, so the nearest one was the page-root
 * `<React.Suspense fallback={null}><Home/></React.Suspense>` — meaning the FIRST
 * time a coach opened Motion Layer, React hid the ENTIRE analysis page and
 * rendered the root fallback: `null`. That is the black screen reported from the
 * phone. On a desktop dev server the chunk arrives in a few ms so the blank is
 * invisible; on a phone over cellular it lasts seconds, and if the chunk request
 * fails it never comes back.
 *
 * A boundary around each lazy panel keeps the blanking scoped to the panel and
 * gives it a visible fallback, and the error boundary turns a failed chunk fetch
 * into a message with a retry instead of nothing at all.
 */

type Props = {
  children: React.ReactNode;
  /** Shown while the chunk loads. */
  fallback?: React.ReactNode;
  /** Rendered full-screen (fixed overlay) rather than inline. */
  overlay?: boolean;
  /** Short name used in the failure message, e.g. "Motion Layer". */
  label?: string;
};

type State = { error: Error | null };

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10050,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(0,0,0,0.78)',
  color: '#fff',
  fontSize: 14,
};

const inlineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '18px 12px',
  fontSize: 13,
  color: '#6E6E73',
  textAlign: 'center',
};

class LazyPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; overlay?: boolean; label?: string },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[LazyPanelBoundary] panel failed to load/render:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { overlay, label } = this.props;
    const name = label ?? 'This panel';
    return (
      <div style={overlay ? overlayStyle : { ...inlineStyle, color: '#9a3412' }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>{name} couldn’t open</strong>
          <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.8, lineHeight: 1.45 }}>
            Something went wrong loading it — this usually means the connection dropped
            mid-download, or the device ran out of memory. Go back and try again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#007AFF',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}

export default function LazyPanelBoundary({ children, fallback, overlay, label }: Props) {
  const defaultFallback = (
    <div style={overlay ? overlayStyle : inlineStyle}>
      {label ? `Loading ${label}…` : 'Loading…'}
    </div>
  );
  return (
    <LazyPanelErrorBoundary overlay={overlay} label={label}>
      <React.Suspense fallback={fallback ?? defaultFallback}>{children}</React.Suspense>
    </LazyPanelErrorBoundary>
  );
}
