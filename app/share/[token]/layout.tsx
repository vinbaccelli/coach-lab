import type { Metadata } from 'next';

// A share link must not be indexed or leak its token through the Referer header.
export const metadata: Metadata = {
  title: 'Player profile — AngleMotion',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
