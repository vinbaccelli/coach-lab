'use client';

import type { CSSProperties } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export type PointRow = {
  id: string;
  server: string;
  score: string;
  shot: string;
  outcome: string;
  notes: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function MatchReportClient() {
  const [rows, setRows] = useState<PointRow[]>(() => []);

  const addRow = useCallback(() => {
    setRows((r) => [
      ...r,
      { id: uid(), server: '', score: '', shot: '', outcome: '', notes: '' },
    ]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((r) => r.filter((x) => x.id !== id));
  }, []);

  const patch = useCallback((id: string, patch: Partial<PointRow>) => {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const exportPreview = useMemo(() => JSON.stringify(rows, null, 2), [rows]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, opacity: 0.82 }}>
        Log points when you don&apos;t have ball tracking. This page stores data in your browser for now. When the decoder and database are connected, you&apos;ll send this
        to the AI pipeline and the player&apos;s match analysis in one step.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          onClick={addRow}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 40,
            padding: '0 16px',
            borderRadius: 10,
            border: '1px solid rgba(53,103,154,0.5)',
            background: '#35679A',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Plus size={18} />
          Add point
        </button>
        <span style={{ fontSize: 12, opacity: 0.55, alignSelf: 'center' }}>
          {rows.length} point{rows.length === 1 ? '' : 's'} logged
        </span>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)', textAlign: 'left' }}>
              <th style={{ padding: 10, fontWeight: 700 }}>#</th>
              <th style={{ padding: 10, fontWeight: 700 }}>Server</th>
              <th style={{ padding: 10, fontWeight: 700 }}>Score</th>
              <th style={{ padding: 10, fontWeight: 700 }}>Shot</th>
              <th style={{ padding: 10, fontWeight: 700 }}>Outcome</th>
              <th style={{ padding: 10, fontWeight: 700 }}>Notes</th>
              <th style={{ padding: 10, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 22, opacity: 0.55 }}>
                  No points yet — tap &quot;Add point&quot; to start.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ padding: 8, opacity: 0.75 }}>{idx + 1}</td>
                  <td style={{ padding: 6 }}>
                    <input
                      value={row.server}
                      onChange={(e) => patch(row.id, { server: e.target.value })}
                      placeholder="e.g. Player A"
                      style={cellInput}
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input
                      value={row.score}
                      onChange={(e) => patch(row.id, { score: e.target.value })}
                      placeholder="40–30"
                      style={cellInput}
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input
                      value={row.shot}
                      onChange={(e) => patch(row.id, { shot: e.target.value })}
                      placeholder="FH, serve…"
                      style={cellInput}
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input
                      value={row.outcome}
                      onChange={(e) => patch(row.id, { outcome: e.target.value })}
                      placeholder="Winner, UE…"
                      style={cellInput}
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input
                      value={row.notes}
                      onChange={(e) => patch(row.id, { notes: e.target.value })}
                      placeholder="Short note"
                      style={cellInput}
                    />
                  </td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      title="Remove row"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        cursor: 'pointer',
                        padding: 6,
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', opacity: 0.5, textTransform: 'uppercase' }}>
          Export preview (for AI decoder later)
        </h3>
        <pre
          style={{
            marginTop: 8,
            padding: 14,
            borderRadius: 10,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: 11,
            lineHeight: 1.4,
            overflow: 'auto',
            maxHeight: 220,
            color: 'rgba(255,255,255,0.75)',
          }}
        >
          {rows.length ? exportPreview : '{ "points": [] }'}
        </pre>
      </div>
    </div>
  );
}

const cellInput: CSSProperties = {
  width: '100%',
  minWidth: 72,
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  fontSize: 13,
  outline: 'none',
};
