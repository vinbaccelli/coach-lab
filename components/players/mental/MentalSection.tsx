'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, Lock, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { describeAnswer, scaleTrends } from '@/lib/players/mental';
import { badge, card, chip, ghostBtn, h2, input, muted, panel, primaryBtn, shortDate } from '@/components/players/ui';
import SetupNotice from '@/components/players/SetupNotice';
import QuestionnaireForm from '@/components/players/mental/QuestionnaireForm';
import QuestionnaireEditor from '@/components/players/mental/QuestionnaireEditor';
import type { MentalClient, PlayerQuestionnaire, QResponse, QTemplate } from '@/components/players/mental/mentalClient';

type Mode = { kind: 'none' } | { kind: 'send' } | { kind: 'assess' } | { kind: 'templates' } | { kind: 'editTemplate'; t?: QTemplate } | { kind: 'answer'; q: PlayerQuestionnaire; previous?: QResponse };
const small: CSSProperties = { ...chip, display: 'inline-flex', alignItems: 'center', gap: 4 };

/**
 * Mental: questionnaires the player answers and the coach's private assessments, with the answers
 * over time. Strict access: assessments never reach the player; the player sees their past answers
 * only when the coach lets the link see Mental.
 */
export default function MentalSection({ client, onChanged }: { client: MentalClient; /** After an answer is sent or removed (the to-do may have changed). */ onChanged?: () => void }) {
  const coach = client.viewer === 'coach';
  const [qs, setQs] = useState<PlayerQuestionnaire[] | null>(null);
  const [responses, setResponses] = useState<QResponse[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [canAnswer, setCanAnswer] = useState(false);
  const [canSee, setCanSee] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await client.load();
      setQs(d.questionnaires);
      setResponses(d.responses);
      setSetupNeeded(d.setupNeeded);
      setCanAnswer(d.canAnswer);
      setCanSee(d.canSee);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
      setQs((x) => x ?? []);
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  const byQ = useMemo(() => {
    const m = new Map<string, QResponse[]>();
    for (const r of responses) { const a = m.get(r.questionnaire_id); if (a) a.push(r); else m.set(r.questionnaire_id, [r]); }
    return m;
  }, [responses]);

  const responseBlock = (q: PlayerQuestionnaire, r: QResponse) => {
    const mine = !coach && r.author === 'link' && r.status !== 'approved';
    return (
      <div key={r.id} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 8, display: 'grid', gap: 4 }} data-testid="q-response">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <strong>{shortDate(r.answered_on)}</strong>
          {r.author === 'link' ? <span style={badge('info')}>{coach ? 'Player' : 'You'}</span> : <span style={badge('ok')}>Coach</span>}
          {r.author === 'link' && r.status === 'submitted' ? <span style={badge('pending')}>{coach ? 'To read' : 'Sent to your coach'}</span> : null}
          {r.status === 'needs_revision' ? <span style={badge('warn')}>Needs a fix</span> : null}
        </div>
        {coach || canSee || r.status === 'needs_revision' ? (
          <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
            {q.questions.filter((x) => r.answers[x.id] !== undefined).map((x) => (
              <div key={x.id}><span style={{ color: 'var(--cl-text-secondary)' }}>{x.label}: </span><strong style={{ whiteSpace: 'pre-wrap' }}>{describeAnswer(x, r.answers[x.id])}</strong></div>
            ))}
          </div>
        ) : null}
        {r.status === 'needs_revision' && r.review_note ? <div style={{ fontSize: 12, color: '#b3261e' }}>{coach ? 'You asked: ' : 'Coach: '}{r.review_note}</div> : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {coach && client.review && r.author === 'link' && r.status === 'submitted' ? (
            fixFor === r.id ? (
              <>
                <input autoFocus value={fixNote} onChange={(e) => setFixNote(e.target.value)} placeholder="What should the player change?" aria-label="What should the player change?" style={{ ...input, flex: '1 1 200px', width: 0 }} />
                <button type="button" disabled={!fixNote.trim() || busy} onClick={() => void act(async () => { await client.review!(r, 'needs_revision', fixNote.trim()); setFixFor(null); })} style={primaryBtn}>Send</button>
                <button type="button" onClick={() => setFixFor(null)} style={ghostBtn}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void act(() => client.review!(r, 'approved'))} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Mark as read</button>
                <button type="button" disabled={busy} onClick={() => { setFixFor(r.id); setFixNote(''); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}><Undo2 size={13} /> Ask for a fix</button>
              </>
            )
          ) : null}
          {mine && client.answer && q.status === 'open' ? <button type="button" onClick={() => setMode({ kind: 'answer', q, previous: r })} style={small}><Pencil size={12} /> Correct</button> : null}
          {(mine || coach) && client.withdraw ? <button type="button" disabled={busy} onClick={() => { if (window.confirm('Delete these answers?')) void act(async () => { await client.withdraw!(r); onChanged?.(); }); }} style={{ ...small, color: '#b3261e' }}><Trash2 size={12} /> Delete</button> : null}
        </div>
      </div>
    );
  };

  const qCard = (q: PlayerQuestionnaire) => {
    const rs = byQ.get(q.id) ?? [];
    const expanded = open === q.id;
    const trends = coach || canSee ? scaleTrends(q.questions, rs) : [];
    const waiting = rs.some((r) => r.author === 'link' && r.status !== 'approved');
    return (
      <div key={q.id} style={{ ...card, display: 'grid', gap: 8, padding: 12 }} data-testid="questionnaire" data-kind={q.kind}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{q.title}</strong>
          {q.kind === 'assessment' ? <span style={badge('info')}><Lock size={10} /> Private assessment</span> : null}
          {q.status === 'closed' ? <span style={badge('info')}>Closed</span> : null}
          {q.due_on ? <span style={muted}>due {shortDate(q.due_on)}</span> : null}
          <span style={muted}>· {rs.length === 1 ? 'one answer' : `${rs.length} answers`}</span>
        </div>
        {q.description ? <div style={muted}>{q.description}</div> : null}
        {trends.some((t) => t.points.length > 1) ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="q-trends">
            {trends.filter((t) => t.points.length > 1).map((t) => (
              <span key={t.id} style={{ ...badge(t.improved === null ? 'info' : t.improved ? 'ok' : 'warn'), fontWeight: 600 }} title={t.points.map((p) => `${shortDate(p.date)}: ${p.value}`).join(', ')}>
                {t.label}: {t.points[0].value} → {t.points[t.points.length - 1].value}
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {q.status === 'open' && client.answer && (coach || (canAnswer && !waiting)) ? (
            <button type="button" onClick={() => setMode({ kind: 'answer', q })} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}>{coach ? (q.kind === 'assessment' ? 'Fill in' : 'Answer with the player') : 'Answer'}</button>
          ) : null}
          {rs.length ? <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : q.id)} style={small}>{expanded ? 'Hide' : 'Show'} answers</button> : null}
          {coach && client.setStatus ? <button type="button" disabled={busy} onClick={() => void act(() => client.setStatus!(q, q.status === 'open' ? 'closed' : 'open'))} style={small}>{q.status === 'open' ? 'Close' : 'Reopen'}</button> : null}
          {coach && client.remove ? <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${q.title}” and its answers?`)) void act(() => client.remove!(q)); }} style={{ ...small, color: '#b3261e' }}><Trash2 size={12} /></button> : null}
        </div>
        {expanded ? rs.map((r) => responseBlock(q, r)) : null}
      </div>
    );
  };

  if (!coach && !canSee && !canAnswer && qs !== null) return null;
  const list = qs ?? [];
  const assessments = list.filter((q) => q.kind === 'assessment');
  const questionnaires = list.filter((q) => q.kind === 'questionnaire');

  const form = (() => {
    if (mode.kind === 'answer' && client.answer) {
      const q = mode.q;
      return <QuestionnaireForm title={q.title} description={q.description} questions={q.questions} initial={mode.previous?.answers} saveLabel={coach ? 'Save' : 'Send to coach'} onCancel={() => setMode({ kind: 'none' })} onSave={async (a) => { await client.answer!(q, a, mode.previous); setMode({ kind: 'none' }); setOpen(q.id); await load(); onChanged?.(); }} />;
    }
    if ((mode.kind === 'send' || mode.kind === 'assess') && client.send) return <SendForm client={client} assessment={mode.kind === 'assess'} onCancel={() => setMode({ kind: 'none' })} onSent={(q) => { void load(); setMode(mode.kind === 'assess' ? { kind: 'answer', q } : { kind: 'none' }); }} />;
    if (mode.kind === 'templates' && client.templates) return <TemplateList client={client} onEdit={(t) => setMode({ kind: 'editTemplate', t })} onClose={() => setMode({ kind: 'none' })} />;
    if (mode.kind === 'editTemplate' && client.saveTemplate) {
      const t = mode.t;
      return <QuestionnaireEditor initial={t ? { kind: t.kind, title: t.title, description: t.description, questions: t.questions } : undefined} onCancel={() => setMode({ kind: 'templates' })} onSave={async (input) => { await client.saveTemplate!(input, t); setMode({ kind: 'templates' }); }} />;
    }
    return null;
  })();

  return (
    <section style={{ ...panel, marginBottom: 18, display: 'grid', gap: 14 }} aria-label="Mental" data-testid="mental-section">
      <div>
        <h2 style={h2}>{coach ? 'Mental' : 'Questionnaires'}</h2>
        <p style={{ ...muted, margin: '4px 0 0' }}>
          {coach
            ? 'Questionnaires the player answers and your private assessments. Assessments are never shown to the player; the player sees past answers only if you allow Mental on the share link.'
            : 'Questions from your coach. Your answers go to your coach.'}
        </p>
      </div>
      {setupNeeded ? <SetupNotice what="Mental" /> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {qs === null ? <div style={muted}>Loading…</div> : null}
      {!setupNeeded && qs !== null ? (
        <>
          {form ?? (coach && client.send ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setMode({ kind: 'send' })} style={primaryBtn}><Plus size={14} /> Send a questionnaire</button>
              <button type="button" onClick={() => setMode({ kind: 'assess' })} style={ghostBtn}><Lock size={14} /> New assessment</button>
              <button type="button" onClick={() => setMode({ kind: 'templates' })} style={ghostBtn}>My questionnaires</button>
            </div>
          ) : null)}
          {questionnaires.length ? <div style={{ display: 'grid', gap: 8 }}>{questionnaires.map(qCard)}</div> : <div style={muted}>{coach ? 'No questionnaire sent yet.' : 'Nothing to answer right now.'}</div>}
          {coach && assessments.length ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>Your assessments</strong>
              {assessments.map(qCard)}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SendForm({ client, assessment, onSent, onCancel }: { client: MentalClient; assessment: boolean; onSent: (q: PlayerQuestionnaire) => void; onCancel: () => void }) {
  const [templates, setTemplates] = useState<QTemplate[] | null>(null);
  const [pick, setPick] = useState('');
  const [due, setDue] = useState('');
  const [todo, setTodo] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.templates?.().then((t) => setTemplates(t.filter((x) => x.kind === (assessment ? 'assessment' : 'questionnaire')))).catch(() => setTemplates([])); }, [client, assessment]);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try { onSent(await client.send!({ template_id: pick, due_on: assessment ? null : due || null, add_to_todo: !assessment && todo })); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); setBusy(false); }
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="send-questionnaire">
      <h2 style={h2}>{assessment ? 'New assessment (private)' : 'Send a questionnaire'}</h2>
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Questionnaire" style={input}>
        <option value="">Choose…</option>
        {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}{t.coach_id ? ' (yours)' : ''}</option>)}
      </select>
      {!assessment ? (
        <>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, color: 'var(--cl-text-secondary)' }}>
            Answer by (optional)
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Answer by" style={input} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Put it in the player&apos;s to-do</label>
        </>
      ) : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy || !pick} onClick={() => void go()} style={primaryBtn}>{busy ? 'Saving…' : assessment ? 'Start' : 'Send'}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

function TemplateList({ client, onEdit, onClose }: { client: MentalClient; onEdit: (t?: QTemplate) => void; onClose: () => void }) {
  const [list, setList] = useState<QTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { client.templates?.().then(setList).catch((e) => { setErr(e instanceof Error ? e.message : 'Could not load'); setList([]); }); }, [client]);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={{ ...card, display: 'grid', gap: 8 }} data-testid="questionnaire-templates">
      <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ ...h2, flex: 1 }}>Questionnaires</h2><button type="button" onClick={onClose} style={chip}>Done</button></div>
      <p style={{ ...muted, margin: 0 }}>Built-in ones can be sent as they are; make your own for anything else. What was already sent keeps its questions.</p>
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {(list ?? []).map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--cl-border)', paddingTop: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title} {t.kind === 'assessment' ? <span style={badge('info')}>Assessment</span> : null}</div>
            <div style={{ ...muted, fontSize: 11 }}>{t.coach_id ? 'Yours' : 'Built-in'} · {t.questions.length} questions</div>
          </div>
          {t.coach_id ? (
            <>
              <button type="button" onClick={() => onEdit(t)} style={small} aria-label={`Edit ${t.title}`}><Pencil size={12} /></button>
              <button type="button" onClick={() => { if (window.confirm(`Delete “${t.title}”?`)) void client.deleteTemplate!(t).then(load).catch((e) => setErr(e instanceof Error ? e.message : 'Could not delete')); }} style={{ ...small, color: '#b3261e' }} aria-label={`Delete ${t.title}`}><Trash2 size={12} /></button>
            </>
          ) : null}
        </div>
      ))}
      <div><button type="button" onClick={() => onEdit(undefined)} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}><Plus size={13} /> New questionnaire</button></div>
    </div>
  );
}
