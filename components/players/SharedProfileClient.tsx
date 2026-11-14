'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MetricChart } from '@/components/players/PlayerMetrics';
import { groupMetrics, type MetricRow } from '@/lib/players/metrics';
import { uploadToResumableSession } from '@/lib/export/youtubeResumableUpload';
import { entriesNewestFirst } from '@/lib/players/technicalSheet';
import TrackerCard, { type TrackerActions } from '@/components/players/trackers/TrackerCard';
import type { Tracker, TrackerEntry } from '@/lib/players/trackers';
import { addKindForCategory, type SharePermissions } from '@/lib/players/sharePermissions';
import { newRef } from '@/components/players/ui';
import NutritionSection from '@/components/players/nutrition/NutritionSection';
import HistoryFeed, { type HistoryPage } from '@/components/players/history/HistoryFeed';
import { HISTORY_SECTIONS } from '@/lib/players/history';
import { playerNutritionClient } from '@/components/players/nutrition/nutritionClient';
import WorkoutsSection from '@/components/players/workouts/WorkoutsSection';
import { playerWorkoutsClient } from '@/components/players/workouts/workoutsClient';
import MentalSection from '@/components/players/mental/MentalSection';
import TodoCard from '@/components/players/mental/TodoCard';
import { playerMentalClient, playerTodoClient } from '@/components/players/mental/mentalClient';

type Item = { id: string; kind: 'note' | 'picture' | 'video'; body: string; media_url: string | null; youtube_id: string | null; created_at: string; author: 'coach' | 'link' };
type Data = { name: string; sheet: Array<{ label: string; value: string; kind?: 'track'; entries?: Array<{ id: string; date: string; text: string }> }>; items: Item[]; metrics: MetricRow[]; canAdd: boolean; timelineOrder?: string[] | null; trackers?: Tracker[]; trackerEntries?: TrackerEntry[]; trackersAvailable?: boolean; permissions?: SharePermissions };

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 16, minWidth: 0 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const ghost: React.CSSProperties = { ...btn, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', border: '1px solid var(--cl-border)' };
const panel: React.CSSProperties = { background: 'rgba(250, 249, 247, 0.96)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 18, marginBottom: 16 };
const today = () => new Date().toISOString().slice(0, 10);

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
  c.width = c.height = 0;
  if (!blob) throw new Error('Could not read that picture');
  return blob;
}

/** What the player sees at /share/<token>: no sign-in. */
export default function SharedProfileClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'email' | 'gone'>('loading');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [mName, setMName] = useState('');
  const [mUnit, setMUnit] = useState('');
  const [mVal, setMVal] = useState('');
  const [mDate, setMDate] = useState(today());
  const picRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const headers = useCallback((): Record<string, string> => (email.trim() ? { 'x-share-email': email.trim() } : {}), [email]);
  const nutritionClient = useMemo(() => playerNutritionClient(token, headers), [token, headers]);
  const workoutsClient = useMemo(() => playerWorkoutsClient(token, headers), [token, headers]);
  const mentalClient = useMemo(() => playerMentalClient(token, headers), [token, headers]);
  const todoClient = useMemo(() => playerTodoClient(token, headers), [token, headers]);
  // Answering a questionnaire can complete a to-do task: the to-do card reloads then.
  const [todoKey, setTodoKey] = useState(0);
  // The universal timeline (only the sections this link may see; the server enforces it).
  const [feedKey, setFeedKey] = useState(0);
  const fetchHistory = useCallback(async (params: URLSearchParams): Promise<HistoryPage> => {
    const res = await fetch(`/api/share/${token}/history?${params.toString()}`, { cache: 'no-store', headers: headers() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not load the timeline');
    return { items: body.items ?? [], next: body.next ?? null };
  }, [token, headers]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/${token}`, { cache: 'no-store', headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body.needsEmail) { setState('email'); setErr(email ? 'That email does not match.' : null); return; }
      if (!res.ok) { setState('gone'); return; }
      setData(body); setState('ok'); setErr(null);
    } catch { setState('gone'); }
  }, [token, headers, email]);
  useEffect(() => { void load(); /* first load only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async (init: RequestInit) => {
    const res = await fetch(`/api/share/${token}`, { method: 'POST', ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headers() } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not save');
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); await load(); setFeedKey((k) => k + 1); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const json = (b: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

  const series = useMemo(() => groupMetrics(data?.metrics ?? []), [data]);
  const can = data?.permissions?.add;
  /** Entries go to the coach for review; the player can correct or withdraw them until then. */
  const trackerActions = (category: string): TrackerActions | null => {
    const kind = addKindForCategory(category);
    if (!kind || !can?.[kind]) return null;
    const call = async (url: string, method: string, body?: unknown) => {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers() }, body: body === undefined ? undefined : JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? 'Could not save');
      await load();
    };
    return {
      addEntry: (trackerId, p) => call(`/api/share/${token}/tracker-entries`, 'POST', { ...p, tracker_id: trackerId, client_ref: newRef() }),
      updateEntry: (entry, p) => call(`/api/share/${token}/tracker-entries/${entry.id}`, 'PATCH', p),
      deleteEntry: (entry) => call(`/api/share/${token}/tracker-entries/${entry.id}`, 'DELETE'),
    };
  };
  const toFix = (data?.trackerEntries ?? []).filter((e) => e.author === 'link' && e.status === 'needs_revision').length;

  if (state === 'loading') return <p style={{ padding: 24 }}>Loading…</p>;
  if (state === 'gone') return <p style={{ padding: 24 }}>This link is not available. Ask your coach for a new one.</p>;
  if (state === 'email' || !data) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', padding: 16 }}>
        <div style={panel}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Enter your email</h1>
          <p style={{ fontSize: 13, color: 'var(--cl-text-secondary)' }}>Your coach asked for the email this link was shared with.</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ ...inp, width: '100%' }} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
          {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 12 }}>{err}</p> : null}
          <button type="button" style={{ ...btn, marginTop: 10 }} onClick={() => void load()}>Open</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 48px', color: 'var(--cl-text-primary)' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 14px' }}>{data.name}</h1>
      {err ? <p style={{ color: 'var(--cl-destructive-text)', fontSize: 13 }}>{err}</p> : null}
      {toFix ? (
        <div role="status" style={{ ...panel, borderColor: 'rgba(255,59,48,0.35)', background: 'rgba(255,59,48,0.05)' }}>
          <strong style={{ fontSize: 14 }}>Your coach asked you to fix {toFix === 1 ? 'one entry' : `${toFix} entries`}.</strong>
          <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', marginTop: 4 }}>Look for “Needs a fix” below, tap the pencil, correct it and save: it goes back to your coach.</div>
        </div>
      ) : null}

      <TodoCard key={todoKey} client={todoClient} />

      {data.sheet.length > 0 ? (
        <div style={panel}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Profile</h2>
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {data.sheet.map((r, i) => (
              r.kind === 'track' ? (
                <div key={`${r.label}-${i}`} style={{ fontSize: 13, gridColumn: '1 / -1' }}>
                  <div style={{ color: 'var(--cl-text-muted)', fontSize: 11 }}>{r.label}</div>
                  {entriesNewestFirst({ label: r.label, value: '', kind: 'track', entries: r.entries }).map((en) => (
                    <div key={en.id} style={{ display: 'flex', gap: 8, padding: '4px 0', borderTop: '1px solid var(--cl-border)' }}>
                      <span style={{ fontSize: 12, color: 'var(--cl-text-muted)', whiteSpace: 'nowrap' }}>{en.date}</span>
                      <span style={{ whiteSpace: 'pre-wrap', flex: 1, minWidth: 0 }}>{en.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div key={`${r.label}-${i}`} style={{ fontSize: 13 }}>
                  <div style={{ color: 'var(--cl-text-muted)', fontSize: 11 }}>{r.label}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{r.value}</div>
                </div>
              )
            ))}
          </div>
        </div>
      ) : null}

      {(['progress', 'biometrics', 'fitness'] as const).map((cat) => {
        const list = (data.trackers ?? []).filter((t) => t.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat} style={panel}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>{cat === 'progress' ? 'Progress' : cat === 'biometrics' ? 'Biometrics' : 'Fitness'}</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {list.map((t) => (
                <TrackerCard key={t.id} tracker={t} entries={(data.trackerEntries ?? []).filter((e) => e.tracker_id === t.id)} actions={trackerActions(t.category)} viewer="player" />
              ))}
            </div>
          </div>
        );
      })}

      {(series.length > 0 || (data.canAdd && (can?.progress ?? true))) ? (
        <div style={panel}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>{data.trackersAvailable ? 'Send a value to your coach' : 'Progress'}</h2>
          {series.map((s) => (
            <div key={s.key} style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{s.name}</strong>
                <span style={{ fontSize: 13 }}>{s.latest.value}{s.unit ? ` ${s.unit}` : ''}{s.change !== null ? ` (${s.change > 0 ? '+' : ''}${Math.round(s.change * 100) / 100} since first)` : ''}</span>
              </div>
              <MetricChart points={s.points} />
              {data.canAdd && (can?.progress ?? true) ? (
                <button type="button" style={{ ...ghost, marginTop: 6 }} onClick={() => { setMName(s.name); setMUnit(s.unit); }}>Add a value to {s.name}</button>
              ) : null}
            </div>
          ))}
          {data.canAdd && (can?.progress ?? true) ? (
            <div style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10, marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="What (e.g. 5 km run)" style={{ ...inp, flex: '1 1 140px' }} />
              <input value={mUnit} onChange={(e) => setMUnit(e.target.value)} placeholder="Unit" style={{ ...inp, width: 80 }} />
              <input inputMode="decimal" value={mVal} onChange={(e) => setMVal(e.target.value)} placeholder="Value" style={{ ...inp, width: 90 }} />
              <input type="date" value={mDate} max={today()} onChange={(e) => setMDate(e.target.value)} style={{ ...inp, width: 150 }} />
              <button type="button" style={btn} disabled={!!busy || !mName.trim() || !mVal.trim()} onClick={() => void run('Saving…', async () => {
                await post(json({ kind: 'metric', name: mName, unit: mUnit, value: mVal, recorded_on: mDate })); setMVal('');
              })}>Add value</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.permissions?.see.nutrition ? <NutritionSection client={nutritionClient} /> : null}
      {data.permissions?.see.workouts ? <WorkoutsSection client={workoutsClient} /> : null}
      {data.permissions?.see.mental || (data.canAdd && data.permissions?.add.questionnaires) ? <MentalSection client={mentalClient} onChanged={() => setTodoKey((k) => k + 1)} /> : null}

      {(data.permissions?.see.timeline ?? true) ? (
      <div style={panel}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Timeline</h2>
        {data.canAdd && (can?.comments || can?.pictures || can?.videos || !can) ? (
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            {(can?.comments ?? true) ? <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" style={{ ...inp, resize: 'vertical' }} /> : null}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(can?.comments ?? true) ? <button type="button" style={btn} disabled={!!busy || !text.trim()} onClick={() => void run('Saving…', async () => { await post(json({ kind: 'note', body: text })); setText(''); })}>Add comment</button> : null}
              {(can?.pictures ?? true) ? <button type="button" style={ghost} disabled={!!busy} onClick={() => picRef.current?.click()}>Add picture</button> : null}
              {(can?.videos ?? true) ? <button type="button" style={ghost} disabled={!!busy} onClick={() => vidRef.current?.click()}>Upload video</button> : null}
            </div>
            {(can?.videos ?? true) ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link" style={{ ...inp, flex: 1 }} />
              <button type="button" style={ghost} disabled={!!busy || !link.trim()} onClick={() => void run('Saving…', async () => { await post(json({ kind: 'video', youtube_url: link, body: '' })); setLink(''); })}>Add video</button>
            </div>
            ) : null}
            <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void run('Uploading picture…', async () => {
                const blob = await shrink(f); const form = new FormData(); form.append('file', new File([blob], 'picture.jpg', { type: 'image/jpeg' })); await post({ body: form });
              });
            }} />
            <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void run('Uploading video…', async () => {
                const res = await fetch(`/api/share/${token}/youtube-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ sizeBytes: f.size, mimeType: f.type || 'video/mp4' }) });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || !body.uploadUrl) throw new Error(body.error ?? 'Could not start the video upload');
                const up = await uploadToResumableSession(body.uploadUrl, f, (p) => setBusy(`Uploading video… ${Math.round(p * 100)}%`));
                if (!up.ok || !up.url) throw new Error(up.error ?? 'The video upload failed');
                await post(json({ kind: 'video', youtube_url: up.url, body: '' }));
              });
            }} />
            {busy ? <div style={{ fontSize: 12 }}>{busy}</div> : null}
          </div>
        ) : null}
        <HistoryFeed
          viewer="player"
          fetchPage={fetchHistory}
          sections={HISTORY_SECTIONS.filter((s) => data.permissions?.see[s] ?? true)}
          order={data.timelineOrder ?? null}
          reloadKey={feedKey}
        />
      </div>
      ) : null}
      <p style={{ fontSize: 11, color: 'var(--cl-text-muted)', textAlign: 'center' }}>Made with AngleMotion</p>
    </div>
  );
}
