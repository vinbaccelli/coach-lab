'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import PlayerNav from '@/components/reports/PlayerNav';
import PlanLockedNotice from '@/components/PlanLockedNotice';
import DeletePlayerSection from '@/components/players/DeletePlayerSection';
import ProfileReports, { type ProfileEntry } from '@/components/players/ProfileReports';
import {
  draftFromPlayer,
  isDirty,
  runSave,
  sendPatch,
  syncTemplate,
  type PlayerFields,
  type PlayingHand,
  type ProfileDraft,
} from '@/components/players/profileSave';
import {
  addRowIfMissing,
  ageFromDob,
  groupSheetRows,
  isLongLabel,
  missingSuggestions,
  normalizeLabel,
  rowValue,
  type IndexedRow,
} from '@/lib/players/technicalSheet';

/**
 * The player profile with REPORTS_IN_APP on (the original profile, with it off, is unchanged in
 * PlayerProfileClient). A header card, the facts in grouped sections made from the technical-sheet
 * labels (no schema change), the reports and statistics, and the Danger zone, in one column that
 * works at 390 px. Everything the coach can edit sits in ONE draft and is saved with ONE PATCH through
 * the existing /api/players/[id] route; a failed save keeps what was typed (components/players/profileSave.ts).
 */

export type ProfilePlayer = PlayerFields & {
  id: string;
  display_name: string;
  google_folder_id?: string | null;
};

const HANDS: Array<[PlayingHand, string]> = [['right', 'Right'], ['left', 'Left'], ['unknown', 'Not set']];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A text field that wraps and grows; Enter ends the edit unless the field is a long one. */
function AutoText({
  id,
  value,
  onChange,
  readOnly,
  placeholder,
  label,
  multiline,
  inputMode,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  placeholder?: string;
  label: string;
  multiline: boolean;
  inputMode?: 'url' | 'text';
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className="pp-text"
      rows={1}
      value={value}
      readOnly={readOnly}
      placeholder={readOnly ? undefined : placeholder}
      aria-label={label}
      inputMode={inputMode}
      autoCapitalize="sentences"
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}

export default function PlayerProfileView({
  playerId,
  player,
  entries,
  canEdit,
  loadError,
}: {
  playerId: string;
  player: ProfilePlayer;
  entries: ProfileEntry[];
  canEdit: boolean;
  loadError: string | null;
}) {
  // The saved copy and the draft (what is on screen). Only the page's own saves change `base`.
  const [base, setBase] = useState<ProfileDraft>(() => draftFromPlayer(player));
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromPlayer(player));
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const inFlight = useRef(false);
  const dirty = isDirty(base, draft);
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  const [newRowLabel, setNewRowLabel] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const save = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus({ kind: 'saving' });
    const result = await runSave(base, draft, (patch) => sendPatch(playerId, patch));
    inFlight.current = false;
    if (result.ok) {
      setBase(result.base);
      if (result.templateLabels) syncTemplate(result.templateLabels);
      setStatus({ kind: 'saved' });
    } else {
      // The draft is untouched: what the coach typed is still on screen, ready to try again.
      setStatus({ kind: 'error', message: result.error });
    }
  }, [base, draft, playerId]);

  // "Saved" goes away by itself.
  useEffect(() => {
    if (status.kind !== 'saved') return;
    const t = setTimeout(() => setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s)), 2500);
    return () => clearTimeout(t);
  }, [status]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // After "+ UTR" or "Add a row", the new field takes the cursor.
  useEffect(() => {
    if (focusIndex === null) return;
    document.getElementById(`pp-f-${focusIndex}`)?.focus();
    setFocusIndex(null);
  }, [focusIndex, draft.sheet.length]);

  const setField = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setRow = (index: number, value: string) =>
    setDraft((d) => ({ ...d, sheet: d.sheet.map((r, i) => (i === index ? { ...r, value } : r)) }));
  const addRow = (label: string) => {
    const next = addRowIfMissing(draft.sheet, label);
    if (next.length === draft.sheet.length) return; // already there: nothing is overwritten
    setDraft((d) => ({ ...d, sheet: next }));
    setFocusIndex(next.length - 1);
  };
  const removeRow = (index: number) => {
    const label = draft.sheet[index]?.label ?? '';
    // Also removes the row from the coach's default sheet for new players, so ask first (as before).
    if (!window.confirm(`Delete the "${label}" row?\n\nThis also removes it from your default technical sheet for new players (existing players keep their rows). Save the profile to keep the change.`)) return;
    setDraft((d) => ({ ...d, sheet: d.sheet.filter((_, i) => i !== index) }));
  };

  const groups = useMemo(() => groupSheetRows(draft.sheet), [draft.sheet]);
  const suggestions = useMemo(() => missingSuggestions(draft.sheet), [draft.sheet]);
  const age = ageFromDob(draft.date_of_birth, new Date());
  const level = rowValue(draft.sheet, 'Level');
  const utr = rowValue(draft.sheet, 'UTR');
  const photo = draft.photo_url.trim();
  const showPhoto = photo !== '' && photoFailed !== photo;
  const readOnly = !canEdit;

  const meta = [
    age !== null ? `${age} years old` : null,
    draft.nationality.trim() || null,
    draft.playing_hand === 'right' ? 'Right-handed' : draft.playing_hand === 'left' ? 'Left-handed' : null,
    level ? `Level ${level}` : null,
  ].filter((v): v is string => v !== null);

  /** One sheet row: short ones sit beside their label, sentences and lists under it. */
  const renderRow = ({ index, row }: IndexedRow) => {
    const long = isLongLabel(row.label);
    // With a date of birth the age is worked out, so the typed "Age" row is not shown (it stays stored, untouched).
    if (normalizeLabel(row.label) === 'age' && age !== null) {
      return (
        <div className="pp-row" key={`${index}-age`}>
          <span className="pp-label">{row.label}</span>
          <span className="pp-fixed">{age} <span className="pp-sub">from date of birth</span></span>
        </div>
      );
    }
    return (
      <div className={`pp-row${long ? ' long' : ''}`} key={`${index}-${row.label}`}>
        <label className="pp-label" htmlFor={`pp-f-${index}`}>{row.label}</label>
        <div className="pp-field">
          <AutoText
            id={`pp-f-${index}`}
            label={row.label}
            value={row.value}
            multiline={long}
            readOnly={readOnly}
            onChange={(v) => setRow(index, v)}
          />
        </div>
        {!readOnly ? (
          <button type="button" className="pp-x" aria-label={`Delete ${row.label} row`} onClick={() => removeRow(index)}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  };

  const suggestionsFor = (labels: string[]) =>
    !readOnly && suggestions.some((s) => labels.includes(s)) ? (
      <div className="pp-sugg" aria-label="Fields you can add">
        {suggestions.filter((s) => labels.includes(s)).map((s) => (
          <button key={s} type="button" className="pp-add" onClick={() => addRow(s)}>
            <Plus size={16} aria-hidden="true" /> {s}
          </button>
        ))}
      </div>
    ) : null;

  const section = (id: string, title: string, rows: IndexedRow[], extra?: React.ReactNode, hint?: string, labels: string[] = []) => (
    <section className="pp-group" aria-labelledby={`pp-${id}-h`}>
      <div className="pp-group-h"><h2 id={`pp-${id}-h`}>{title}</h2></div>
      {hint ? <p className="pp-hint">{hint}</p> : null}
      <div className="pp-card">
        {rows.map(renderRow)}
        {rows.length === 0 && !suggestionsFor(labels) ? <p className="pp-empty">Nothing here yet.</p> : null}
        {suggestionsFor(labels)}
        {extra}
      </div>
    </section>
  );

  const barVisible = canEdit && (dirty || status.kind === 'saving' || status.kind === 'saved' || status.kind === 'error');

  return (
    <div className="pp-root">
      <style>{PROFILE_CSS}</style>
      <PlayerNav playerId={playerId} playerName={player.display_name} current="profile" maxWidth={880} />

      {!canEdit ? (
        <PlanLockedNotice feature="players">
          The player database is part of Pro. This profile stays readable; editing it needs Pro.
        </PlanLockedNotice>
      ) : null}
      {loadError ? <div role="alert" className="pp-err">{loadError}</div> : null}

      {/* Header */}
      <header className="pp-head">
        <div className="pp-avatar" aria-hidden="true">
          {showPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(photo)} />
          ) : (
            initials(player.display_name)
          )}
        </div>
        <div className="pp-head-text">
          <h1 data-tour-id="player-profile" className="pp-name">{player.display_name}</h1>
          {meta.length > 0 ? <p className="pp-meta">{meta.join(' · ')}</p> : <p className="pp-meta pp-sub">Add a date of birth, nationality and level below.</p>}
          <div className="pp-chips">
            {utr ? <span className="pp-chip">UTR {utr}</span> : null}
            <a className="pp-jump" href="#reports">{entries.length === 1 ? '1 report' : `${entries.length} reports`} ↓</a>
          </div>
        </div>
      </header>

      {/* About: the fields that live in their own columns */}
      <section className="pp-group" aria-labelledby="pp-about-h">
        <div className="pp-group-h"><h2 id="pp-about-h">About</h2></div>
        <div className="pp-card">
          <div className="pp-row">
            <label className="pp-label" htmlFor="pp-dob">Date of birth</label>
            <div className="pp-field">
              <input
                id="pp-dob"
                type="date"
                className="pp-text pp-date"
                value={draft.date_of_birth}
                readOnly={readOnly}
                onChange={(e) => setField('date_of_birth', e.target.value)}
              />
            </div>
          </div>
          <div className="pp-row">
            <label className="pp-label" htmlFor="pp-nat">Nationality</label>
            <div className="pp-field">
              <AutoText id="pp-nat" label="Nationality" value={draft.nationality} multiline={false} readOnly={readOnly} onChange={(v) => setField('nationality', v)} />
            </div>
          </div>
          <div className="pp-row long">
            <span className="pp-label" id="pp-hand-l">Playing hand</span>
            <div className="pp-field">
              <div className="pp-seg" role="radiogroup" aria-labelledby="pp-hand-l">
                {HANDS.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={draft.playing_hand === v}
                    disabled={readOnly}
                    onClick={() => setField('playing_hand', v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="pp-row">
            <label className="pp-label" htmlFor="pp-photo">Photo link</label>
            <div className="pp-field">
              <AutoText id="pp-photo" label="Photo link" value={draft.photo_url} multiline={false} inputMode="url" placeholder="https://…" readOnly={readOnly} onChange={(v) => setField('photo_url', v)} />
            </div>
          </div>
        </div>
      </section>

      {section('body', 'Body', groups.body)}
      {section('game', 'Game', groups.game, undefined, undefined, ['UTR'])}
      {section('life', 'Training and lifestyle', groups.lifestyle, undefined, 'Only store what you need for coaching.', ['Diet', 'Exercise plan', 'Goals'])}

      <section className="pp-group" aria-labelledby="pp-notes-h">
        <div className="pp-group-h"><h2 id="pp-notes-h">Coach notes</h2></div>
        <div className="pp-card pp-pad">
          <AutoText
            id="pp-notes"
            label="Coach notes"
            value={draft.notes}
            multiline
            readOnly={readOnly}
            placeholder="Anything worth remembering about this player…"
            onChange={(v) => setField('notes', v)}
          />
        </div>
      </section>

      {section(
        'other',
        'Other',
        groups.other,
        !readOnly ? (
          <div className="pp-newrow">
            {newRowLabel === null ? (
              <button type="button" className="pp-add" onClick={() => setNewRowLabel('')}>
                <Plus size={16} aria-hidden="true" /> Add a row
              </button>
            ) : (
              <>
                <input
                  className="pp-text pp-boxed"
                  value={newRowLabel}
                  onChange={(e) => setNewRowLabel(e.target.value)}
                  placeholder="Row name (e.g. Serve speed)"
                  aria-label="New row name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRowLabel.trim()) { addRow(newRowLabel); setNewRowLabel(null); }
                    if (e.key === 'Escape') setNewRowLabel(null);
                  }}
                />
                <button type="button" className="pp-btn pp-btn-dark" disabled={!newRowLabel.trim()} onClick={() => { addRow(newRowLabel); setNewRowLabel(null); }}>Add</button>
                <button type="button" className="pp-btn" onClick={() => setNewRowLabel(null)}>Cancel</button>
              </>
            )}
          </div>
        ) : null,
      )}

      <ProfileReports playerId={playerId} folderId={player.google_folder_id} entries={entries} />

      {/* Danger zone: deliberately not plan-gated, last on the page. */}
      <DeletePlayerSection playerId={playerId} playerName={player.display_name} />

      {barVisible ? (
        <div className="pp-bar" data-testid="profile-save-bar">
          <div className="pp-bar-msg" role={status.kind === 'error' ? 'alert' : 'status'} aria-live={status.kind === 'error' ? 'assertive' : 'polite'}>
            {status.kind === 'saving' ? 'Saving…' : null}
            {status.kind === 'saved' && !dirty ? <span className="pp-ok"><Check size={16} aria-hidden="true" /> Saved</span> : null}
            {status.kind === 'error' ? <span className="pp-bad">{status.message.replace(/[.!?]?\s*$/, '.')} Your changes are still here.</span> : null}
            {dirty && status.kind !== 'error' && status.kind !== 'saving' ? 'You have unsaved changes' : null}
          </div>
          {dirty || status.kind === 'error' ? (
            <button type="button" className="pp-save" disabled={status.kind === 'saving' || !dirty} onClick={() => { void save(); }}>
              {status.kind === 'saving' ? 'Saving…' : status.kind === 'error' ? 'Try again' : 'Save profile'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const PROFILE_CSS = `
.pp-root { max-width: 880px; margin: 0 auto; padding-bottom: 32px; color: var(--cl-text-primary); font-family: var(--cl-font); overflow-wrap: anywhere; }
.pp-root *, .pp-root *::before, .pp-root *::after { box-sizing: border-box; }
.pp-root ::selection { background: var(--cl-accent-soft); }
.pp-root :focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 2px; border-radius: 8px; }

/* DESIGN.md Inline Error: warm tint, wraps, never an icon alone. */
.pp-err { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: #FFF7ED; border: 1px solid #FCA5A5; color: #9A3412; font-size: 13px; font-weight: 600; line-height: 1.45; }

.pp-head { display: flex; align-items: center; gap: 16px; padding: 20px 16px; margin: 0 0 24px; background: var(--cl-bg-panel); border: 1px solid var(--cl-border); border-radius: 16px; }
.pp-avatar { flex: none; width: 72px; height: 72px; border-radius: 999px; overflow: hidden; display: grid; place-items: center; background: var(--cl-fill-inactive); color: var(--cl-text-secondary); font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.pp-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pp-head-text { min-width: 0; flex: 1; }
.pp-name { margin: 0; font-size: clamp(24px, 4vw, 34px); line-height: 1.15; font-weight: 700; letter-spacing: -0.01em; text-wrap: balance; }
.pp-meta { margin: 6px 0 0; font-size: 15px; line-height: 1.4; color: var(--cl-text-secondary); }
.pp-sub { color: var(--cl-text-secondary); font-size: 13px; font-weight: 500; }
.pp-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 6px; }
.pp-chip { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px; background: var(--cl-fill-inactive); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pp-jump { display: inline-flex; align-items: center; min-height: 44px; color: var(--cl-accent); font-size: 14px; font-weight: 600; text-decoration: none; }

.pp-group { margin: 0 0 24px; }
.pp-group-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 4px 8px; }
.pp-group-h h2 { margin: 0; font-size: 16px; line-height: 1.3; font-weight: 700; }
.pp-hint { margin: -4px 4px 8px; font-size: 13px; line-height: 1.45; color: var(--cl-text-secondary); }
.pp-card { background: var(--cl-bg-panel); border: 1px solid var(--cl-border); border-radius: 16px; overflow: hidden; }
.pp-pad { padding: 6px 6px; }
.pp-empty { margin: 0; padding: 14px 16px; font-size: 14px; color: var(--cl-text-secondary); }

.pp-row { display: grid; grid-template-columns: minmax(92px, 36%) minmax(0, 1fr) 44px; align-items: start; column-gap: 8px; padding: 2px 4px 2px 16px; border-top: 1px solid var(--cl-border-subtle); }
.pp-row:first-child { border-top: 0; }
.pp-row.long { grid-template-columns: minmax(0, 1fr) 44px; }
.pp-row.long .pp-field { grid-column: 1 / -1; grid-row: 2; }
.pp-row.long .pp-label { padding-bottom: 0; }
.pp-label { padding: 13px 0 11px; font-size: 13px; font-weight: 600; line-height: 1.35; color: var(--cl-text-secondary); }
.pp-field { min-width: 0; grid-column: 2; }
.pp-fixed { grid-column: 2 / -1; padding: 11px 10px; font-size: 16px; line-height: 1.4; }
.pp-x { grid-column: 3; grid-row: 1; width: 44px; height: 44px; display: inline-grid; place-items: center; border: 0; background: transparent; color: var(--cl-text-secondary); border-radius: 10px; cursor: pointer; }
.pp-row.long .pp-x { grid-column: 2; }
.pp-x:hover { background: var(--cl-bg-secondary); color: var(--cl-destructive-text); }

/* Quiet fields: look like text until touched. 16px so iOS does not zoom the page on focus. */
.pp-text { display: block; width: 100%; min-height: 44px; margin: 0; padding: 10px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--cl-text-primary); font: inherit; font-size: 16px; line-height: 1.4; resize: none; overflow: hidden; }
.pp-text::placeholder { color: var(--cl-text-secondary); opacity: 1; }
.pp-text:hover:not([readonly]) { background: var(--cl-bg-secondary); }
.pp-text:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 0; background: var(--cl-bg-panel); }
.pp-text[readonly] { cursor: default; }
.pp-date { min-width: 0; }
.pp-boxed { border-color: var(--cl-border); background: var(--cl-bg-panel); flex: 1 1 200px; max-width: 320px; }

.pp-seg { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0; }
.pp-seg button { min-height: 44px; padding: 0 16px; border: 1px solid var(--cl-border); border-radius: 10px; background: var(--cl-bg-panel); color: var(--cl-text-primary); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.pp-seg button[aria-checked="true"], .pp-seg button[aria-pressed="true"] { background: var(--cl-accent); border-color: var(--cl-accent); color: var(--cl-text-on-fill); }
.pp-row.long .pp-seg { flex-wrap: nowrap; }
.pp-row.long .pp-seg button { flex: 1 1 0; padding: 0 8px; }
.pp-seg button:disabled { cursor: default; }
.pp-seg button[aria-checked="false"]:disabled { opacity: 0.5; }

.pp-sugg, .pp-newrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px 14px; border-top: 1px solid var(--cl-border-subtle); }
.pp-card > .pp-sugg:first-child, .pp-card > .pp-newrow:first-child { border-top: 0; }
.pp-add { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px dashed var(--cl-accent); border-radius: 10px; background: transparent; color: var(--cl-accent); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.pp-btn { min-height: 44px; padding: 0 16px; border: 1px solid var(--cl-border); border-radius: 10px; background: var(--cl-bg-panel); color: var(--cl-text-primary); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.pp-btn-dark { border: 0; background: var(--cl-action-primary); color: var(--cl-text-on-fill); font-weight: 700; }
.pp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pp-links { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.pp-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--cl-accent); font-size: 14px; font-weight: 600; text-decoration: none; }
.pp-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border-bottom: 1px solid var(--cl-border-subtle); }
.pp-tools .pp-seg { padding: 0; }
.pp-search { flex: 1 1 180px; min-width: 0; min-height: 44px; padding: 0 12px; border: 1px solid var(--cl-border); border-radius: 10px; background: var(--cl-bg-panel); color: var(--cl-text-primary); font: inherit; font-size: 16px; }
.pp-select { min-height: 44px; padding: 0 12px; border: 1px solid var(--cl-border); border-radius: 10px; background: var(--cl-bg-panel); color: var(--cl-text-primary); font: inherit; font-size: 14px; max-width: 100%; }
.pp-entry { padding: 14px 16px; border-top: 1px solid var(--cl-border-subtle); cursor: pointer; }
.pp-tools + .pp-entry { border-top: 0; }
.pp-entry:hover { background: var(--cl-bg-secondary); }
.pp-entry-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 13px; color: var(--cl-text-secondary); }
.pp-tag { padding: 3px 8px; border-radius: 8px; background: var(--cl-fill-inactive); color: var(--cl-text-primary); font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
.pp-entry-title { margin-top: 6px; font-size: 16px; line-height: 1.35; font-weight: 600; }
.pp-entry-yt { display: inline-flex; }
.pp-entry-body { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: var(--cl-text-primary); white-space: pre-wrap; }

.pp-stat-sum { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 10px 10px 6px; font-size: 14px; font-variant-numeric: tabular-nums; }
.pp-stat-rows { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px 10px; }
.pp-stat-row { display: grid; grid-template-columns: minmax(84px, 140px) minmax(0, 1fr) 64px; align-items: center; gap: 10px; }
.pp-stat-date { font-size: 12px; color: var(--cl-text-secondary); font-variant-numeric: tabular-nums; }
.pp-stat-track { height: 14px; border-radius: 8px; background: var(--cl-bg-secondary); overflow: hidden; }
.pp-stat-bar { height: 100%; border-radius: 8px; background: var(--cl-action-primary); }
.pp-stat-val { font-size: 13px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }

/* The one save bar: floats above the work, so it may carry the Panel Float shadow. */
.pp-bar { position: sticky; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); z-index: 5; display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 16px; padding: 10px 12px 10px 16px; background: var(--cl-bg-panel); border: 1px solid var(--cl-border); border-radius: 16px; box-shadow: 0 16px 44px rgba(0,0,0,0.12); }
.pp-bar-msg { flex: 1 1 180px; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.4; }
.pp-ok { display: inline-flex; align-items: center; gap: 6px; color: var(--cl-success-text); }
.pp-bad { color: var(--cl-destructive-text); }
.pp-save { min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; background: var(--cl-action-primary); color: var(--cl-text-on-fill); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.pp-save:disabled { opacity: 0.5; cursor: wait; }

@media (max-width: 420px) {
  .pp-head { padding: 16px 14px; gap: 14px; }
  .pp-avatar { width: 64px; height: 64px; font-size: 23px; }
  .pp-row { grid-template-columns: minmax(84px, 34%) minmax(0, 1fr) 44px; padding-left: 14px; }
}
@media (max-height: 460px) and (orientation: landscape) {
  .pp-bar { bottom: calc(6px + env(safe-area-inset-bottom, 0px)); padding-top: 6px; padding-bottom: 6px; }
}
@media (prefers-reduced-motion: no-preference) {
  .pp-text, .pp-entry, .pp-x { transition: background-color 0.12s ease; }
}
`;
