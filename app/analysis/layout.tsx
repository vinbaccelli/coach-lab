import type { Metadata } from 'next';
import TrialBanner from '@/components/TrialBanner';

export const metadata: Metadata = {
  title: 'Video analysis – AngleMotion',
  description:
    'Annotate video with drawing tools, skeleton overlay, split-screen, zoom, slow motion, and recording.',
};

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        // 100dvh tracks the visible viewport on iOS Safari (the dynamic
        // toolbar otherwise makes 100vh taller than the screen). Matches the
        // analysis page root, which also uses 100dvh.
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#000',
      }}
    >
      <TrialBanner />
      {children}
    </div>
  );
}
