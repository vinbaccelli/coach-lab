import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Video analysis – CoachLab',
  description:
    'Annotate video with drawing tools, skeleton overlay, split-screen, zoom, slow motion, and recording.',
};

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#000',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(11,11,12,0.96)',
          zIndex: 95,
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#7dd3fc',
            textDecoration: 'none',
          }}
        >
          ← Control Panel
        </Link>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
          Video Analysis
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
