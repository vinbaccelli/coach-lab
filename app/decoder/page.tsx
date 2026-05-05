import Link from 'next/link';
import WorkspaceChrome from '@/components/WorkspaceChrome';

export default function DecoderPage() {
  return (
    <WorkspaceChrome pageLabel="AI match data decoder">
      <div style={{ padding: '20px 16px 40px', maxWidth: 800, margin: '0 auto' }}>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, opacity: 0.85 }}>
          The decoder will accept raw match data from multiple sources, run structure and pattern analysis, and write results into the player&apos;s <strong>Match analysis</strong> document.
          You will add your own Gemini API key in settings when that integration is enabled; for now this screen explains the flow.
        </p>

        <ol style={{ margin: '0 0 22px', paddingLeft: 20, fontSize: 14, lineHeight: 1.6, opacity: 0.82 }}>
          <li style={{ marginBottom: 8 }}>SwingVision or similar exports (JSON/CSV where supported)</li>
          <li style={{ marginBottom: 8 }}>Screenshots or text pasted into Gemini (via your Google account)</li>
          <li style={{ marginBottom: 8 }}>
            A completed{' '}
            <Link href="/match-report" style={{ color: '#7dd3fc' }}>
              manual match report
            </Link>{' '}
            from this app
          </li>
        </ol>

        <div
          style={{
            padding: 20,
            borderRadius: 14,
            background: 'rgba(15, 15, 18, 0.7)',
            border: '1px solid rgba(255,255,255,0.12)',
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 800 }}>Planned output</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.78 }}>
            Statistics, rally ratios, performance indexes, and tactical / physical / mental / comparative views. You&apos;ll review before anything is saved to a player profile.
          </p>
        </div>

        <p style={{ fontSize: 12, opacity: 0.5, margin: 0 }}>
          Development: file upload, Gemini calls, and Supabase writes require API keys and schema — we&apos;ll wire those when you&apos;re ready to test.
        </p>
      </div>
    </WorkspaceChrome>
  );
}
