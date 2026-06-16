'use client';

import { useCallback, useEffect, useState } from 'react';
import PlayerPickerForm, { SaveModalShell } from '@/components/sessions/PlayerPickerForm';
import { saveSessionDraft } from '@/lib/sessions/saveSession';
import type { SessionDraft, VideoReference, VideoRefKind } from '@/lib/sessions/types';
import { sessionDraftHasContent } from '@/lib/sessions/types';

type Props = {
  open: boolean;
  onClose: () => void;
  draft: SessionDraft;
  defaultTitle?: string;
  /** When analysis was opened from a player profile, skip player picker. */
  fixedPlayerId?: string;
  fixedPlayerName?: string;
  /** Update an existing draft session row on save. */
  existingSessionId?: string;
  onSaved?: (sessionId: string, playerId: string) => void;
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #D1D1D6',
  fontSize: 14,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginTop: 14,
  color: '#1A1A1A',
};

export default function SaveSessionModal({
  open,
  onClose,
  draft,
  defaultTitle,
  fixedPlayerId,
  fixedPlayerName,
  existingSessionId,
  onSaved,
}: Props) {
  const [playerId, setPlayerId] = useState(fixedPlayerId ?? '');
  const [title, setTitle] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [videoKind, setVideoKind] = useState<VideoRefKind>('none');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoLabel, setVideoLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlayerId(fixedPlayerId ?? '');
    setTitle(defaultTitle ?? draft.title ?? '');
    setCoachNotes(draft.coachNotes ?? '');
    setVideoKind(draft.videoRef.kind ?? 'none');
    setVideoUrl(draft.videoRef.url ?? '');
    setVideoLabel(draft.videoRef.label ?? '');
    setErr(null);
  }, [open, defaultTitle, draft, fixedPlayerId]);

  const buildVideoRef = useCallback((): VideoReference => {
    if (videoKind === 'none') return { kind: 'none' };
    return {
      kind: videoKind,
      url: videoUrl.trim() || undefined,
      label: videoLabel.trim() || undefined,
    };
  }, [videoKind, videoUrl, videoLabel]);

  const handleSave = useCallback(async () => {
    if (!playerId) {
      setErr('Select or create a player first.');
      return;
    }
    const mergedDraft: SessionDraft = {
      ...draft,
      title: title.trim() || defaultTitle || 'Analysis session',
      coachNotes,
      videoRef: buildVideoRef(),
    };
    if (!sessionDraftHasContent(mergedDraft) && !title.trim()) {
      setErr('Nothing to save — run StroMotion or AI Metrics first, or add notes.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const session = await saveSessionDraft(playerId, mergedDraft, {
        sessionId: existingSessionId,
      });
      onSaved?.(session.id, playerId);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }, [playerId, draft, title, coachNotes, buildVideoRef, defaultTitle, existingSessionId, onSaved, onClose]);

  return (
    <SaveModalShell
      open={open}
      onClose={onClose}
      title="Save Report"
      subtitle={
        fixedPlayerName
          ? `Saving to ${fixedPlayerName}'s coaching history.`
          : "Attach this analysis to a player's history. Video can be linked (YouTube or cloud) for future reports."
      }
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSave()}
            style={{
              flex: 1,
              minWidth: 140,
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background: '#007AFF',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Saving…' : 'Save to player'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid #D1D1D6',
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      }
    >
      {fixedPlayerId && fixedPlayerName ? (
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>
          Player: {fixedPlayerName}
        </p>
      ) : (
        <PlayerPickerForm playerId={playerId} onPlayerIdChange={setPlayerId} disabled={busy} />
      )}

      <label style={labelStyle}>
        Session title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Forehand — analysis"
          disabled={busy}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Coach notes
        <textarea
          value={coachNotes}
          onChange={(e) => setCoachNotes(e.target.value)}
          rows={4}
          disabled={busy}
          placeholder="Observations, cues, homework…"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>

      <label style={labelStyle}>
        Source video
        <select
          value={videoKind}
          onChange={(e) => setVideoKind(e.target.value as VideoRefKind)}
          disabled={busy}
          style={inputStyle}
        >
          <option value="none">No video link</option>
          <option value="youtube">YouTube link</option>
          <option value="cloud_url">Cloud / Drive link</option>
        </select>
      </label>

      {videoKind !== 'none' ? (
        <>
          <label style={labelStyle}>
            Video URL
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={videoKind === 'youtube' ? 'https://youtube.com/…' : 'https://…'}
              disabled={busy}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Link label (optional)
            <input
              value={videoLabel}
              onChange={(e) => setVideoLabel(e.target.value)}
              placeholder="e.g. Google Drive, Academy portal"
              disabled={busy}
              style={inputStyle}
            />
          </label>
        </>
      ) : null}

      {err ? <p style={{ margin: '12px 0 0', fontSize: 13, color: '#c0392b' }}>{err}</p> : null}
    </SaveModalShell>
  );
}
