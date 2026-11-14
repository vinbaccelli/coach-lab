'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Tracker, TrackerCategory, TrackerDefinition, TrackerEntry } from '@/lib/players/trackers';
import { presetsFor, blankDefinition, BIOMETRICS_PRESET } from '@/lib/players/trackerPresets';
import TrackerCard, { type TrackerActions } from '@/components/players/trackers/TrackerCard';
import TrackerEditor from '@/components/players/trackers/TrackerEditor';
import ReorderList from '@/components/players/ReorderList';
import SetupNotice from '@/components/players/SetupNotice';
import PlayerMetrics from '@/components/players/PlayerMetrics';
import { apiJson, chip, dashedBtn, muted, newRef, panel, h2, primaryBtn } from '@/components/players/ui';

const COPY: Record<string, { title: string; intro: string; empty: string }> = {
  progress: { title: 'Progress', intro: 'Anything you want to follow over time: serve speed, UTR, ranking, rally length… Each tracker keeps its history and draws its graph.', empty: 'No trackers yet.' },
  biometrics: { title: 'Biometrics', intro: 'Height, weight, body composition. Fill in only what you measured that day; BMI is calculated.', empty: 'Biometrics are not set up for this player yet.' },
  fitness: { title: 'Fitness', intro: 'Physical tests and exercises: runs, push-ups, squats, jumps, mobility. Pick an example or create your own.', empty: 'No fitness trackers yet.' },
};

/** One section of the profile (Progress, Biometrics or Fitness): its trackers, in the coach's order. */
export default function TrackerSection({ playerId, category, canEdit }: { playerId: string; category: TrackerCategory; canEdit: boolean }) {
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState<TrackerDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/players/${playerId}`;
  const copy = COPY[category] ?? COPY.progress;

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ trackers: Tracker[]; entries: TrackerEntry[]; setupNeeded?: boolean }>(`${base}/trackers?category=${category}`);
      setSetupNeeded(Boolean(data.setupNeeded));
      setTrackers(data.trackers ?? []);
      setEntries(data.entries ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
      setTrackers((t) => t ?? []);
    }
  }, [base, category]);
  useEffect(() => { void load(); }, [load]);

  const byTracker = useMemo(() => {
    const m = new Map<string, TrackerEntry[]>();
    entries.forEach((e) => { const a = m.get(e.tracker_id); if (a) a.push(e); else m.set(e.tracker_id, [e]); });
    return m;
  }, [entries]);

  const actions: TrackerActions | null = canEdit ? {
    addEntry: async (trackerId, p) => {
      const r = await apiJson<{ entry: TrackerEntry }>(`${base}/trackers/${trackerId}/entries`, { method: 'POST', json: { ...p, client_ref: newRef() } });
      setEntries((prev) => (prev.some((x) => x.id === r.entry.id) ? prev : [...prev, r.entry]));
    },
    updateEntry: async (entry, p) => {
      const r = await apiJson<{ entry: TrackerEntry }>(`${base}/tracker-entries/${entry.id}`, { method: 'PATCH', json: { ...p, expected_updated_at: entry.updated_at } });
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? r.entry : x)));
    },
    deleteEntry: async (entry) => {
      await apiJson(`${base}/tracker-entries/${entry.id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((x) => x.id !== entry.id));
    },
    reviewEntry: async (entry, status, note) => {
      const r = await apiJson<{ entry: TrackerEntry }>(`${base}/tracker-entries/${entry.id}`, { method: 'PATCH', json: { status, review_note: note } });
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? r.entry : x)));
    },
    updateTracker: async (tracker, d) => {
      const r = await apiJson<{ tracker: Tracker }>(`${base}/trackers/${tracker.id}`, { method: 'PATCH', json: { definition: d, expected_updated_at: tracker.updated_at } });
      setTrackers((prev) => (prev ?? []).map((t) => (t.id === tracker.id ? r.tracker : t)));
    },
    archiveTracker: async (tracker) => {
      await apiJson(`${base}/trackers/${tracker.id}`, { method: 'PATCH', json: { archived: true } });
      setTrackers((prev) => (prev ?? []).filter((t) => t.id !== tracker.id));
    },
    deleteTracker: async (tracker) => {
      await apiJson(`${base}/trackers/${tracker.id}`, { method: 'DELETE' });
      setTrackers((prev) => (prev ?? []).filter((t) => t.id !== tracker.id));
      setEntries((prev) => prev.filter((e) => e.tracker_id !== tracker.id));
    },
  } : null;

  const create = async (body: { preset: string } | { definition: TrackerDefinition }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiJson<{ tracker: Tracker }>(`${base}/trackers`, { method: 'POST', json: body });
      setTrackers((prev) => [...(prev ?? []), r.tracker]);
      setCreating(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the tracker');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (next: Tracker[]) => {
    setTrackers(next);
    try {
      await apiJson(`${base}/trackers/reorder`, { method: 'POST', json: { ids: next.map((t) => t.id) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the order');
      void load();
    }
  };

  const presets = presetsFor(category);
  const hasBiometrics = (trackers ?? []).some((t) => t.preset === 'biometrics');

  return (
    <section style={{ ...panel, marginBottom: 18, display: 'grid', gap: 12 }} aria-label={copy.title}>
      <div>
        <h2 style={h2}>{copy.title}</h2>
        <p style={{ ...muted, margin: '4px 0 0' }}>{copy.intro}</p>
      </div>
      {setupNeeded ? <SetupNotice what={copy.title} /> : null}
      {/* Until the tracker tables exist, the old progress values stay visible and editable here. */}
      {setupNeeded && category === 'progress' ? <PlayerMetrics playerId={playerId} canEdit={canEdit} /> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {trackers === null ? <div style={muted}>Loading…</div> : null}

      {trackers && trackers.length ? (
        <ReorderList
          items={trackers}
          getKey={(t) => t.id}
          disabled={!canEdit || trackers.length < 2}
          onReorder={(next) => void reorder(next)}
          containerStyle={{ display: 'grid', gap: 12 }}
          renderItem={(t, _i, handle) => (
            <TrackerCard tracker={t} entries={byTracker.get(t.id) ?? []} actions={actions} viewer="coach" handle={trackers.length > 1 ? handle : null} />
          )}
        />
      ) : trackers && !setupNeeded ? <div style={muted}>{copy.empty}</div> : null}

      {canEdit && !setupNeeded && trackers ? (
        creating ? (
          <TrackerEditor title="New tracker" initial={creating} onCancel={() => setCreating(null)} onSave={(d) => create({ definition: d })} />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {category === 'biometrics' && !hasBiometrics ? (
              <div><button type="button" disabled={busy} onClick={() => void create({ preset: BIOMETRICS_PRESET.key }).catch(() => {})} style={primaryBtn}><Plus size={14} /> Start biometrics</button></div>
            ) : null}
            {category === 'fitness' ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ ...muted, marginRight: 2 }}>Add an exercise:</span>
                {presets.map((p) => (
                  <button key={p.key} type="button" title={p.hint} disabled={busy} onClick={() => void create({ preset: p.key }).catch(() => {})} style={chip}>+ {p.label}</button>
                ))}
              </div>
            ) : null}
            <div>
              <button type="button" onClick={() => setCreating({ ...blankDefinition(category) })} style={dashedBtn}>
                <Plus size={14} /> {category === 'fitness' ? 'Custom exercise' : category === 'biometrics' ? 'Other measurement tracker' : 'New tracker'}
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
