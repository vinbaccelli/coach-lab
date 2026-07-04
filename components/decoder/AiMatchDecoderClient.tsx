'use client';

import { useCallback, useMemo, useState } from 'react';
import SaveReportModal from '@/components/shared/SaveReportModal';
import { localDateTimeForFolder } from '@/lib/players/formatFolderLabel';
import { ENABLE_GOOGLE_EXPORTS } from '@/lib/featureFlags';

const MAX_IMAGES = 16;

export default function AiMatchDecoderClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [opponentHint, setOpponentHint] = useState('');
  const [focusPlayerHint, setFocusPlayerHint] = useState('');

  const folderLabelDefault = useMemo(() => {
    const dt = localDateTimeForFolder();
    return `${dt} — Swing Vision decode`;
  }, []);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => {
      const next = [...prev];
      for (let i = 0; i < list.length && next.length < MAX_IMAGES; i++) {
        next.push(list[i]);
      }
      return next.slice(0, MAX_IMAGES);
    });
    setErr(null);
  }, []);

  const runDecode = useCallback(async () => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('images', f));
      const res = await fetch('/api/gemini/decode-match', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Decode failed');
      setReport(data.report ?? '');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Decode failed');
    } finally {
      setBusy(false);
    }
  }, [files]);

  const surface = {
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid #E5E5E5',
    borderRadius: 16,
    padding: 18,
    color: '#1A1A1A',
  } as const;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.82)' }}>
        Upload up to 16 Swing Vision screenshots. The app batches Gemini calls automatically (10 + remainder) and shows one merged report.
      </p>

      <div style={{ ...surface, marginBottom: 14 }}>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 160,
            border: '2px dashed #d6d3d1',
            borderRadius: 14,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            color: '#57534e',
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          Tap to add images ({files.length}/{MAX_IMAGES})
        </label>
        {files.length > 0 ? (
          <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, color: '#44403c' }}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} style={{ marginBottom: 6 }}>
                {f.name}{' '}
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{ border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          disabled={busy || !files.length}
          onClick={runDecode}
          style={{
            marginTop: 16,
            width: '100%',
            minHeight: 48,
            borderRadius: 12,
            border: 'none',
            background: '#1A1A1A',
            color: '#fff',
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.75 : 1,
          }}
        >
          {busy ? 'Analyzing…' : 'Generate match report'}
        </button>
        {err ? <p style={{ color: '#b91c1c', marginTop: 12, fontSize: 13 }}>{err}</p> : null}
      </div>

      {report ? (
        <>
          <div style={{ ...surface, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Optional — link to your players</div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Primary player name (for saving)
            </label>
            <input
              value={focusPlayerHint}
              onChange={(e) => setFocusPlayerHint(e.target.value)}
              style={inp}
              placeholder="e.g. name from the report"
            />
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, marginTop: 12 }}>
              Opponent name (for cross-folder save)
            </label>
            <input
              value={opponentHint}
              onChange={(e) => setOpponentHint(e.target.value)}
              style={inp}
              placeholder="As shown in Swing Vision"
            />
          </div>

          <div style={{ ...surface, maxHeight: 'min(55vh, 520px)', overflow: 'auto', marginBottom: 14 }}>
            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{report}</div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              style={{
                flex: '1 1 200px',
                minHeight: 48,
                borderRadius: 12,
                border: 'none',
                background: '#1A1A1A',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save to player folder
            </button>
            {ENABLE_GOOGLE_EXPORTS && (
            <button
              type="button"
              disabled={exportBusy}
              onClick={async () => {
                setExportBusy(true);
                try {
                  const res = await fetch('/api/google/create-document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      title: `Match report — ${localDateTimeForFolder()}`,
                      body: report,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? 'Export failed');
                  if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
                } catch {
                  alert('Could not create Google Doc — sign in with Docs/Drive scopes.');
                } finally {
                  setExportBusy(false);
                }
              }}
              style={{
                flex: '1 1 200px',
                minHeight: 48,
                borderRadius: 12,
                border: '1px solid #E5E5E5',
                background: '#fff',
                fontWeight: 600,
                cursor: exportBusy ? 'wait' : 'pointer',
              }}
            >
              {exportBusy ? 'Creating…' : 'Export to Google Doc'}
            </button>
            )}
          </div>

          <SaveReportModal
            open={saveOpen}
            onClose={() => setSaveOpen(false)}
            folderLabel={folderLabelDefault}
            bodyText={report}
            primaryPlayerName={focusPlayerHint.trim()}
            opponentNameHint={opponentHint.trim()}
            source="ai_decoder"
          />
        </>
      ) : null}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid #E5E5E5',
  padding: '10px 12px',
  fontSize: 14,
  boxSizing: 'border-box',
};
