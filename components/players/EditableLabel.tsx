'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { input } from '@/components/players/ui';

/** A row name that the coach can rename in place (Enter saves, Escape cancels). */
export default function EditableLabel({ label, canEdit, onRename, suffix }: {
  label: string;
  canEdit: boolean;
  /** Returns an error message to keep the field open, or null when renamed. */
  onRename: (next: string) => string | null;
  suffix?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    const next = value.trim();
    if (!next || next === label) { setEditing(false); setErr(null); return; }
    const problem = onRename(next);
    if (problem) { setErr(problem); return; }
    setEditing(false);
    setErr(null);
  };
  if (editing) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <input
          autoFocus
          aria-label={`Rename ${label}`}
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setEditing(false); setValue(label); setErr(null); } }}
          style={{ ...input, padding: '4px 8px', fontSize: 16, fontWeight: 600 }}
        />
        {err ? <span style={{ fontSize: 11, color: '#b3261e', fontWeight: 500 }}>{err}</span> : null}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>{label}</span>
      {suffix}
      {canEdit ? (
        <button type="button" aria-label={`Rename ${label}`} onClick={(e) => { e.preventDefault(); setValue(label); setEditing(true); }}
          style={{ border: 'none', background: 'none', padding: 2, cursor: 'pointer', color: 'var(--cl-text-muted)', display: 'inline-flex' }}>
          <Pencil size={12} />
        </button>
      ) : null}
    </span>
  );
}
