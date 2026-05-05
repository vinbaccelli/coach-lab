import WorkspaceChrome from '@/components/WorkspaceChrome';

export default function PlayersPage() {
  return (
    <WorkspaceChrome pageLabel="Player database">
      <div style={{ padding: '20px 16px 40px', maxWidth: 900, margin: '0 auto' }}>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, opacity: 0.82 }}>
          Each player gets a profile with three linked documents. Data persistence and Google Drive-style linking will plug in when your backend tables are ready.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section
            style={{
              padding: 18,
              borderRadius: 14,
              background: 'rgba(15, 15, 18, 0.65)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Technical sheet</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
              Strengths, weaknesses, improvement focus, strategy blueprint, and a per-stroke breakdown with technique cues and targets.
            </p>
          </section>

          <section
            style={{
              padding: 18,
              borderRadius: 14,
              background: 'rgba(15, 15, 18, 0.65)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Match analysis</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
              Chronological match log with stats, strategy and mental notes, and embedded match video (YouTube, SwingVision, or other).
            </p>
          </section>

          <section
            style={{
              padding: 18,
              borderRadius: 14,
              background: 'rgba(15, 15, 18, 0.65)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Technical analysis</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
              Session timeline with screenshots, short clips, angle references, and comments. Clips from the video lab can arrive as unlisted YouTube links with timestamps.
            </p>
          </section>
        </div>

        <p style={{ marginTop: 22, fontSize: 12, opacity: 0.5 }}>
          Next step for development: player list, create/edit profile, and Supabase tables — no action needed from you until we hook up storage.
        </p>
      </div>
    </WorkspaceChrome>
  );
}
