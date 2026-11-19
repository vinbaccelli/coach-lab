import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import InstallPrompt from '../components/InstallPrompt';
import { RecordingProvider } from '../contexts/RecordingContext';
import PersistentWebcamOverlay from '../components/PersistentWebcamOverlay';
import FloatingRecordingIndicator from '../components/FloatingRecordingIndicator';
import ReportProblemButton from '../components/ReportProblemButton';
import ReviewPrompt from '../components/ReviewPrompt';
import { DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_SIZE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '../lib/seo/site';

// Site-wide defaults. Pages override title and description; `canonical: './'`
// makes every page point at its own URL on the canonical host (lib/seo/site.ts).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'AngleMotion – Video analysis for tennis coaches',
  description: SITE_DESCRIPTION,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'AngleMotion – Video analysis for tennis coaches',
    description: SITE_DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE, ...DEFAULT_OG_IMAGE_SIZE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AngleMotion – Video analysis for tennis coaches',
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AngleMotion',
  },
  // Official brand logo everywhere — tab icon included (PNGs generated from
  // /logo-square-new.jpg; the old stick-figure SVGs are retired).
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#007AFF',
};

/**
 * Impeccable direction contract for the landing surface (`/` and `/login`).
 *
 * Emitted as a real HTML comment, first child of <body>, so it survives the
 * production build and can be audited in the built output (grep the seed key).
 * A JSX comment would be stripped at compile time and audit nothing.
 *
 * `dangerouslySetInnerHTML` is safe here and only here: the value is this
 * module-level string constant with no interpolation and no user input. It is
 * not a licence to render untrusted HTML anywhere else in the app.
 */
const DIRECTION_CONTRACT = `<!--
  Impeccable direction contract - landing surface (/ and /login)
  THESIS: one player's timeline read forward in time, each entry opening to the
    tool that made it. Refuses the four-viewport upload/analyse/export pipeline.
  OWN-WORLD: white ground, #1D1D1F ink, a single #007AFF accent; a 1px ruled
    spine with a travelling accent band and tabular date stamps; display type at
    poster scale; the founder's real product screenshots, never stock feature
    cards or illustrations.
  STORY: a coach believes footage they already have becomes a permanent,
    shareable record of a player's development, and starts the free trial hour.
  FIRST VIEWPORT: poster-scale headline set against the spine's origin, one
    sentence of promise, the primary action visible, the first dated entry
    already breaking the fold.
  FORM: Timeline Spine (rank 1) fused with Report Unfolded (rank 3);
    seed key anglemotion-landing-1.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the
    finish review, the verdict, DESIGN.md, and every shipping raster carrying
    its provenance.
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <ServiceWorkerRegistration />
        <RecordingProvider>
          {children}
          <PersistentWebcamOverlay />
          <FloatingRecordingIndicator />
        </RecordingProvider>
        <InstallPrompt />
        <ReportProblemButton />
        <ReviewPrompt />
      </body>
    </html>
  );
}