'use client';

import { useState } from 'react';
import { useEntitlement } from '@/lib/useEntitlement';
import { REPORTS_IN_APP } from '@/lib/featureFlags';
import { driveIdsOfEntry, NOTE_MAX } from '@/lib/reports/entryOps';
import { readScreenshotUrls, type EntryLike } from '@/lib/reports/deriveBlocks';
import { mutedText } from '@/components/reports/reportStyles';

/**
 * "Edit this report": change an entry's note, remove an entry, or add a standalone note.
 *
 * - Only with in-app reports (REPORTS_IN_APP) and only for accounts that have the player database
 *   (`players`, Light and up). Without it the report is read-only and this renders nothing.
 * - A failed save or delete never clears what was typed: the text stays and the reason is shown.
 * - Delete asks first, in plain words about what happens to the screenshot. Server order: database row first,
 *   then the Drive file to the Drive trash (never permanent).
 */

const PLACEHOLDER_NOTE = 'Screenshot from analysis session.';
const btn = { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', fontWeight: 700, fontSize: 14, cursor: 'pointer' } as const;
const field = { width: '100%', boxSizing: 'border-box', minHeight: 44, borderRadius: 10, border: '1px solid var(--cl-border)', padding: '10px 12px', fontSize: 16, lineHeight: 1.45, fontFamily: 'inherit', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' } as const;

async function api(url: string, init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && !body.error, body: res.ok && !body.error ? body : { ...body, error: String(body.error ?? body.message ?? `HTTP ${res.status}`) } };
  } catch (e) {
    return { ok: false, body: { error: e instanceof Error ? e.message : 'network error' } };
  }
}

function deleteWords(entry: EntryLike): string {
  const urls = readScreenshotUrls(entry.screenshots);
  const drive = driveIdsOfEntry(entry.screenshots).length;
  const other = urls.length - urls.filter((u) => driveIdsOfEntry([u]).length > 0).length;
  if (urls.length === 0) return 'This removes the entry from AngleMotion.';
  let s = 'This removes the entry from AngleMotion.';
  if (drive > 0) s += ` Its ${drive === 1 ? 'image' : `${drive} images`} in your Google Drive ${drive === 1 ? 'is' : 'are'} moved to your Drive trash, so you can restore ${drive === 1 ? 'it' : 'them'} from there until you empty the trash.`;
  if (other > 0) s += ` ${other === 1 ? 'A copy' : 'Copies'} kept in AngleMotion storage from before ${other === 1 ? 'is' : 'are'} not removed.`;
  return s;
}

function EntryRow({ playerId, entry, onChanged, onRemoved }: { playerId: string; entry: EntryLike; onChanged: () => void; onRemoved: (message: string) => void }) {
  const isNote = entry.category !== 'match';
  const saved = (entry.body_text ?? '').trim() === PLACEHOLDER_NOTE ? '' : (entry.body_text ?? '').trim();
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const shots = readScreenshotUrls(entry.screenshots).length;
  const dirty = isNote && text.trim() !== saved;

  const save = async () => {
    setBusy('save'); setError(null);
    const r = await api(`/api/players/${playerId}/entries/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ note: text }) });
    setBusy(null);
    if (!r.ok) { setError(`Could not save the note — ${String(r.body.error)}. Your text is still here.`); return; }
    onChanged();
  };
  const remove = async () => {
    setBusy('delete'); setError(null);
    const r = await api(`/api/players/${playerId}/entries/${entry.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!r.ok) { setError(`Could not delete the entry — ${String(r.body.error)}. Nothing was removed.`); setConfirming(false); return; }
    onRemoved(String(r.body.message ?? 'The entry was removed.'));
  };

  return (
    <li style={{ listStyle: 'none', padding: '14px 0', borderTop: '1px solid var(--cl-border-subtle)' }}>
      <p style={{ ...mutedText, margin: '0 0 8px', fontSize: 13 }}>
        {entry.category === 'match' ? 'Match report' : shots > 0 ? `${shots} screenshot${shots === 1 ? '' : 's'}` : 'Note'}
        {' · '}{new Date(entry.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </p>
      {isNote && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            placeholder="Add a note"
            aria-label="Note"
            style={field}
          />
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={busy !== null} style={{ ...btn, marginTop: 8, background: 'var(--cl-action-primary)', color: 'var(--cl-text-on-fill)', border: 'none' }}>
              {busy === 'save' ? 'Saving…' : 'Save note'}
            </button>
          )}
        </>
      )}
      {error && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--cl-destructive-text)', lineHeight: 1.45 }}>{error}</p>}
      {confirming ? (
        <div role="alertdialog" aria-label="Delete entry" style={{ marginTop: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--cl-destructive-text)', fontSize: 14, lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 10px' }}>{deleteWords(entry)}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} style={btn}>Cancel</button>
            <button type="button" onClick={() => void remove()} disabled={busy !== null} style={{ ...btn, background: 'var(--cl-destructive-text)', color: '#fff', border: 'none' }}>
              {busy === 'delete' ? 'Deleting…' : 'Delete entry'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null} style={{ ...btn, marginTop: 8, color: 'var(--cl-destructive-text)' }}>
          Delete entry
        </button>
      )}
    </li>
  );
}

export default function EntryManager({
  playerId, entries, canAddNote, onChanged, onLastRemoved,
}: {
  playerId: string;
  entries: EntryLike[];
  /** A standalone note joins a technique report (same day); a match report is one entry and takes none. */
  canAddNote: boolean;
  onChanged: () => void;
  /** Called after an entry is removed and the report has no entries left. */
  onLastRemoved: () => void;
}) {
  const { can } = useEntitlement();
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!REPORTS_IN_APP || !can('players')) return null;

  const add = async () => {
    if (!note.trim()) return;
    setAdding(true); setAddError(null);
    const r = await api(`/api/players/${playerId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ category: 'technique', folder_label: `Note ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, body_text: note.trim(), source: 'report-note' }),
    });
    setAdding(false);
    if (!r.ok) { setAddError(`Could not add the note — ${String(r.body.error)}. Your text is still here.`); return; }
    setNote(''); onChanged();
  };

  return (
    <details style={{ marginTop: 28, borderTop: '1px solid var(--cl-border-subtle)' }}>
      <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Edit notes and entries</summary>
      {notice && <p role="status" style={{ ...mutedText, margin: '4px 0 8px' }}>{notice}</p>}
      {canAddNote && (
        <div style={{ padding: '8px 0 16px' }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={2} placeholder="Add a note to this report" aria-label="New note" style={field} />
          {addError && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--cl-destructive-text)' }}>{addError}</p>}
          <button type="button" onClick={() => void add()} disabled={adding || !note.trim()} style={{ ...btn, marginTop: 8 }}>
            {adding ? 'Adding…' : 'Add note'}
          </button>
        </div>
      )}
      <ul style={{ margin: 0, padding: 0 }}>
        {entries.map((e) => (
          <EntryRow
            key={e.id}
            playerId={playerId}
            entry={e}
            onChanged={onChanged}
            onRemoved={(message) => { setNotice(message); if (entries.length <= 1) onLastRemoved(); else onChanged(); }}
          />
        ))}
      </ul>
    </details>
  );
}
