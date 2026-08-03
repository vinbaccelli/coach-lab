'use client';

import { Loader2, Youtube } from 'lucide-react';
import type { YouTubeConnection } from '@/hooks/useYouTubeConnection';

/**
 * The "upload this video to YouTube" control for the export panels.
 *
 * ONE component for StroMotion and Metrics because the two panels had drifted
 * into near-identical copies of this block already, and this one has a state
 * machine (loading → not connected → connecting → connected) that is not worth
 * maintaining twice.
 *
 * When the coach has not authorized YouTube it shows a CONNECT BUTTON rather
 * than a checkbox. A checkbox implies "tick me and it happens"; ticking one that
 * silently no-ops (or fails at export time, after the render) is the worse
 * outcome — the coach only finds out once the work is done.
 */
export function YouTubeUploadOption({
  youtube,
  checked,
  onCheckedChange,
  videoReady,
  /** Copy for when there is no video yet — differs slightly per panel. */
  noVideoHint = 'Build the video preview first to include it.',
  dark = true,
}: {
  youtube: YouTubeConnection;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  videoReady: boolean;
  noVideoHint?: string;
  dark?: boolean;
}) {
  const muted = dark ? 'rgba(255,255,255,0.7)' : '#6E6E73';
  const faint = dark ? 'rgba(255,255,255,0.45)' : '#8E8E93';

  const connectBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    border: dark ? '1px solid rgba(255,255,255,0.22)' : '1px solid #E5E5E5',
    background: dark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
    color: dark ? '#fff' : '#1A1A1A',
    fontSize: 11,
    fontWeight: 600,
    cursor: youtube.connecting ? 'wait' : 'pointer',
  };

  if (youtube.loading) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: faint }}>
        <Loader2 size={12} className="animate-spin" /> Checking YouTube…
      </span>
    );
  }

  if (!youtube.connected) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={connectBtn}
          disabled={youtube.connecting}
          onClick={() => { void youtube.connect(); }}
          title="Authorize AngleMotion to upload to your YouTube channel. Opens a Google window; your work here is not affected."
        >
          {youtube.connecting
            ? <><Loader2 size={12} className="animate-spin" /> Connecting…</>
            : <><Youtube size={13} /> Connect YouTube</>}
        </button>
        <span style={{ fontSize: 10, color: faint }}>
          {youtube.error ?? 'Optional — connect once to upload videos as Unlisted.'}
        </span>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: muted }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={!videoReady}
        />
        <Youtube size={13} /> Upload video to YouTube (Unlisted)
      </label>
      {youtube.channelTitle && (
        <span style={{ fontSize: 10, color: faint }}>as {youtube.channelTitle}</span>
      )}
      {!videoReady && <span style={{ fontSize: 10, color: faint }}>{noVideoHint}</span>}
      <button
        type="button"
        onClick={() => { void youtube.disconnect(); }}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 10,
          color: faint,
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
        title="Revoke AngleMotion's access to your YouTube channel"
      >
        Disconnect
      </button>
    </span>
  );
}
