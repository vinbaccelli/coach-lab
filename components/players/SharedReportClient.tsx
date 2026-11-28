'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { findReportForEntry, groupEntriesIntoReports, type EntryLike } from '@/lib/reports/deriveBlocks';
import ReportBlocks from '@/components/reports/ReportBlocks';
import { reportTitle } from '@/components/reports/ReportsIndexClient';
import { backLink, chipStyle, FOCUS_CSS, formatDateKey, KIND_CHIP, mutedText, wrap } from '@/components/reports/reportStyles';

/** A match report through the player's share link: read-only (no editing, no PDF, no coach navigation). */
export default function SharedReportClient({ token, entryId }: { token: string; entryId: string }) {
  const [entry, setEntry] = useState<EntryLike | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'email' | 'gone'>('loading');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/share/${token}/reports/${entryId}`, { cache: 'no-store', headers: email.trim() ? { 'x-share-email': email.trim() } : {} });
      const body = (await res.json().catch(() => ({}))) as { entry?: EntryLike; needsEmail?: boolean; error?: string };
      if (res.status === 401 && body.needsEmail) { setState('email'); setErr(email ? 'That email does not match.' : null); return; }
      if (!res.ok || !body.entry) { setState('gone'); return; }
      setEntry(body.entry);
      setState('ok');
    } catch {
      setErr('Could not load the report. Check your connection and try again.');
      setState('gone');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, entryId]);

  useEffect(() => { void load(); }, [load]);

  const report = useMemo(() => (entry ? findReportForEntry(groupEntriesIntoReports([entry]), entryId) : null), [entry, entryId]);
  const back = (
    <nav aria-label="Report navigation" style={{ marginBottom: 16 }}>
      <Link href={`/share/${token}`} style={backLink}><ArrowLeft size={16} aria-hidden /> Back to the profile</Link>
    </nav>
  );

  if (state === 'loading') return <div className="rpt" style={wrap}><style>{FOCUS_CSS}</style><p role="status" style={{ ...mutedText, padding: '24px 0' }}>Loading report…</p></div>;
  if (state === 'email') {
    return (
      <div className="rpt" style={wrap}>
        <style>{FOCUS_CSS}</style>
        <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Enter your email</h1>
        <p style={mutedText}>Your coach asked for the email this link was shared with.</p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: '100%', minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--cl-border)', fontSize: 16 }}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        {err ? <p role="alert" style={{ color: 'var(--cl-destructive-text)', fontSize: 13 }}>{err}</p> : null}
        <button type="button" onClick={() => void load()} style={{ marginTop: 10, minHeight: 44, padding: '0 16px', borderRadius: 10 }}>Continue</button>
      </div>
    );
  }
  if (state === 'gone' || !report) {
    return (
      <div className="rpt" style={wrap}>
        <style>{FOCUS_CSS}</style>
        {back}
        <p style={{ margin: '24px 0 6px', fontSize: 16, fontWeight: 700 }}>{err ?? 'This report is not available'}</p>
        <p style={mutedText}>Your coach may have removed it or not shared it with this link.</p>
      </div>
    );
  }
  return (
    <article className="rpt" style={wrap}>
      <style>{FOCUS_CSS}</style>
      {back}
      <header style={{ margin: '4px 0 28px' }}>
        <span style={chipStyle(report.kind)}>{KIND_CHIP[report.kind].label}</span>
        <h1 style={{ margin: '10px 0 6px', fontSize: 'clamp(24px, 6vw, 34px)', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.01em' }}>{reportTitle(report)}</h1>
        <p style={{ ...mutedText, margin: 0 }}>
          {formatDateKey(report.dateKey, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {report.opponent ? ` · vs ${report.opponent}` : ''}
        </p>
      </header>
      <ReportBlocks blocks={report.blocks} fallbackText={report.fallbackText} />
    </article>
  );
}
