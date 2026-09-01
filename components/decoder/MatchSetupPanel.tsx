'use client';

/**
 * Match setup — two names, and nothing else.
 *
 * WHAT THIS PANEL USED TO DEMAND, AND WHY IT WAS WRONG
 * It asked the coach to map every OCR'd game-header name to a side, and every
 * stats screenshot to a side: around ten dropdowns. That was work the app can do
 * itself, and — worse — work the coach could not do reliably. Header names OCR so
 * badly that one player fragments into "= Arthur", "Seg Arthur" and "WF IF" plus
 * an unreadable opponent; being asked which garbled fragment is which player is
 * being asked to guess, and one wrong guess silently dropped attributed points
 * from 28 to 22.
 *
 * WHAT REPLACES IT
 * Type the names. Serve alternates every game, so the server for every game
 * follows from its number, and the whole assignment reduces to one bit: which
 * side serves the odd games. That bit is inferred by matching a header against a
 * typed name ("Seg Arthur" still contains "Arthur"), and if nothing matches it is
 * defaulted and flipped with a single Swap button.
 *
 * The old per-item controls survive under Advanced, collapsed — a rare fallback
 * for a genuinely ambiguous case, not the default flow.
 */

import React, { useCallback } from 'react';
import type { AutoAssignment } from '@/lib/matchAnalysis/autoAssign';
import type { MatchSetup, SideId } from '@/lib/matchAnalysis/types';
import type { PlayerStatBlock, StitchedTimeline } from '@/lib/matchDecoder/types';

interface Props {
  setup: MatchSetup;
  onChange: (next: MatchSetup) => void;
  auto: AutoAssignment | null;
  timeline: StitchedTimeline | null;
  playerStats: PlayerStatBlock[];
  thumbnails: Record<number, string>;
  /** Per-item manual overrides, applied on top of the automatic assignment. */
  overrides: { clusters: Record<string, SideId | null>; stats: Record<number, SideId | null> };
  onOverridesChange: (next: Props['overrides']) => void;
}

export default function MatchSetupPanel({
  setup,
  onChange,
  auto,
  timeline,
  playerStats,
  thumbnails,
  overrides,
  onOverridesChange,
}: Props) {
  const setFormat = useCallback(
    (format: 'singles' | 'doubles') => {
      const size = format === 'singles' ? 1 : 2;
      onChange({
        ...setup,
        format,
        sides: [
          { id: 'A', playerNames: resize(setup.sides[0].playerNames, size) },
          { id: 'B', playerNames: resize(setup.sides[1].playerNames, size) },
        ],
      });
    },
    [setup, onChange],
  );

  const setName = useCallback(
    (sideIndex: 0 | 1, nameIndex: number, value: string) => {
      const sides = [{ ...setup.sides[0] }, { ...setup.sides[1] }] as MatchSetup['sides'];
      const names = [...sides[sideIndex].playerNames];
      names[nameIndex] = value;
      sides[sideIndex] = { ...sides[sideIndex], playerNames: names };
      onChange({ ...setup, sides });
    },
    [setup, onChange],
  );

  const gamesPerSide = (id: SideId) =>
    timeline?.games.filter((g) => setup.serverSideByGameKey[g.key] === id).length ?? 0;
  const statsPerSide = (id: SideId) =>
    Object.entries(setup.statsScreenshotToSide).filter(([, v]) => v === id).length;

  return (
    <div style={card}>
      <h2 style={h2}>1 · Who played?</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['singles', 'doubles'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormat(f)}
            style={{
              ...pill,
              background: setup.format === f ? 'var(--cl-action-primary)' : 'var(--cl-bg-panel)',
              color: setup.format === f ? 'var(--cl-text-on-fill)' : 'var(--cl-text-primary)',
            }}
          >
            {f === 'singles' ? 'Singles' : 'Doubles'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {([0, 1] as const).map((i) => (
          <div key={i} style={{ flex: '1 1 240px' }}>
            <div style={fieldLabel}>Side {i === 0 ? 'A' : 'B'}</div>
            {setup.sides[i].playerNames.map((name, j) => (
              <input
                key={j}
                value={name}
                onChange={(e) => setName(i, j, e.target.value)}
                placeholder={setup.format === 'doubles' ? `Player ${j + 1}` : 'Player name'}
                style={input}
              />
            ))}
          </div>
        ))}
      </div>
      <p style={hint}>
        That&apos;s the only thing you need to fill in. Names are yours — they are never read from the
        screenshots, so a misread name in SwingVision can&apos;t reach the report.
      </p>

      {/* ── What the app worked out on its own ── */}
      {auto && timeline && timeline.games.length > 0 && (
        <div style={autoBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <b style={{ fontSize: 12 }}>Worked out automatically</b>
            <button
              type="button"
              onClick={() => onChange({ ...setup, swapSides: !setup.swapSides })}
              style={swapBtn}
            >
              ⇄ Swap sides
            </button>
            {setup.swapSides && <span style={{ fontSize: 10, color: 'var(--cl-text-secondary)' }}>(swapped)</span>}
          </div>

          <div style={{ fontSize: 11.5, marginBottom: 8 }}>
            <b>{labelOf(setup, 'A')}</b> — serves {gamesPerSide('A')} game(s), {statsPerSide('A')} stats
            screenshot(s) &nbsp;·&nbsp; <b>{labelOf(setup, 'B')}</b> — serves {gamesPerSide('B')} game(s),{' '}
            {statsPerSide('B')} stats screenshot(s)
          </div>

          {auto.notes.map((n, i) => (
            <div key={i} style={{ fontSize: 10.5, color: 'var(--cl-text-secondary)', lineHeight: 1.5, marginTop: 3 }}>
              · {n}
            </div>
          ))}
          {auto.ambiguities.map((a, i) => (
            <div key={i} style={{ fontSize: 10.5, color: 'var(--cl-warning-text)', lineHeight: 1.5, marginTop: 4 }}>
              ⚠ {a}
            </div>
          ))}
          {auto.orientationBasis !== 'matched a typed name' && (
            <div style={{ fontSize: 10.5, color: 'var(--cl-warning-text)', lineHeight: 1.5, marginTop: 4 }}>
              ⚠ Check the two sides aren&apos;t reversed — if the numbers look swapped, hit Swap sides.
            </div>
          )}

          {/* The old flow, demoted to a rare fallback. */}
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 10.5, color: 'var(--cl-text-muted)', cursor: 'pointer' }}>
              Advanced — override an individual assignment (you shouldn&apos;t normally need this)
            </summary>

            {Object.keys(auto.clusterToSide).length > 0 && (
              <>
                <div style={advLabel}>Game-header names, as OCR read them</div>
                {Object.entries(auto.clusterToSide).map(([cluster, autoSide]) => (
                  <div key={cluster} style={assignRow}>
                    <code style={chip}>{cluster}</code>
                    <span style={{ fontSize: 10, color: 'var(--cl-text-secondary)', flex: 1 }}>
                      auto: Side {applySwap(autoSide, setup.swapSides) ?? '—'}
                    </span>
                    <select
                      value={overrides.clusters[cluster] ?? ''}
                      onChange={(e) =>
                        onOverridesChange({
                          ...overrides,
                          clusters: { ...overrides.clusters, [cluster]: (e.target.value || null) as SideId | null },
                        })
                      }
                      style={select}
                    >
                      <option value="">use automatic</option>
                      <option value="A">force Side A</option>
                      <option value="B">force Side B</option>
                    </select>
                  </div>
                ))}
              </>
            )}

            {playerStats.length > 0 && (
              <>
                <div style={advLabel}>Stats screenshots</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {playerStats.map((block) => (
                    <div key={block.screenshotIndex} style={{ width: 120 }}>
                      {thumbnails[block.screenshotIndex] && (
                        <img
                          src={thumbnails[block.screenshotIndex]}
                          alt={`screenshot ${block.screenshotIndex}`}
                          style={{ width: 120, height: 84, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--cl-border)' }}
                        />
                      )}
                      <div style={{ fontSize: 9.5, color: 'var(--cl-text-secondary)', margin: '3px 0 2px' }}>
                        #{block.screenshotIndex} → auto:{' '}
                        {setup.statsScreenshotToSide[block.screenshotIndex] ?? 'combined'}
                      </div>
                      <select
                        value={overrides.stats[block.screenshotIndex] ?? ''}
                        onChange={(e) =>
                          onOverridesChange({
                            ...overrides,
                            stats: {
                              ...overrides.stats,
                              [block.screenshotIndex]: (e.target.value || null) as SideId | null,
                            },
                          })
                        }
                        style={{ ...select, width: '100%' }}
                      >
                        <option value="">use automatic</option>
                        <option value="A">Side A</option>
                        <option value="B">Side B</option>
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}
          </details>
        </div>
      )}
    </div>
  );
}

function resize(names: string[], size: number): string[] {
  const out = [...names];
  while (out.length < size) out.push('');
  return out.slice(0, size);
}

const applySwap = (s: SideId | null, swap: boolean): SideId | null =>
  s === null ? null : swap ? (s === 'A' ? 'B' : 'A') : s;

export function labelOf(setup: MatchSetup, id: SideId): string {
  const names = setup.sides.find((s) => s.id === id)?.playerNames ?? [];
  const clean = names.map((n) => n.trim()).filter(Boolean);
  return clean.length ? clean.join(' & ') : `Side ${id}`;
}

const card: React.CSSProperties = {
  background: 'var(--cl-bg-panel)', border: '1px solid var(--cl-border)', borderRadius: 14,
  padding: 22, marginBottom: 18, color: 'var(--cl-text-primary)',
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: '0 0 16px' };
const hint: React.CSSProperties = { fontSize: 11, color: 'var(--cl-text-secondary)', lineHeight: 1.5, margin: '4px 0 0', maxWidth: 620 };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--cl-text-secondary)', marginBottom: 6 };
const input: React.CSSProperties = {
  width: '100%', borderRadius: 8, border: '1px solid var(--cl-border)', padding: '9px 11px',
  fontSize: 14, marginBottom: 8, boxSizing: 'border-box',
};
const pill: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 999, border: '1px solid var(--cl-border)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const autoBox: React.CSSProperties = {
  marginTop: 18, padding: 12, borderRadius: 10, background: '#F7F7F5', border: '1px solid #EAEAE6',
};
const swapBtn: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 999, border: '1px solid #D6D3D1',
  background: 'var(--cl-bg-panel)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const advLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: 'var(--cl-text-secondary)', margin: '10px 0 4px' };
const assignRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid #F0F0EE',
};
const chip: React.CSSProperties = {
  background: 'var(--cl-bg-panel)', border: '1px solid var(--cl-border)', borderRadius: 6, padding: '2px 7px',
  fontSize: 11, fontFamily: 'ui-monospace, monospace',
};
const select: React.CSSProperties = { fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--cl-border)' };
