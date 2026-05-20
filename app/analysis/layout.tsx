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
      {children}
    </div>
  );
}
