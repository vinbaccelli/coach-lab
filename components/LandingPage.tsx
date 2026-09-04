'use client';

/**
 * Public marketing landing page shown to logged-out visitors.
 *
 * Direction: "The Timeline Spine" — the page is one player's development read
 * forward in time, and each dated entry opens to the capability that produced
 * it. See .impeccable/surfaces/components-landingpage-tsx.md (seed key
 * anglemotion-landing-1) and the contract emitted in app/layout.tsx.
 *
 * Content rules this file is held to:
 *  - The reviews in FOUNDER_REVIEWS are real, supplied by the founder, and are
 *    reviews of VIN'S COACHING, not of this app — the app is new and has none.
 *    The page says so in as many words. Nothing here may be added without that
 *    same provenance. No club logos, user counts, benchmarks or press exist for
 *    this product; none are invented or implied.
 *  - TWO Trustpilot profiles, never to be conflated. The founder's coaching
 *    profile (vinbaccelli.com, "Anglemotion by Coach Vinbaccelli") carries the
 *    reviews, all of them 5 stars; the app's own profile (anglemotion.com) has
 *    none. The star record is stated ONLY next to the coaching link, and
 *    labelled as being for Vin's coaching rather than the app. The app's
 *    profile gets a plain invitation with no rating until it earns one.
 *  - The competitor table carries ONLY verified data; unknowns stay '?'.
 *  - The example player's dates and readings are illustrative and are labelled
 *    as such on the page, not passed off as a real customer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, X, Minus, ChevronDown, ArrowRight, ArrowUpRight } from 'lucide-react';
import { PLANS, DEMO, planPrice, yearlyPerMonth } from '@/lib/plans';

/* ────────────────────────────────────────────────────────────────────────────
   Authored linework diagrams.

   These are geometry, not pictures and not screenshots: each one states what
   the entry does in the product's own visual language — thin charcoal rules,
   a single blue accent for the measured thing. Real product screenshots land
   in the tutorial section in a later pass.
   ──────────────────────────────────────────────────────────────────────────── */

const INK = 'var(--cl-text-primary)';
const MUTED = 'var(--cl-text-secondary)';
const ACCENT = 'var(--cl-accent)';
const LINE = 'var(--cl-border)';

type DiagramProps = { className?: string };

const svgBase: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 240 180',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  role: 'img',
  focusable: 'false',
};

/** Joint angles read off the frame. */
function AngleDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="A joint angle measured between two limb segments">
      <path d="M60 150 L108 84 L188 96" stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M108 84 m -34 26 a 42 42 0 0 0 42 20" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <circle cx="108" cy="84" r="5" fill={ACCENT} />
      <circle cx="60" cy="150" r="4" fill="var(--cl-bg-panel)" stroke={INK} strokeWidth="2" />
      <circle cx="188" cy="96" r="4" fill="var(--cl-bg-panel)" stroke={INK} strokeWidth="2" />
      <line x1="24" y1="30" x2="216" y2="30" stroke={LINE} strokeWidth="1" strokeDasharray="3 5" />
      <text x="24" y="22" fill={MUTED} fontSize="11" fontFamily="var(--cl-font)" letterSpacing="0.08em">ELBOW</text>
    </svg>
  );
}

/** AI proposes the skeleton; the coach moves any point. */
function SkeletonDiagram({ className }: DiagramProps) {
  const edges = [
    [120, 34, 120, 92], [120, 92, 84, 140], [120, 92, 156, 140],
    [120, 52, 78, 78], [120, 52, 176, 66],
  ];
  return (
    <svg {...svgBase} className={className} aria-label="A detected skeleton with one keypoint being corrected by hand">
      {edges.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="2" strokeLinecap="round" />
      ))}
      {[[120, 34], [120, 52], [120, 92], [78, 78], [84, 140], [156, 140]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="4.5" fill="var(--cl-bg-panel)" stroke={INK} strokeWidth="2" />
      ))}
      {/* the point under the coach's hand */}
      <line x1="176" y1="66" x2="196" y2="44" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="3 4" />
      <circle cx="176" cy="66" r="6" fill={ACCENT} />
      <circle cx="196" cy="44" r="10" fill="none" stroke={ACCENT} strokeWidth="1.5" />
    </svg>
  );
}

/** The whole stroke, frozen across space. */
function MotionLayerDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="A stroke composited as several overlapping positions">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(${i * 38} 0)`} opacity={0.18 + i * 0.205}>
          <path
            d="M46 148 L58 104 L46 66"
            stroke={i === 4 ? ACCENT : INK}
            strokeWidth={i === 4 ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="58" cy="58" r="7" stroke={i === 4 ? ACCENT : INK} strokeWidth={i === 4 ? 2.5 : 2} />
        </g>
      ))}
    </svg>
  );
}

/** Phases replayed frame by frame. */
function PhaseDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="A stroke split into phases and replayed frame by frame">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={20 + i * 52} y={52} width={44} height={62} rx={6}
          stroke={i === 1 ? ACCENT : LINE}
          strokeWidth={i === 1 ? 2 : 1.5}
          fill="none"
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M${34 + i * 52} 100 L${42 + i * 52} ${80 - i * 4} L${50 + i * 52} 92`}
          stroke={i === 1 ? ACCENT : INK}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={i === 1 ? 1 : 0.45}
        />
      ))}
      <line x1="20" y1="132" x2="220" y2="132" stroke={LINE} strokeWidth="1" />
      <circle cx="94" cy="132" r="4" fill={ACCENT} />
    </svg>
  );
}

/** Match data logged point by point. */
function MatchDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="Match statistics charted beside a court diagram">
      <rect x="20" y="40" width="76" height="104" rx="3" stroke={INK} strokeWidth="2" fill="none" />
      <line x1="20" y1="92" x2="96" y2="92" stroke={INK} strokeWidth="2" />
      <line x1="58" y1="40" x2="58" y2="144" stroke={LINE} strokeWidth="1.5" />
      <circle cx="76" cy="66" r="4" fill={ACCENT} />
      {[46, 30, 62, 22].map((h, i) => (
        <rect
          key={i}
          x={124 + i * 26} y={144 - h} width={16} height={h} rx={3}
          fill={i === 2 ? ACCENT : 'var(--cl-fill-inactive)'}
        />
      ))}
      <line x1="124" y1="144" x2="220" y2="144" stroke={LINE} strokeWidth="1" />
    </svg>
  );
}

/** Two documents per player, growing all season. */
function DocsDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="Two documents per player: technical and match analysis">
      <rect x="30" y="34" width="94" height="118" rx="8" stroke={LINE} strokeWidth="1.5" fill="var(--cl-bg-panel)" />
      <rect x="112" y="46" width="94" height="118" rx="8" stroke={INK} strokeWidth="2" fill="var(--cl-bg-panel)" />
      {[70, 86, 102, 118, 134].map((y, i) => (
        <line key={i} x1="128" y1={y} x2={i === 4 ? 166 : 190} y2={y} stroke={i === 0 ? ACCENT : LINE} strokeWidth={i === 0 ? 3 : 2} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Published to YouTube, kept forever, handed over. */
function PublishDiagram({ className }: DiagramProps) {
  return (
    <svg {...svgBase} className={className} aria-label="A finished video published and shared with the player">
      <rect x="34" y="46" width="130" height="88" rx="10" stroke={INK} strokeWidth="2" fill="none" />
      <path d="M92 74 L120 90 L92 106 Z" fill={ACCENT} />
      <path d="M176 66 L206 66 L206 96" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M206 66 L172 100" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <line x1="34" y1="150" x2="164" y2="150" stroke={LINE} strokeWidth="1" strokeDasharray="3 5" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   The spine.
   ──────────────────────────────────────────────────────────────────────────── */

type Entry = {
  date: string;
  title: string;
  body: string;
  micro?: string;
  Diagram: React.ComponentType<DiagramProps>;
};

/**
 * One example player's season. The chain runs exactly as the product does:
 * measure → correct → composite → phase → match data → the two files →
 * published and handed over.
 */
const ENTRIES: Entry[] = [
  {
    date: 'MAR 04',
    title: 'The stroke, measured.',
    body:
      'Shoulder, hip, knee, elbow — AngleMotion reads 13+ joint angles automatically and shows the numbers right on the frame. Compare a serve to a model, prove why a stroke breaks down, and back every note with a real measurement instead of a guess.',
    Diagram: AngleDiagram,
  },
  {
    date: 'MAR 18',
    title: 'The AI drafts. You decide.',
    body:
      'Every skeleton keypoint and every angle the AI detects is yours to move. Drag any point, correct any angle, trust the read. AI-fast for the 90%, coach-accurate for the 10% that matters — no black box you can’t touch.',
    micro: 'Trust the AI for speed. Trust yourself for the truth.',
    Diagram: SkeletonDiagram,
  },
  {
    date: 'APR 09',
    title: 'The whole stroke, at once.',
    body:
      'Motion Layer turns a swing into a multi-position composite — as a still and as video. You choose the frames and the layers, so the trail shows the path you want the player to see. The demo that sells your coaching and the shareable that markets it.',
    micro: 'Plus — it looks incredible.',
    Diagram: MotionLayerDiagram,
  },
  {
    date: 'APR 27',
    title: 'Phase by phase, in slow motion.',
    body:
      'Snapshot every phase of the stroke and replay it frame-by-frame in slow motion, side-by-side, with angle overlays. Then screen-record it with your webcam and mic to deliver a same-day coaching video your player can rewatch until it clicks.',
    Diagram: PhaseDiagram,
  },
  {
    date: 'MAY 16',
    title: 'The match, in numbers.',
    body:
      'Follow a player through a live match and log every point by hand, or let the Match Decoder read your SwingVision screenshots and derive the stats SwingVision doesn’t surface. Either way the match ends as data, not an impression.',
    Diagram: MatchDiagram,
  },
  {
    date: 'JUN 02',
    title: 'Two files that outlive the session.',
    body:
      'Every player carries two documents — technical analysis and match analysis — plus a player database and progress tracking across the whole season. Rivals hand you a clip and stop. This is the client file, the deliverable, and the storefront in one place.',
    micro: 'Every student’s technical story in one file — from first lesson to nationals.',
    Diagram: DocsDiagram,
  },
  {
    date: 'JUN 21',
    title: 'Published, permanent, handed over.',
    body:
      'Push the finished video straight to YouTube as unlisted and drop it into the player’s report. Nothing to store, nothing to pay for, no archive to run out of — an unlimited record your students keep and can rewatch years later.',
    Diagram: PublishDiagram,
  },
];

/** Steps for the tutorial section. Real screenshots land here in a later pass. */
const TUTORIAL_STEPS = [
  { t: 'Bring the video in', b: 'Upload from your camera roll, pull from Google Drive, or paste a YouTube link. Nothing to install.' },
  { t: 'Find the frame', b: 'Step frame-by-frame to the moment that matters and snapshot it as a phase.' },
  { t: 'Let the AI read it', b: 'Run pose detection and AI Detect Angles, then correct any point the AI got wrong.' },
  { t: 'Build the composite', b: 'Pick your frames and layers and generate the Motion Layer still or video.' },
  { t: 'Record the explanation', b: 'Capture screen, webcam and mic in one hub while you talk the player through it.' },
  { t: 'Send the report', b: 'Publish to YouTube, drop everything into the player’s document, and share the link.' },
];

/**
 * Real reviews of Vin Baccelli's coaching analysis, supplied by the founder.
 * These are reviews of the COACHING SERVICE, not of AngleMotion the product —
 * the section header and intro say so plainly, because implying they were app
 * reviews would be false.
 *
 * `source` is displayed per review. It is deliberately not aggregated into a
 * star rating: see the provenance note at the top of this file.
 */
type Review = { name: string; where?: string; source: 'Google' | 'Trustpilot'; quote: string };

const FOUNDER_REVIEWS: Review[] = [
  {
    name: 'Lalito Ayob', source: 'Google',
    quote: 'Vin is truly an expert in biomechanics. He did an incredible job analyzing my son’s forehand, providing insights and analysis at a level I’ve never encountered before.',
  },
  {
    name: 'Gerardo Serna', source: 'Google',
    quote: 'Vin gave me an amazing review about my swing… he saw areas of improvement my coach has never detected before… he really cares that I improve my game.',
  },
  {
    name: 'Nathan Matthews', source: 'Google',
    quote: 'I’ve recently come across Vin’s content and I’ve been really impressed so far. Communication has been great and he has taken the time to answer all my questions.',
  },
  {
    name: 'Philipp Irsara', where: 'IT', source: 'Trustpilot',
    quote: 'Thank you Vin, your feedback was so, so useful — very professional, technical, and precise… your analysis is worth far more than the price… none went into this level of detail.',
  },
  {
    name: 'Angelica Ayoub', where: 'US', source: 'Trustpilot',
    quote: 'Vin’s expertise in biomechanics is remarkable. His thorough analysis of my son’s forehand revealed insights at a depth I’ve never experienced.',
  },
  {
    name: 'Robert', where: 'SE', source: 'Trustpilot',
    quote: 'Outstanding tennis video analysis — clear, detailed and highly professional. A clear, structured breakdown of his stroke mechanics.',
  },
  {
    name: 'Luca', where: 'IT', source: 'Trustpilot',
    quote: 'Great experience — great analysis, highly recommended.',
  },
];

/**
 * TWO DIFFERENT Trustpilot profiles. They must never be conflated on the page:
 * one carries the founder's coaching reviews, the other is the app's own empty
 * profile, and mixing them would attribute a rating to a product that has not
 * earned one.
 *
 * Both verified in a browser on 2026-09-04.
 */

/** "Anglemotion by Coach Vinbaccelli" — the founder's COACHING profile, claimed
 *  June 2025, Milano. 6 reviews, TrustScore 4.2, "Molto buono" (Very Good).
 *  This is where the Trustpilot quotes in FOUNDER_REVIEWS actually live, so it
 *  is the only profile whose rating this page may state. */
const TRUSTPILOT_COACH_URL = 'https://it.trustpilot.com/review/vinbaccelli.com';
/** Every review on that profile is 5 stars (star breakdown reads 5★ 100%).
 *  The profile's headline TrustScore is 4.2 because Trustpilot weights by
 *  recency and volume rather than averaging stars — so the page states the
 *  star record, which is what the reviewers actually left. */
const TRUSTPILOT_COACH_COUNT = 6;

/** AngleMotion's own claimed profile. 0 reviews / 0.0 — a plain invitation
 *  only. No rating may be stated for this one until it has one. */
const TRUSTPILOT_APP_URL = 'https://www.trustpilot.com/review/anglemotion.com';

/* Verified competitor comparison. y = yes, n = no, q = unknown. Pro tier vs
   Pro tier: CoachNow PRO $499.99/yr (coachnow.com/pricing); Dartfish 360 S
   ≈ €40/mo (dartfish.com/plans) — their ~$5/mo Express tier is mobile-only and
   not comparable. Unknowns stay '?'; nothing here is estimated. */
const COMPARE_COLS = ['AngleMotion', 'CoachNow', 'Dartfish'];
const COMPARE_ROWS: Array<{ label: string; cells: Array<'y' | 'n' | 'q' | string> }> = [
  { label: 'Price (Pro tier, annual)', cells: ['$200/yr', '$499/yr', '~€480/yr'] },
  { label: 'AI pose / skeleton overlay', cells: ['y', 'y', 'y'] },
  { label: 'Angle measurement (auto)', cells: ['y', 'y', 'y'] },
  { label: 'Editable AI skeleton (override by hand)', cells: ['y', 'q', 'n'] },
  { label: 'Slow-mo / frame-by-frame', cells: ['y', 'y', 'y'] },
  { label: 'Drawing / telestration', cells: ['y', 'y', 'y'] },
  { label: 'Side-by-side compare', cells: ['y', 'y', 'y'] },
  { label: 'Motion Layer / motion-trail composite', cells: ['y', 'n', 'y'] },
  { label: 'Coaching report (Google Docs)', cells: ['y', 'q', 'q'] },
  { label: 'Player database / client file', cells: ['y', 'y', 'q'] },
  { label: 'Videos stay local (no cloud lock-in)', cells: ['y', 'n', 'n'] },
  { label: 'One-click YouTube publish', cells: ['y', 'q', 'q'] },
  { label: 'SwingVision stat import (Match Decoder)', cells: ['y', 'n', 'n'] },
];

const FAQS = [
  { q: 'What is AngleMotion?', a: 'A browser-based tennis video-analysis platform: AI skeleton + angle detection you can edit by hand, Motion Layer composites, slow-motion phase replays, a recording hub, and per-player Google Docs coaching reports — all in one place.' },
  { q: 'Does the AI replace my judgment?', a: 'No. Every skeleton point and angle the AI detects is editable — drag it, correct it, trust it. AI does the fast 90%; you own the 10% that matters.' },
  { q: 'Do my videos get uploaded to a cloud?', a: 'No. Your footage is processed locally in your browser and stays on your device. Only the reports and clips you explicitly export go to your own Google Drive / YouTube.' },
  { q: 'What do I need to run it?', a: 'Just a browser — nothing to install. A laptop or desktop with graphics acceleration on gives the smoothest AI skeleton.' },
  { q: 'Is this only for coaches?', a: 'No. Plenty of players and parents run their own analysis and build their own record over time. The Academy exists so you can learn what to film and what to look for.' },
  { q: 'How does the yearly plan and free eBook work?', a: 'Go yearly ($200/yr — 2 months free vs monthly) and we include our tennis biomechanics eBook, the coach’s guide to reading every stroke.' },
  { q: 'Can I use my SwingVision data?', a: 'Yes — the Match Decoder reads SwingVision screenshots and folds match stats into the player’s file.' },
];

function Cell({ v }: { v: string }) {
  if (v === 'y') return <Check size={18} style={{ color: 'var(--cl-success-text)' }} aria-label="yes" />;
  if (v === 'n') return <X size={16} style={{ color: 'var(--cl-text-secondary)' }} aria-label="no" />;
  if (v === 'q') return <Minus size={16} style={{ color: 'var(--cl-text-secondary)' }} aria-label="unknown" />;
  return <span className="am-tabular" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</span>;
}

/* ────────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const spineRef = useRef<HTMLDivElement | null>(null);

  /**
   * The travelling band: the one authored motion on this page. It reports how
   * far the reader has moved through the player's season, written to a CSS
   * custom property so the paint stays off the React render path.
   */
  const onScroll = useCallback(() => {
    const el = spineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const total = rect.height - vh * 0.5;
    const progress = total <= 0 ? 0 : Math.min(1, Math.max(0, (vh * 0.5 - rect.top) / total));
    el.style.setProperty('--am-progress', String(progress));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      spineRef.current?.style.setProperty('--am-progress', '1');
      return;
    }
    // `.am-root` is the scroll container (100dvh + overflow-y:auto, kept from
    // the previous page because the document-level alternative loses the last
    // control under iOS Safari's collapsing toolbar). The window therefore
    // never scrolls — listen on the container instead, or the band sits dead
    // at zero. The rect math is viewport-relative and stays correct either way.
    const scroller = rootRef.current;
    if (!scroller) return;
    let frame = 0;
    const handler = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; onScroll(); });
    };
    onScroll();
    scroller.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, [onScroll]);

  return (
    <div className="am-root" ref={rootRef}>
      <style>{CSS}</style>

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="am-nav">
        <Link href="/" className="am-wordmark" aria-label="AngleMotion home">
          <img src="/logo-square-new.jpg" alt="" width={26} height={26} />
          <span>Angle<span style={{ color: ACCENT }}>Motion</span></span>
        </Link>
        <div className="am-nav-links">
          <a href="#season" className="am-navlink">How it works</a>
          <a href="#academy" className="am-navlink">Academy</a>
          <a href="#pricing" className="am-navlink">Pricing</a>
          <a href="#compare" className="am-navlink">Compare</a>
          <Link href="/login" className="am-navlink am-navlink-strong">Sign in</Link>
          <Link href="/login" className="am-btn am-btn-sm">Start free</Link>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <header className="am-hero">
        <h1 className="am-display">
          Video in.<br />
          <span style={{ color: ACCENT }}>Report out.</span>
        </h1>
        <p className="am-lede">
          AngleMotion turns the footage you already have into a permanent, shareable record of a
          player’s development — measured, corrected by you, and kept for as long as they play.
        </p>
        <div className="am-cta-row">
          <Link href={DEMO.url} className="am-btn am-btn-lg">
            {DEMO.label} <ArrowRight size={18} />
          </Link>
          <a href="#season" className="am-ghost">Follow one player’s season</a>
        </div>
        <p className="am-note">{DEMO.note}</p>
        <ul className="am-facts">
          <li>Runs in your browser — nothing to install</li>
          <li>Your videos stay local — no cloud lock-in</li>
          <li>Works with Google Docs, YouTube and SwingVision</li>
        </ul>
      </header>

      {/* ── THE SEASON (the spine) ──────────────────────────────────────── */}
      <section id="season" className="am-season" ref={spineRef}>
        <div className="am-season-head">
          <h2 className="am-h2">One player. One season. One file that keeps growing.</h2>
          <p className="am-sub">
            Every tool below exists because something in this timeline needed it. Scroll the season.
          </p>
          <p className="am-synthetic">
            An illustrative timeline. The dates and readings are examples, not a real client’s record.
          </p>
        </div>

        <div className="am-rail" aria-hidden="true">
          <span className="am-rail-band" />
        </div>

        <ol className="am-entries">
          {ENTRIES.map(({ date, title, body, micro, Diagram }) => (
            <li key={date} className="am-entry">
              <div className="am-entry-date am-tabular">{date}</div>
              <div className="am-entry-body">
                <h3 className="am-h3">{title}</h3>
                <p className="am-p">{body}</p>
                {micro && <p className="am-micro">{micro}</p>}
              </div>
              <div className="am-entry-figure">
                <Diagram className="am-diagram" />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── TUTORIAL ────────────────────────────────────────────────────
          Structure only for now. Real product screenshots are supplied in a
          later pass and drop into .am-step-shot — the step list reads
          correctly without them, so nothing here is a placeholder pretending
          to be content. ─────────────────────────────────────────────────── */}
      <section id="how" className="am-section am-tutorial">
        <h2 className="am-h2">From footage to a finished report, in six steps.</h2>
        <p className="am-sub">The whole loop, start to finish. No step needs a second app.</p>
        <ol className="am-steps">
          {TUTORIAL_STEPS.map((s, i) => (
            <li key={s.t} className="am-step">
              <span className="am-step-n am-tabular">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="am-step-t">{s.t}</h3>
                <p className="am-p">{s.b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── ACADEMY ─────────────────────────────────────────────────────── */}
      <section id="academy" className="am-section am-academy">
        <div>
          <h2 className="am-h2">Learn what to film, and what to look for.</h2>
          <p className="am-p am-p-wide">
            AngleMotion Academy is a growing library of eBooks, guides and drill breakdowns that
            teach the craft behind the tool — how to set up a shot, which phase of a stroke actually
            explains a fault, and how to turn a reading into something a player can act on. Coaches
            use it to sharpen their eye. Players and parents use it to analyse themselves properly
            instead of guessing.
          </p>
          <p className="am-note">Included with the Pro plan.</p>
        </div>
      </section>

      {/* ── FOUNDER ─────────────────────────────────────────────────────
          Real reviews of Vin's coaching, framed as exactly that. The app is
          new and has no reviews of its own; saying so is the reason these can
          be shown at all. No aggregate rating — see the note at the top of
          this file. ──────────────────────────────────────────────────────── */}
      <section id="founder" className="am-section">
        <h2 className="am-h2">About Vin Baccelli, founder &amp; coach.</h2>
        <p className="am-sub">
          AngleMotion was built by a working tennis coach to do the job he was already doing by hand.
          The reviews below are of Vin’s own coaching analysis — the practice the tool came out of.
          AngleMotion itself is new and hasn’t been reviewed yet.
        </p>

        <ul className="am-reviews">
          {FOUNDER_REVIEWS.map((r) => (
            <li key={r.name} className="am-review">
              <blockquote className="am-quote">{r.quote}</blockquote>
              <footer className="am-review-by">
                <cite className="am-review-name">{r.name}{r.where ? `, ${r.where}` : ''}</cite>
                <span className="am-review-src">{r.source}</span>
              </footer>
            </li>
          ))}
        </ul>

        <div className="am-review-cta">
          <a href={TRUSTPILOT_COACH_URL} target="_blank" rel="noopener noreferrer" className="am-btn am-btn-quiet">
            Read all reviews of Vin’s coaching <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <p className="am-note">
            All {TRUSTPILOT_COACH_COUNT} reviews on Trustpilot are 5 stars — for Vin’s coaching
            analysis, not for the app.
          </p>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="am-section">
        <h2 className="am-h2">Pricing that fits how you coach.</h2>
        <div className="am-toggle" role="group" aria-label="Billing period">
          <button type="button" onClick={() => setAnnual(false)} className={`am-toggle-b ${!annual ? 'is-on' : ''}`} aria-pressed={!annual}>Monthly</button>
          <button type="button" onClick={() => setAnnual(true)} className={`am-toggle-b ${annual ? 'is-on' : ''}`} aria-pressed={annual}>Yearly · 2 months free</button>
        </div>

        <div className="am-plans">
          {PLANS.map((plan) => (
            <div key={plan.id} className={`am-plan ${plan.featured ? 'is-featured' : ''}`}>
              <h3 className="am-plan-name">{plan.name}</h3>
              <p className="am-plan-tag">{plan.tagline}</p>
              <p className="am-plan-price am-tabular">
                ${annual ? yearlyPerMonth(plan) : planPrice(plan, 'monthly')}
                <span className="am-plan-per">/mo</span>
              </p>
              <p className="am-plan-billed am-tabular">
                {annual ? `$${planPrice(plan, 'yearly')} billed yearly` : 'billed monthly'}
                {plan.seats > 1 ? ` · ${plan.seats} coach seats` : ''}
              </p>
              <ul className="am-plan-features">
                {plan.features.map((f) => (
                  <li key={f}><Check size={15} aria-hidden="true" /> <span>{f}</span></li>
                ))}
              </ul>
              <Link href="/pricing" className={`am-btn ${plan.featured ? '' : 'am-btn-quiet'} am-btn-block`}>
                Choose {plan.name}
              </Link>
            </div>
          ))}
        </div>

        <p className="am-note am-center">
          Go yearly and get our tennis biomechanics eBook — the coach’s guide to reading every stroke.
        </p>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="am-section am-faq-section">
        <h2 className="am-h2">Questions, answered.</h2>
        <div className="am-faqs">
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q} className="am-faq">
                <button
                  type="button"
                  className="am-faq-q"
                  aria-expanded={open}
                  onClick={() => setOpenFaq(open ? null : i)}
                >
                  <span>{f.q}</span>
                  <ChevronDown size={18} className={`am-chev ${open ? 'is-open' : ''}`} aria-hidden="true" />
                </button>
                {open && <p className="am-faq-a">{f.a}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── COMPARE ─────────────────────────────────────────────────────── */}
      <section id="compare" className="am-section">
        <h2 className="am-h2">How it compares.</h2>
        <p className="am-sub">
          Verified data only. Where a competitor doesn’t publish an answer we leave it unknown rather
          than guess.
        </p>
        <div className="am-table-wrap">
          <table className="am-table">
            <caption className="am-visually-hidden">Feature comparison against CoachNow and Dartfish</caption>
            <thead>
              <tr>
                <th scope="col">&nbsp;</th>
                {COMPARE_COLS.map((c, i) => (
                  <th key={c} scope="col" className={i === 0 ? 'is-us' : ''}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={i === 0 ? 'is-us' : ''}><Cell v={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── CLOSE ───────────────────────────────────────────────────────── */}
      <section className="am-close">
        <h2 className="am-display am-display-sm">Start your first file today.</h2>
        <p className="am-lede am-center">
          One hour of every tool, free. Bring a video you already have and see what comes out the
          other side.
        </p>
        <div className="am-cta-row am-center-row">
          <Link href={DEMO.url} className="am-btn am-btn-lg">{DEMO.label} <ArrowRight size={18} /></Link>
        </div>

        {/* The APP's own Trustpilot profile — deliberately here, beside the app
            CTAs, and never inside the founder section: the two profiles measure
            different things and must not be read as one. It has no reviews yet,
            so this is an invitation and states no rating. */}
        <p className="am-note am-center am-app-review">
          Already used it?{' '}
          <a href={TRUSTPILOT_APP_URL} target="_blank" rel="noopener noreferrer" className="am-inline-link">
            Review AngleMotion on Trustpilot <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </p>
      </section>

      <footer className="am-footer">
        <Link href="/" className="am-wordmark" aria-label="AngleMotion home">
          <img src="/logo-square-new.jpg" alt="" width={22} height={22} />
          <span>Angle<span style={{ color: ACCENT }}>Motion</span></span>
        </Link>
        <nav className="am-footer-links">
          <a href="#season">How it works</a>
          <a href="#academy">Academy</a>
          <a href="#founder">The founder</a>
          <a href="#pricing">Pricing</a>
          <Link href="/coaches">Coaches</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login">Sign in <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </nav>
        <p className="am-footer-note">© {new Date().getFullYear()} AngleMotion · Coaching intelligence platform</p>
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Styles. Scoped under .am-root so nothing here reaches the app chrome.
   ──────────────────────────────────────────────────────────────────────────── */

const CSS = `
.am-root {
  --am-gutter: clamp(20px, 5vw, 72px);
  --am-max: 1180px;
  --am-rail-x: clamp(20px, 5vw, 72px);
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--cl-bg-panel);
  color: var(--cl-text-primary);
  font-family: var(--cl-font);
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}
@media (prefers-reduced-motion: reduce) { .am-root { scroll-behavior: auto; } }

/* Browser surfaces belong to the design system too. */
.am-root ::selection { background: var(--cl-accent); color: var(--cl-text-on-fill); }
.am-root :focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 3px; border-radius: 8px; }
.am-root a:not([class]) { color: inherit; }
.am-tabular { font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.am-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* NAV */
.am-nav {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 14px var(--am-gutter);
  background: rgba(255,255,255,0.88);
  backdrop-filter: saturate(1.6) blur(14px);
  border-bottom: 1px solid var(--cl-border-subtle);
}
.am-wordmark {
  display: inline-flex; align-items: center; gap: 9px;
  font-size: 17px; font-weight: 800; letter-spacing: -0.03em; text-decoration: none;
}
.am-wordmark img { border-radius: var(--cl-radius-sm); display: block; }
.am-nav-links { display: flex; align-items: center; gap: 22px; }
.am-navlink {
  font-size: 15px; font-weight: 500; color: var(--cl-text-secondary);
  text-decoration: none; transition: color .18s cubic-bezier(.16,1,.3,1);
}
.am-navlink:hover { color: var(--cl-text-primary); }
.am-navlink-strong { font-weight: 600; color: var(--cl-text-primary); }
@media (max-width: 860px) {
  .am-nav-links .am-navlink:not(.am-navlink-strong) { display: none; }
}

/* BUTTONS */
.am-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 0 22px; border-radius: 999px;
  background: var(--cl-accent); color: var(--cl-text-on-fill);
  font-size: 15px; font-weight: 600; text-decoration: none; border: none; cursor: pointer;
  transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s cubic-bezier(.16,1,.3,1);
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 22px rgba(0,122,255,.18);
}
.am-btn:hover { transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,.07), 0 14px 30px rgba(0,122,255,.24); }
.am-btn-sm { min-height: 38px; padding: 0 16px; font-size: 15px; }
.am-btn-lg { min-height: 52px; padding: 0 28px; font-size: 17px; }
.am-btn-block { display: flex; width: 100%; }
.am-btn-quiet {
  background: var(--cl-bg-panel); color: var(--cl-text-primary);
  border: 1px solid var(--cl-border); box-shadow: none;
}
.am-btn-quiet:hover { box-shadow: 0 6px 18px rgba(0,0,0,.06); }
.am-ghost {
  display: inline-flex; align-items: center; min-height: 44px;
  font-size: 15px; font-weight: 600; color: var(--cl-accent); text-decoration: none;
}
.am-ghost:hover { text-decoration: underline; text-underline-offset: 4px; }

/* TYPE */
.am-display {
  margin: 0 0 22px;
  font-size: clamp(46px, 10.5vw, 116px);
  line-height: 0.94;
  letter-spacing: -0.045em;
  font-weight: 800;
  text-wrap: balance;
}
.am-display-sm { font-size: clamp(34px, 6.4vw, 68px); }
.am-h2 {
  margin: 0 0 14px;
  font-size: clamp(28px, 4.4vw, 52px);
  line-height: 1.04; letter-spacing: -0.035em; font-weight: 700;
  text-wrap: balance; max-width: 20ch;
}
.am-h3 {
  margin: 0 0 12px;
  font-size: clamp(22px, 2.8vw, 34px);
  line-height: 1.1; letter-spacing: -0.03em; font-weight: 700; text-wrap: balance;
}
.am-lede {
  margin: 0 0 30px; max-width: 62ch;
  font-size: clamp(17px, 2vw, 21px); line-height: 1.5; color: var(--cl-text-secondary);
}
.am-p { margin: 0; max-width: 68ch; font-size: 17px; line-height: 1.62; color: var(--cl-text-secondary); }
.am-p-wide { max-width: 72ch; font-size: 17px; }
.am-sub { margin: 0 0 34px; max-width: 60ch; font-size: 17px; line-height: 1.55; color: var(--cl-text-secondary); }
.am-micro { margin: 14px 0 0; font-size: 15px; font-weight: 600; color: var(--cl-text-primary); }
.am-note { margin: 16px 0 0; font-size: 13px; line-height: 1.5; color: var(--cl-text-secondary); }
.am-synthetic {
  margin: 18px 0 0; padding-left: 12px; border-left: 1px solid var(--cl-border);
  font-size: 13px; line-height: 1.5; color: var(--cl-text-secondary); max-width: 52ch;
}
.am-center { text-align: center; margin-left: auto; margin-right: auto; }
.am-center-row { justify-content: center; }

/* HERO */
.am-hero { padding: clamp(64px, 11vw, 132px) var(--am-gutter) clamp(44px, 7vw, 84px); max-width: var(--am-max); margin: 0 auto; }
.am-cta-row { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.am-facts {
  display: flex; flex-wrap: wrap; gap: 10px 28px;
  margin: 44px 0 0; padding: 26px 0 0; list-style: none;
  border-top: 1px solid var(--cl-border-subtle);
  font-size: 15px; color: var(--cl-text-secondary);
}

/* THE SPINE */
.am-season { position: relative; padding: clamp(48px, 8vw, 96px) 0 clamp(56px, 9vw, 110px); }
.am-season-head { max-width: var(--am-max); margin: 0 auto clamp(40px, 6vw, 76px); padding: 0 var(--am-gutter); }
.am-rail {
  position: absolute; top: 0; bottom: 0; left: var(--am-rail-x); width: 1px;
  background: var(--cl-border); pointer-events: none;
}
.am-rail-band {
  position: absolute; left: -1px; top: 0; width: 3px;
  height: calc(var(--am-progress, 0) * 100%);
  background: var(--cl-accent); border-radius: 999px;
}
.am-entries { list-style: none; margin: 0; padding: 0; max-width: var(--am-max); margin-inline: auto; }
.am-entry {
  position: relative;
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) minmax(0, 300px);
  gap: clamp(20px, 4vw, 56px);
  align-items: start;
  padding: clamp(34px, 5vw, 62px) var(--am-gutter);
}
.am-entry + .am-entry { border-top: 1px solid var(--cl-border-subtle); }
.am-entry-date {
  font-size: 13px; font-weight: 700; letter-spacing: 0.11em;
  color: var(--cl-text-secondary); padding-top: 6px; white-space: nowrap;
}
.am-entry-figure { display: flex; justify-content: flex-end; }
.am-diagram { width: 100%; max-width: 300px; height: auto; }
@media (max-width: 900px) {
  .am-entry { grid-template-columns: 1fr; gap: 18px; padding-left: calc(var(--am-rail-x) + 22px); }
  .am-entry-date { padding-top: 0; }
  .am-entry-figure { justify-content: flex-start; }
  .am-diagram { max-width: 240px; }
}

/* Anchor targets must clear the sticky nav, or every in-page link lands with
   its heading tucked under the bar. */
.am-root [id] { scroll-margin-top: 76px; }

/* SECTIONS */
.am-section { max-width: var(--am-max); margin: 0 auto; padding: clamp(56px, 9vw, 112px) var(--am-gutter); border-top: 1px solid var(--cl-border-subtle); }

/* TUTORIAL */
.am-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.am-step {
  display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 20px; align-items: start;
  padding: 26px 0; border-top: 1px solid var(--cl-border-subtle);
}
.am-step:first-child { border-top: none; }
.am-step-n { font-size: 13px; font-weight: 700; color: var(--cl-accent); letter-spacing: 0.08em; padding-top: 4px; }
.am-step-t { margin: 0 0 8px; font-size: 21px; font-weight: 650; letter-spacing: -0.02em; }

/* ACADEMY */
.am-academy { }

/* FOUNDER REVIEWS
   Ruled cells rather than floating cards: the spine's own language, and it
   keeps a long quote and a two-word quote sitting on the same baseline grid. */
.am-reviews {
  list-style: none; margin: 0 0 40px; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(288px, 1fr));
  gap: 0 clamp(24px, 4vw, 52px);
  border-top: 1px solid var(--cl-border-subtle);
}
.am-review {
  display: flex; flex-direction: column; justify-content: space-between; gap: 18px;
  padding: 26px 0; border-bottom: 1px solid var(--cl-border-subtle);
}
.am-quote {
  margin: 0; font-size: 17px; line-height: 1.55;
  letter-spacing: -0.015em; color: var(--cl-text-primary); text-wrap: pretty;
}
.am-quote::before { content: '“'; }
.am-quote::after { content: '”'; }
.am-review-by { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.am-review-name { font-size: 15px; font-weight: 600; font-style: normal; color: var(--cl-text-primary); }
.am-review-src {
  font-size: 13px; font-weight: 500; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--cl-text-secondary);
}
.am-review-cta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.am-review-cta .am-note { margin-top: 12px; }

/* PRICING */
.am-toggle {
  display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 34px;
  background: var(--cl-bg-secondary); border-radius: 999px;
}
.am-toggle-b {
  min-height: 40px; padding: 0 18px; border: none; border-radius: 999px; cursor: pointer;
  background: transparent; color: var(--cl-text-secondary);
  font-family: inherit; font-size: 15px; font-weight: 600;
  transition: background .2s cubic-bezier(.16,1,.3,1), color .2s cubic-bezier(.16,1,.3,1);
}
.am-toggle-b.is-on { background: var(--cl-bg-panel); color: var(--cl-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.am-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(258px, 1fr)); gap: 18px; }
.am-plan {
  display: flex; flex-direction: column; gap: 6px;
  padding: 28px 24px; border-radius: var(--cl-radius-lg);
  border: 1px solid var(--cl-border);
}
.am-plan.is-featured { border-color: var(--cl-accent); }
.am-plan-name { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }
.am-plan-tag { margin: 0 0 12px; font-size: 15px; color: var(--cl-text-secondary); }
.am-plan-price { margin: 0; font-size: 42px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }
.am-plan-per { font-size: 15px; font-weight: 600; color: var(--cl-text-secondary); letter-spacing: 0; }
.am-plan-billed { margin: 8px 0 18px; font-size: 13px; color: var(--cl-text-secondary); }
.am-plan-features { list-style: none; margin: 0 0 24px; padding: 0; display: grid; gap: 10px; flex: 1; }
.am-plan-features li { display: grid; grid-template-columns: 18px 1fr; gap: 9px; font-size: 15px; line-height: 1.45; color: var(--cl-text-secondary); }
.am-plan-features svg { color: var(--cl-accent); margin-top: 3px; }

/* COMPARE */
.am-table-wrap { overflow-x: auto; border: 1px solid var(--cl-border); border-radius: var(--cl-radius-lg); }
.am-table { width: 100%; border-collapse: collapse; font-size: 15px; min-width: 560px; }
.am-table th, .am-table td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--cl-border-subtle); }
.am-table thead th { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cl-text-secondary); font-weight: 700; }
.am-table thead th.is-us { color: var(--cl-accent); }
.am-table tbody th { font-weight: 500; color: var(--cl-text-secondary); }
.am-table td { text-align: center; width: 132px; }
.am-table td.is-us { background: var(--cl-accent-soft); }
.am-table tr:last-child th, .am-table tr:last-child td { border-bottom: none; }

/* FAQ */
.am-faqs { display: grid; gap: 0; max-width: 820px; }
.am-faq { border-top: 1px solid var(--cl-border-subtle); }
.am-faq:last-child { border-bottom: 1px solid var(--cl-border-subtle); }
.am-faq-q {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; min-height: 62px; padding: 16px 0; background: none; border: none; cursor: pointer;
  font-family: inherit; font-size: 17px; font-weight: 600; letter-spacing: -0.015em;
  color: var(--cl-text-primary); text-align: left;
}
.am-chev { color: var(--cl-text-secondary); flex: none; transition: transform .24s cubic-bezier(.16,1,.3,1); }
.am-chev.is-open { transform: rotate(180deg); color: var(--cl-accent); }
.am-faq-a { margin: 0 0 22px; max-width: 68ch; font-size: 15px; line-height: 1.62; color: var(--cl-text-secondary); }

/* CLOSE + FOOTER */
.am-app-review { max-width: 46ch; }
.am-inline-link {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--cl-accent); font-weight: 600; text-decoration: none;
}
.am-inline-link:hover { text-decoration: underline; text-underline-offset: 3px; }

.am-close {
  max-width: var(--am-max); margin: 0 auto; text-align: center;
  padding: clamp(72px, 11vw, 140px) var(--am-gutter);
  border-top: 1px solid var(--cl-border-subtle);
}
.am-footer {
  display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px;
  max-width: var(--am-max); margin: 0 auto;
  padding: 32px var(--am-gutter) 56px;
  border-top: 1px solid var(--cl-border-subtle);
}
.am-footer-links { display: flex; flex-wrap: wrap; gap: 8px 22px; flex: 1; }
.am-footer-links a {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 15px; color: var(--cl-text-secondary); text-decoration: none;
}
.am-footer-links a:hover { color: var(--cl-text-primary); }
.am-footer-note { width: 100%; margin: 0; font-size: 13px; color: var(--cl-text-secondary); }
`;
