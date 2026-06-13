'use client';

import { useEffect } from 'react';

export default function AnalysisError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[analysis] route error:', error);
  }, [error]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        color: '#e8e8e8',
        textAlign: 'center',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Something went wrong</h2>
      <p style={{ margin: 0, maxWidth: 420, fontSize: 14, color: '#aaa', lineHeight: 1.5 }}>
        The video analysis workspace hit an unexpected error. Your session data may be recoverable
        after a reload.
      </p>
      {process.env.NODE_ENV !== 'production' && error.message ? (
        <pre
          style={{
            margin: 0,
            maxWidth: 'min(90vw, 560px)',
            padding: 12,
            borderRadius: 8,
            background: '#1a1a1a',
            color: '#f88',
            fontSize: 12,
            overflow: 'auto',
            textAlign: 'left',
          }}
        >
          {error.message}
        </pre>
      ) : null}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#fff',
            color: '#111',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: '1px solid #444',
            background: 'transparent',
            color: '#e8e8e8',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
