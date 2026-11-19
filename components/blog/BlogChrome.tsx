import Link from 'next/link';
import { TRIAL_PATH } from '@/lib/seo/site';

/** Public header and footer for the blog. Mirrors the landing page's brand marks; no app chrome. */
export function BlogHeader() {
  return (
    <header className="blog-header">
      <nav className="blog-nav" aria-label="Main">
        <Link href="/" className="blog-wordmark" aria-label="AngleMotion home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-square-new.jpg" alt="" width={26} height={26} />
          <span>Angle<span className="blog-accent">Motion</span></span>
        </Link>
        <div className="blog-nav-links">
          <Link href="/blog">Academy</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/coaches">Coaches</Link>
          <Link href="/login">Sign in</Link>
          <Link href={TRIAL_PATH} className="blog-btn blog-btn-sm">Try free</Link>
        </div>
      </nav>
    </header>
  );
}

export function BlogFooter() {
  return (
    <footer className="blog-footer">
      <nav className="blog-footer-links" aria-label="Footer">
        <Link href="/">Home</Link>
        <Link href="/blog">Academy</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/coaches">Coaches</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <p>© {new Date().getFullYear()} AngleMotion</p>
    </footer>
  );
}

export function TrialCta({ heading = 'Try it on your own clip' }: { heading?: string }) {
  return (
    <aside className="blog-cta" aria-label="Free trial">
      <h2>{heading}</h2>
      <p>Sign in with Google and use every tool free for one hour. No card, no booking.</p>
      <Link href={TRIAL_PATH} className="blog-btn">Test it free for an hour</Link>
    </aside>
  );
}
