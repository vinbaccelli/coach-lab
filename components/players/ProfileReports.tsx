'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * The Reports and Statistics sections of the grouped player profile (PlayerProfileView). Same data
 * and behavior as the sections of the original profile with REPORTS_IN_APP on: tabs All / Technical /
 * Match, a text search, newest first, an entry opens its in-app report, the Drive folder link when the
 * player has one, and the measurement progression. The tour ids (`player-doc-links`,
 * `player-report-tabs`) stay on the same elements. Styles come from PROFILE_CSS in PlayerProfileView.
 */

export type ProfileEntry = {
  id: string;
  category: 'technique' | 'match';
  folder_label: string;
  body_text: string;
  youtube_url?: string | null;
  created_at: string;
  screenshots?: unknown;
  metadata?: {
    doc_url?: string;
    measurements?: Array<{ snapshot: string; label: string; value: number; unit: string; timeSec: number }>;
  } | null;
};

const TABS = [['all', 'All'], ['technique', 'Technical Analysis'], ['match', 'Match Analysis']] as const;

export default function ProfileReports({
  playerId,
  folderId,
  entries,
}: {
  playerId: string;
  folderId?: string | null;
  entries: ProfileEntry[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'technique' | 'match'>('all');
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries]
      .filter((e) => (tab === 'all' ? true : e.category === tab))
      .filter((e) => !q || e.folder_label.toLowerCase().includes(q) || (e.body_text ?? '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [entries, tab, search]);

  // Measurements across all report entries, grouped by metric (unchanged logic).
  const statSeries = useMemo(() => {
    const byLabel = new Map<string, Array<{ date: string; value: number; unit: string; snapshot: string }>>();
    for (const e of entries) {
      for (const m of e.metadata?.measurements ?? []) {
        if (typeof m?.value !== 'number' || !m.label) continue;
        const list = byLabel.get(m.label) ?? [];
        list.push({ date: e.created_at, value: m.value, unit: m.unit ?? '', snapshot: m.snapshot ?? '' });
        byLabel.set(m.label, list);
      }
    }
    for (const list of byLabel.values()) list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return byLabel;
  }, [entries]);
  const [statMetric, setStatMetric] = useState('');
  const statLabels = useMemo(() => [...statSeries.keys()].sort(), [statSeries]);
  const activeStat = statSeries.get(statMetric || statLabels[0] || '') ?? [];

  const open = (id: string) => router.push(`/players/${playerId}/reports/${id}`);

  return (
    <>
      <section id="reports" className="pp-group" aria-labelledby="pp-reports-h">
        <div className="pp-group-h">
          <h2 id="pp-reports-h">Reports</h2>
          <div data-tour-id="player-doc-links" className="pp-links">
            <Link href={`/players/${playerId}/reports`} className="pp-link">Open reports →</Link>
            {folderId ? (
              <a href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank" rel="noreferrer" className="pp-link">
                Open Drive folder ↗
              </a>
            ) : null}
          </div>
        </div>
        <p className="pp-hint">Match and technique reports, newest first. Tap an entry to open its report.</p>
        <div className="pp-card">
          <div data-tour-id="player-report-tabs" className="pp-tools">
            <div className="pp-seg" role="group" aria-label="Report type">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="pp-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              aria-label="Search reports"
            />
          </div>
          {shown.length === 0 ? (
            <p className="pp-empty">No entries yet.</p>
          ) : (
            shown.map((e) => (
              <article
                key={e.id}
                className="pp-entry"
                role="link"
                tabIndex={0}
                onClick={() => open(e.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') open(e.id); }}
              >
                <div className="pp-entry-meta">
                  <span className="pp-tag">{e.category === 'match' ? 'Match analysis' : 'Technique analysis'}</span>
                  <span>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <div className="pp-entry-title">{e.folder_label}</div>
                {e.youtube_url ? (
                  <a
                    href={e.youtube_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    className="pp-link pp-entry-yt"
                  >
                    YouTube link
                  </a>
                ) : null}
                {e.body_text?.trim() ? (
                  <p className="pp-entry-body">{e.body_text.length > 600 ? `${e.body_text.slice(0, 600)}…` : e.body_text}</p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      {statLabels.length > 0 ? (
        <section className="pp-group" aria-labelledby="pp-stats-h">
          <div className="pp-group-h">
            <h2 id="pp-stats-h">Statistics</h2>
            <select
              className="pp-select"
              value={statMetric || statLabels[0]}
              onChange={(e) => setStatMetric(e.target.value)}
              aria-label="Metric"
            >
              {statLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <p className="pp-hint">Values from every exported report, oldest to newest.</p>
          <div className="pp-card pp-pad">
            {activeStat.length === 0 ? (
              <p className="pp-empty">No values yet for this metric.</p>
            ) : (() => {
              const values = activeStat.map((d) => d.value);
              const min = Math.min(...values);
              const max = Math.max(...values);
              const avg = values.reduce((s, v) => s + v, 0) / values.length;
              const span = Math.max(1e-6, Math.abs(max) > Math.abs(min) ? Math.abs(max) : Math.abs(min));
              const unit = activeStat[0]?.unit ?? '';
              return (
                <>
                  <div className="pp-stat-sum">
                    <span><strong>Min</strong> {Math.round(min * 10) / 10}{unit}</span>
                    <span><strong>Avg</strong> {Math.round(avg * 10) / 10}{unit}</span>
                    <span><strong>Max</strong> {Math.round(max * 10) / 10}{unit}</span>
                    <span><strong>Samples</strong> {values.length}</span>
                  </div>
                  <div className="pp-stat-rows">
                    {activeStat.slice(-30).map((d, i) => (
                      <div key={i} className="pp-stat-row">
                        <span className="pp-stat-date">{new Date(d.date).toLocaleDateString()}{d.snapshot ? ` · ${d.snapshot}` : ''}</span>
                        <div className="pp-stat-track">
                          <div className="pp-stat-bar" style={{ width: `${Math.max(2, Math.min(100, (Math.abs(d.value) / span) * 100))}%` }} />
                        </div>
                        <span className="pp-stat-val">{Math.round(d.value * 10) / 10}{d.unit}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </section>
      ) : null}
    </>
  );
}
