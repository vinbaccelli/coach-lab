import type { Metadata, Viewport } from 'next';
import TrialBanner from '@/components/TrialBanner';
import PaymentFailedBanner from '@/components/PaymentFailedBanner';

export const metadata: Metadata = {
  title: 'Video analysis – AngleMotion',
  description:
    'Annotate video with drawing tools, skeleton overlay, split-screen, zoom, slow motion, and recording.',
};

/**
 * /analysis only: the page itself must not zoom. Two-finger gestures on the
 * video are the app's own canvas zoom (with its ⌂ reset); a browser zoom of the
 * whole page had no way back and left the coach on a zoomed, unusable screen
 * (iPhone, Chrome for iOS). Other pages keep the root viewport (pinch allowed).
 * iOS Safari may still allow a pinch for accessibility; the canvas blocks the
 * gesture itself (components/Canvas.tsx).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#007AFF',
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
        // No double-tap zoom on any control (the canvas sets its own 'none').
        touchAction: 'manipulation',
      }}
    >
      <TrialBanner />
      <PaymentFailedBanner />
      {children}
    </div>
  );
}
