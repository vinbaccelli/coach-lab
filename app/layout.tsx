import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import InstallPrompt from '../components/InstallPrompt';

export const metadata: Metadata = {
  title: 'Coach Lab – Video Analysis Tool',
  description: 'Professional coaching video analysis with frame-by-frame playback, drawing tools, and screen recording.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Coach Lab',
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.svg' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#007AFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}