import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Coach Lab – Video Analysis Tool',
  description: 'Professional coaching video analysis with frame-by-frame playback, drawing tools, and screen recording.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}