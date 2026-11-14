'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Check, Plus, Repeat, Trash2 } from 'lucide-react';
import { assignmentState, RECURRENCES, RECURRENCE_LABELS, validateAssignment, type AssignmentState, type Recurrence } from '@/lib/players/mental';
import { badge, card, chip, dashedBtn, ghostBtn, h2, input, muted, panel, primaryBtn, shortDate, todayLocal } from '@/components/players/ui';
import type { Assignment, TodoClient } from '@/components/players/mental/mentalClient';

const STATE: Record<AssignmentState, { label: (d: string | null) => string; tone: 'pending' | 'warn' | 'info' | 'ok' }> = {
  overdue: { label: (d) => `Overdue since ${shortDate(d ?? '')}`, tone: 'warn' },
  today: { label: () => 'Due today', tone: 'pending' },
  upcoming: { label: (d) => `Due ${shortDate(d ?? '')}`, tone: 'info' },
  no_date: { label: () => 'No date', tone: 'info' },
  done: { label: () => 'Done', tone: 'ok' },
  cancelled: { label: () => 'Cancelled', tone: 'info' },
};
const small: CSSProperties = { ...chip, display: 'inline-flex', alignItems: 'center', gap: 4 };

/**
 * The player's to-do (in-app reminders): tasks with a due date, optionally repeating, or "answer
 * this questionnaire". The coach creates and follows them (overdue first); the player ticks them off.
 */
export default function TodoCard({ client }: { client: TodoClient }) {
  const today = todayLocal();
  const coach = client.viewer === 'coach';
  const [list, setList] = useState<Assignment[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [canComplete, setCanComplete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [rec, setRec] = useState<Recurrence>('none');
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await client.load();
      setList(d.assignments);
      setSetupNeeded(d.setupNeeded);
      setCanComplete(d.canComplete);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
      setList((x) => x ?? []);
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  if (setupNeeded) return coach ? <section style={{ ...panel, marginBottom: 18 }}><h2 style={h2}>To do for the player</h2><p style={muted}>Needs the one-time database update.</p></section> : null;
  const all = list ?? [];
  const open = all.filter((a) => a.status === 'open').sort((a, b) => (a.due_on ?? '9999') < (b.due_on ?? '9999') ? -1 : 1);
  const closed = all.filter((a) => a.status !== 'open');
  const overdue = open.filter((a) => assignmentState(a, today) === 'overdue').length;
  if (!coach && list !== null && !open.length && !closed.length) return null;

  const create = () => {
    const v = validateAssignment({ title, description, due_on: due || null, recurrence: rec });
    if (!v.ok) { setErr(v.error); return; }
    void act(async () => { await client.create!(v.value); setTitle(''); setDescription(''); setDue(''); setRec('none'); setAdding(false); });
  };

  const row = (a: Assignment) => {
    const st = assignmentState(a, today);
    const s = STATE[st];
    return (
      <div key={a.id} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 8, display: 'grid', gap: 4 }} data-testid="todo-item" data-state={st}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, textDecoration: a.status === 'cancelled' ? 'line-through' : 'none' }}>{a.title}</strong>
          <span style={badge(s.tone)}>{s.label(a.due_on)}</span>
          {a.recurrence !== 'none' ? <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Repeat size={11} /> {RECURRENCE_LABELS[a.recurrence]}</span> : null}
          {a.status === 'done' && a.done_by ? <span style={muted}>by {a.done_by === 'link' ? (coach ? 'the player' : 'you') : 'the coach'}</span> : null}
        </div>
        {a.description ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', whiteSpace: 'pre-wrap' }}>{a.description}</div> : null}
        {a.status === 'open' ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {a.questionnaire_id ? <span style={muted}>{coach ? 'Done when the player answers the questionnaire.' : 'Answer the questionnaire below to complete it.'}</span> : null}
            {coach && client.setStatus ? (
              <>
                <button type="button" disabled={busy} onClick={() => void act(() => client.setStatus!(a, 'done'))} style={small}><Check size={12} /> Done</button>
                <button type="button" disabled={busy} onClick={() => void act(() => client.setStatus!(a, 'cancelled'))} style={small}>Cancel</button>
              </>
            ) : null}
            {!coach && canComplete && client.complete && !a.questionnaire_id ? (
              <button type="button" disabled={busy} onClick={() => void act(() => client.complete!(a))} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Done</button>
            ) : null}
            {coach && client.remove ? <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${a.title}”?`)) void act(() => client.remove!(a)); }} style={{ ...small, color: '#b3261e' }} aria-label={`Delete ${a.title}`}><Trash2 size={12} /></button> : null}
          </div>
        ) : coach && client.setStatus ? (
          <div><button type="button" disabled={busy} onClick={() => void act(() => client.setStatus!(a, 'open'))} style={small}>Open again</button></div>
        ) : null}
      </div>
    );
  };

  return (
    <section style={{ ...panel, marginBottom: 18, display: 'grid', gap: 10 }} aria-label="To do" data-testid="todo-card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h2 style={h2}>{coach ? 'To do for the player' : 'Your to-do'}</h2>
        {open.length ? <span style={badge('info')}>{open.length}</span> : null}
        {overdue ? <span style={badge('warn')}>{overdue} overdue</span> : null}
      </div>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {list === null ? <div style={muted}>Loading…</div> : null}
      {coach && client.create ? (adding ? (
        <div style={{ ...card, display: 'grid', gap: 8 }} data-testid="todo-form">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should the player do?" aria-label="Task" style={input} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details (optional)" aria-label="Details" style={{ ...input, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" style={{ ...input, flex: '1 1 140px', width: 0 }} />
            <select value={rec} onChange={(e) => setRec(e.target.value as Recurrence)} aria-label="Repeat" style={{ ...input, flex: '1 1 120px', width: 0 }}>
              {RECURRENCES.map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy || !title.trim()} onClick={create} style={primaryBtn}>Add</button>
            <button type="button" onClick={() => setAdding(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : <div><button type="button" onClick={() => setAdding(true)} style={{ ...dashedBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> Task</button></div>) : null}
      {list && !open.length ? <div style={muted}>{coach ? 'Nothing open.' : 'All done.'}</div> : null}
      {open.map(row)}
      {closed.length ? (
        <div>
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} style={chip}>{showDone ? 'Hide' : 'Show'} done ({closed.length})</button>
          {showDone ? <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>{closed.map(row)}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
