import type { Metadata } from 'next';

// A share link must not be indexed or leak its token through the Referer header.
export const metadata: Metadata = {
  title: 'Player profile — AngleMotion',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  // The app's body is overflow:hidden (the analysis screen is a fixed canvas), so this public page
  // must be its own scroll container or it cannot be scrolled on a phone.
  return <div style={{ height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>;
}
