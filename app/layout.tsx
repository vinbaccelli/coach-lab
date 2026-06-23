import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import InstallPrompt from '../components/InstallPrompt';
import { RecordingProvider } from '../contexts/RecordingContext';
import PersistentWebcamOverlay from '../components/PersistentWebcamOverlay';
import FloatingRecordingIndicator from '../components/FloatingRecordingIndicator';

export const metadata: Metadata = {
  title: 'CoachLab – Coaching intelligence platform',
  description:
    'Control panel for tennis and sports coaching: video analysis, player database, match reports, and AI-assisted match intelligence — with YouTube-backed video and Google sign-in.',
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
        <RecordingProvider>
          {children}
          <PersistentWebcamOverlay />
          <FloatingRecordingIndicator />
        </RecordingProvider>
        <InstallPrompt />
      </body>
    </html>
  );
}