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
 *  - The reviews in FOUNDER_REVIEWS are real and supplied by the founder.
 *    Nothing here may be added without that same provenance. No club logos,
 *    user counts, benchmarks or press exist for this product; none are
 *    invented or implied.
 *  - Trustpilot: as of 2026-10-03 the founder states ONE Trustpilot profile
 *    covers both the app and his coaching analysis, and that every review on
 *    it is 5 stars. The star line beside the reviews says exactly that and no
 *    more — no count, no TrustScore.
 *  - The competitor table carries ONLY verified data; unknowns stay '?'.
 *  - The example player's dates and readings are illustrative and are labelled
 *    as such on the page, not passed off as a real customer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, X, Minus, ChevronDown, ArrowRight, ArrowUpRight } from 'lucide-react';
import { PLANS, DEMO, planPrice, yearlyPerMonth } from '@/lib/plans';

/* ────────────────────────────────────────────────────────────────────────────
   Product screenshots.

   Real captures of the product, supplied by the founder. The originals sit in
   public/marketing/landing/ exactly as taken; what the page loads are crops of
   them in public/marketing/landing/web/, cut to the product itself — no browser
   chrome, desktop notifications or other tabs. Width and height below are each
   crop's real pixel size, so next/image reserves the right box before load.
   ──────────────────────────────────────────────────────────────────────────── */

const ACCENT = 'var(--cl-accent)';

const SHOT_DIR = '/marketing/landing/web';

type Shot = { src: string; width: number; height: number; alt: string; caption?: string };

/**
 * A looping GIF with a still twin. Visitors who asked for reduced motion get the
 * still (a <picture> source on the media query — no script, so it holds before
 * hydration too), the same rule the Motion Layer clip follows.
 */
type AnimatedShot = { src: string; still: string; width: number; height: number; alt: string };

const HERO_SHOT: Shot = {
  src: `${SHOT_DIR}/hero-skeleton-overlay.webp`,
  width: 1920,
  height: 1274,
  alt: 'A forehand mid-swing with the AI-detected skeleton drawn over the player and a panel of ten joint angles beside it — elbows, knees, feet, shoulder and hip lines.',
};

/** The Motion Layer composite, as the moving clip it exports. */
const MOTION_LAYER_CLIP = {
  src: '/marketing/landing/7d.mp4',
  width: 464,
  height: 832,
  label: 'A Motion Layer composite playing: the whole swing laid over a single frame.',
};

/* ────────────────────────────────────────────────────────────────────────────
   The spine.
   ──────────────────────────────────────────────────────────────────────────── */

type Entry = {
  date: string;
  title: string;
  body: string;
  micro?: string;
  /** One shot, or a short sequence read top to bottom (before → after). */
  shots?: Shot[];
  /** The Motion Layer entry shows the exported clip instead of a still. */
  clip?: true;
  /** A looping screen capture shown in place of a still. */
  animated?: AnimatedShot;
};

/**
 * One example player's season. The chain runs exactly as the product does:
 * measure → calibrate → correct → composite → phase → match data → the two
 * files → published and handed over.
 */
const ENTRIES: Entry[] = [
  {
    date: 'MAR 04',
    title: 'The stroke, measured.',
    body:
      'Elbows, knees, shoulder line, hip line — AngleMotion reads the joint angles off the frame and keeps every number in a data column beside the player. Draw your own angle arrows on top, compare two of them as a differential, and back every note with a real measurement instead of a guess.',
    shots: [
      {
        src: `${SHOT_DIR}/season-angles.webp`,
        width: 1920,
        height: 1082,
        alt: 'Two angle arrows drawn on a player’s shoulder and hip lines, with a data column listing both angles, their differential, and the elbow and knee angles.',
      },
    ],
  },
  {
    date: 'MAR 11',
    title: 'Centimetres, not pixels.',
    body:
      'Calibrate once against something of known size — a racket, a net post, the service box — and the ruler measures real distance anywhere in the frame. Stance width, contact point, how far a knee travels: measured, not eyeballed.',
    shots: [
      {
        src: `${SHOT_DIR}/season-ruler-reference.webp`,
        width: 1920,
        height: 1185,
        alt: 'The ruler panel asking for a calibration reference: racket, net post, net width, service box, singles court or a custom distance.',
        caption: 'Pick a reference the clip already contains.',
      },
      {
        src: `${SHOT_DIR}/season-ruler-measured.webp`,
        width: 1920,
        height: 1100,
        alt: 'The ruler calibrated against the racket at 68.6 cm, measuring 39.7 cm between the player’s knees.',
        caption: 'Calibrated on the racket: 39.7 cm, knee to knee.',
      },
    ],
  },
  {
    date: 'MAR 18',
    title: 'The AI drafts. You decide.',
    body:
      'Every skeleton keypoint and every angle the AI detects is yours to move. Drag any point, correct any angle, trust the read. AI-fast for the 90%, coach-accurate for the 10% that matters — no black box you can’t touch.',
    micro: 'Trust the AI for speed. Trust yourself for the truth.',
    // Screen capture supplied by the founder (Skeleton/WhatsApp Video
    // 2026-10-03 at 14.34.06.mp4), cropped to the canvas: the live skeleton
    // through a whole forehand, then snapshot frames with shoulder and hip
    // angle arrows. Native capture width is 390px, so it is not upscaled.
    animated: {
      src: `${SHOT_DIR}/skeleton-track.gif`,
      still: `${SHOT_DIR}/skeleton-track-still.webp`,
      width: 390,
      height: 296,
      alt: 'The AI skeleton following a forehand from backswing to finish with live joint angles in the data column, then frozen frames with angle arrows drawn on the shoulder and hip lines.',
    },
  },
  {
    date: 'APR 09',
    title: 'The whole stroke, at once.',
    body:
      'Motion Layer turns a swing into a multi-position composite — as a still and as video. You choose the frames and the layers, so the trail shows the path you want the player to see. The demo that sells your coaching and the shareable that markets it.',
    micro: 'Plus — it looks incredible.',
    clip: true,
  },
  {
    date: 'APR 27',
    title: 'Phase by phase, in slow motion.',
    body:
      'Snapshot every phase of the stroke and replay it frame-by-frame in slow motion, side-by-side, with angle overlays. Then screen-record it with your webcam and mic to deliver a same-day coaching video your player can rewatch until it clicks.',
    shots: [
      {
        src: `${SHOT_DIR}/season-angle-differential.webp`,
        width: 1920,
        height: 1246,
        alt: 'A paused contact point marked up by hand: a dashed ellipse at the hips and a 107° forearm-to-racket angle, logged in the data column.',
      },
    ],
  },
  {
    date: 'MAY 16',
    title: 'The match, in numbers.',
    body:
      'Follow a player through a live match and log every point by hand, or let the Match Decoder read your SwingVision screenshots and derive the stats SwingVision doesn’t surface. Either way the match ends as data, not an impression.',
    shots: [
      {
        src: `${SHOT_DIR}/season-match-decoder.webp`,
        width: 1136,
        height: 1344,
        alt: 'A decoded match report: shot and spin distribution charts, then a coach’s summary where every line names the numbers it rests on.',
      },
    ],
  },
  {
    date: 'JUN 02',
    title: 'Two files that outlive the session.',
    body:
      'Every player carries two documents — technical analysis and match analysis — plus a player database and progress tracking across the whole season. Rivals hand you a clip and stop. This is the client file, the deliverable, and the storefront in one place.',
    micro: 'Every student’s technical story in one file — from first lesson to nationals.',
    shots: [
      {
        src: `${SHOT_DIR}/season-player-reports.webp`,
        width: 1320,
        height: 1396,
        alt: 'A player’s reports page: dated technique analyses, one with a YouTube link, and buttons that open the Technical Analysis Doc, the Match Analysis Doc and the Drive folder.',
      },
    ],
  },
  {
    date: 'JUN 21',
    title: 'Published, permanent, handed over.',
    body:
      'Push the finished video straight to YouTube as unlisted and drop it into the player’s report. Nothing to store, nothing to pay for, no archive to run out of — an unlimited record your students keep and can rewatch years later.',
    shots: [
      {
        src: `${SHOT_DIR}/season-recording-complete.webp`,
        width: 1920,
        height: 1134,
        alt: 'A finished coaching recording — the analysed clip with the coach on camera — and the actions that follow it: Connect YouTube, Crop, Trim and Download MP4.',
      },
    ],
  },
];

/** Steps for the tutorial section, each with the screen it happens on. */
const TUTORIAL_STEPS: Array<{ t: string; b: string; shot: Shot }> = [
  {
    t: 'Bring the video in',
    b: 'Upload from your camera roll, pull from Google Drive, or paste a YouTube link. Nothing to install.',
    shot: { src: `${SHOT_DIR}/step-upload.webp`, width: 1920, height: 1328, alt: 'The empty workspace with Upload Video, the tennis-court strategy board and the demo clip.' },
  },
  {
    t: 'Find the frame',
    b: 'Step frame-by-frame to the moment that matters and snapshot it as a phase.',
    shot: { src: `${SHOT_DIR}/step-frames.webp`, width: 1920, height: 1040, alt: 'Five frames marked along the clip’s timeline, each listed with its timestamp.' },
  },
  {
    t: 'Let the AI read it',
    b: 'Run pose detection and AI Detect Angles, then correct any point the AI got wrong.',
    shot: { src: `${SHOT_DIR}/step-ai-track.webp`, width: 1300, height: 1000, alt: 'The AI Track dialog offering three tracking speeds, from extremely precise to fastest.' },
  },
  {
    t: 'Build the composite',
    b: 'Pick your frames and layers and generate the Motion Layer still or video.',
    shot: { src: `${SHOT_DIR}/step-mask-editor.webp`, width: 1880, height: 1340, alt: 'The Motion Layer mask editor with the player and racket detected automatically and highlighted, ready to cut from the background.' },
  },
  {
    t: 'Record the explanation',
    b: 'Capture screen, webcam and mic in one hub while you talk the player through it.',
    shot: { src: `${SHOT_DIR}/step-record.webp`, width: 1920, height: 1079, alt: 'A recording in progress: the clip on screen, the coach in a floating camera window with a timer, Pause and Stop.' },
  },
  {
    t: 'Send the report',
    b: 'Publish to YouTube, drop everything into the player’s document, and share the link.',
    shot: { src: `${SHOT_DIR}/step-coach-summary.webp`, width: 1136, height: 680, alt: 'A coach’s summary of six numbered observations above a Save to Google Docs button.' },
  },
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
 * Trustpilot links. Verified in a browser on 2026-09-04, when they were two
 * separate profiles; on 2026-10-03 the founder reported that one profile now
 * covers both the app and his coaching. Both links are kept as they were until
 * the founder confirms which URL that profile lives at.
 */

/** "Anglemotion by Coach Vinbaccelli" — the founder's COACHING profile, claimed
 *  June 2025, Milano. 6 reviews, TrustScore 4.2, "Molto buono" (Very Good).
 *  This is where the Trustpilot quotes in FOUNDER_REVIEWS actually live, so it
 *  is the only profile whose rating this page may state. */
const TRUSTPILOT_COACH_URL = 'https://it.trustpilot.com/review/vinbaccelli.com';

/** AngleMotion's own claimed profile. 0 reviews / 0.0 — a plain invitation
 *  only. No rating may be stated for this one until it has one. */
const TRUSTPILOT_APP_URL = 'https://www.trustpilot.com/review/anglemotion.com';

/* Verified competitor comparison. y = yes, n = no, q = unknown. Pro tier vs
   Pro tier: CoachNow PRO $499.99/yr (coachnow.com/pricing); Dartfish 360 S
   ≈ €40/mo (dartfish.com/plans) — their ~$5/mo Express tier is mobile-only and
   not comparable; OnForm Coach Pro $599.99/yr (onform.com/pricing) — their coach
   ladder is Basic $199.99 / Standard $399.99 / Pro $599.99 per year and, in
   their own words, "Coach prices multiply by Number of coaches", so five coaches
   is five times that before their 11% 3+-seat discount. Read off the live
   pricing page 2026-09-09.

   Unknowns stay '?'; nothing here is estimated. OnForm's row is mostly '?' on
   purpose: only drawing/telestration and the athlete database are stated
   outright on their pricing page, and a feature nobody has verified is not
   marked 'n' just to make the column look decisive. */
const COMPARE_COLS = ['AngleMotion', 'CoachNow', 'Dartfish', 'OnForm'];
const COMPARE_ROWS: Array<{ label: string; cells: Array<'y' | 'n' | 'q' | string> }> = [
  { label: 'Price (Pro tier, annual)', cells: ['$200/yr', '$499/yr', '~€480/yr', '$599/yr'] },
  { label: 'AI pose / skeleton overlay', cells: ['y', 'y', 'y', 'q'] },
  { label: 'Angle measurement (auto)', cells: ['y', 'y', 'y', 'q'] },
  { label: 'Editable AI skeleton (override by hand)', cells: ['y', 'q', 'n', 'q'] },
  { label: 'Slow-mo / frame-by-frame', cells: ['y', 'y', 'y', 'q'] },
  { label: 'Drawing / telestration', cells: ['y', 'y', 'y', 'y'] },
  { label: 'Side-by-side compare', cells: ['y', 'y', 'y', 'q'] },
  { label: 'Motion Layer / motion-trail composite', cells: ['y', 'n', 'y', 'q'] },
  { label: 'Coaching report (Google Docs)', cells: ['y', 'q', 'q', 'q'] },
  { label: 'Player database / client file', cells: ['y', 'y', 'q', 'y'] },
  { label: 'Videos stay local (no cloud lock-in)', cells: ['y', 'n', 'n', 'q'] },
  { label: 'One-click YouTube publish', cells: ['y', 'q', 'q', 'q'] },
  { label: 'SwingVision stat import (Match Decoder)', cells: ['y', 'n', 'n', 'q'] },
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

/**
 * The Motion Layer clip. It plays on its own, muted and looping, like the
 * still it replaces — unless the visitor asked for reduced motion, in which
 * case it waits behind its controls.
 */
function MotionLayerClip() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(prefersReduced);
    if (!prefersReduced) ref.current?.play().catch(() => { /* autoplay refused: controls stay off, clip shows its first frame */ });
  }, []);
  return (
    <video
      ref={ref}
      className="am-clip"
      src={MOTION_LAYER_CLIP.src}
      width={MOTION_LAYER_CLIP.width}
      height={MOTION_LAYER_CLIP.height}
      muted
      loop
      playsInline
      preload="metadata"
      controls={reduced}
      aria-label={MOTION_LAYER_CLIP.label}
    />
  );
}

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
        <div className="am-brand">
          <Link href="/" className="am-wordmark" aria-label="AngleMotion home">
            <img src="/logo-square-new.jpg" alt="" width={26} height={26} />
            <span>Angle<span style={{ color: ACCENT }}>Motion</span></span>
          </Link>
        </div>
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
        <h1 className="am-display am-display-hero">
          Analyze every angle <span style={{ color: ACCENT }}>of your game.</span>
        </h1>
        <p className="am-lede">
          Video in, report out. AngleMotion turns the footage you already have into a permanent,
          shareable record of a player’s development — measured, corrected by you, and kept for as
          long as they play.
        </p>
        <div className="am-cta-row">
          <Link href={DEMO.url} className="am-btn am-btn-lg">
            {DEMO.label} <ArrowRight size={18} />
          </Link>
          <a href="#season" className="am-ghost">Follow one player’s season</a>
        </div>
        <p className="am-note">{DEMO.note}</p>
        <figure className="am-hero-shot">
          <Image
            src={HERO_SHOT.src}
            width={HERO_SHOT.width}
            height={HERO_SHOT.height}
            alt={HERO_SHOT.alt}
            priority
            sizes="(max-width: 1180px) 100vw, 1180px"
          />
        </figure>
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
          {ENTRIES.map(({ date, title, body, micro, shots, clip, animated }) => (
            <li key={date} className="am-entry">
              <div className="am-entry-date am-tabular">{date}</div>
              <div className="am-entry-body">
                <h3 className="am-h3">{title}</h3>
                <p className="am-p">{body}</p>
                {micro && <p className="am-micro">{micro}</p>}
              </div>
              <div className={clip ? 'am-entry-figure am-entry-figure-clip' : 'am-entry-figure'}>
                {clip && <MotionLayerClip />}
                {animated && (
                  <figure className="am-shot">
                    <picture>
                      <source media="(prefers-reduced-motion: reduce)" srcSet={animated.still} />
                      {/* eslint-disable-next-line @next/next/no-img-element -- an animated GIF gains nothing from the optimizer */}
                      <img
                        src={animated.src}
                        width={animated.width}
                        height={animated.height}
                        alt={animated.alt}
                        loading="lazy"
                        decoding="async"
                      />
                    </picture>
                  </figure>
                )}
                {shots?.map((shot) => (
                  <figure key={shot.src} className="am-shot">
                    <Image
                      src={shot.src}
                      width={shot.width}
                      height={shot.height}
                      alt={shot.alt}
                      sizes="(max-width: 900px) 100vw, 560px"
                    />
                    {shot.caption && <figcaption className="am-shot-caption">{shot.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── TUTORIAL ────────────────────────────────────────────────────
          The six steps, each beside the screen it happens on. ──────────── */}
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
              <figure className="am-shot am-step-shot">
                <Image
                  src={s.shot.src}
                  width={s.shot.width}
                  height={s.shot.height}
                  alt={s.shot.alt}
                  sizes="(max-width: 900px) 100vw, 520px"
                />
              </figure>
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
          {/* Every paid tier as of 2026-09-09 — the Academy moved down to
              Light with founding pricing (lib/plans.ts, middleware.ts). */}
          <p className="am-note">Included with every plan.</p>
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
            All reviews on Trustpilot are 5 stars — for the app and Vin’s coaching analysis
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
          One hour of every tool, free. Bring a video you already have (or use our demo video) and
          see what comes out the other side.
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
.am-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
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
/* The hero headline stops short of the full display size so it sets in two
   lines on a desktop and the product shot below it breaks the fold. */
.am-display-hero { font-size: clamp(44px, 8.2vw, 94px); }
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
.am-hero { padding: clamp(48px, 7vw, 92px) var(--am-gutter) clamp(44px, 7vw, 84px); max-width: var(--am-max); margin: 0 auto; }
.am-cta-row { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.am-facts {
  display: flex; flex-wrap: wrap; gap: 10px 28px;
  margin: 44px 0 0; padding: 26px 0 0; list-style: none;
  border-top: 1px solid var(--cl-border-subtle);
  font-size: 15px; color: var(--cl-text-secondary);
}
/* The product at work, at full measure under the promise it makes. */
.am-hero-shot {
  margin: clamp(36px, 6vw, 64px) 0 0;
  border: 1px solid var(--cl-border); border-radius: 18px; overflow: hidden;
  box-shadow: 0 30px 60px -36px rgba(0, 0, 0, 0.35);
}
.am-hero-shot img { display: block; width: 100%; height: auto; }

/* SCREENSHOTS — framed like the hero, one step quieter. */
.am-shot {
  margin: 0; border: 1px solid var(--cl-border); border-radius: 12px; overflow: hidden;
  background: #fff;
}
.am-shot img { display: block; width: 100%; height: auto; }
.am-shot-caption {
  padding: 10px 14px; border-top: 1px solid var(--cl-border-subtle);
  font-size: 13px; line-height: 1.45; color: var(--cl-text-secondary);
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
  grid-template-columns: 88px minmax(0, 1fr) minmax(0, 1.15fr);
  gap: clamp(20px, 4vw, 56px);
  align-items: start;
  padding: clamp(34px, 5vw, 62px) var(--am-gutter);
}
.am-entry + .am-entry { border-top: 1px solid var(--cl-border-subtle); }
.am-entry-date {
  font-size: 13px; font-weight: 700; letter-spacing: 0.11em;
  color: var(--cl-text-secondary); padding-top: 6px; white-space: nowrap;
}
.am-entry-figure { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
/* The Motion Layer clip is portrait: centre it and cap its height rather than
   letting a 9:16 frame run the full column width. */
.am-entry-figure-clip { align-items: center; }
.am-clip {
  display: block; width: 100%; max-width: 300px; height: auto; aspect-ratio: 464 / 832;
  border: 1px solid var(--cl-border); border-radius: 12px; background: #0b0b0c;
}
@media (max-width: 900px) {
  .am-entry { grid-template-columns: 1fr; gap: 18px; padding-left: calc(var(--am-rail-x) + 22px); }
  .am-entry-date { padding-top: 0; }
  .am-entry-figure-clip { align-items: flex-start; }
  .am-clip { max-width: 240px; }
}

/* Anchor targets must clear the sticky nav, or every in-page link lands with
   its heading tucked under the bar. */
.am-root [id] { scroll-margin-top: 76px; }

/* SECTIONS */
.am-section { max-width: var(--am-max); margin: 0 auto; padding: clamp(56px, 9vw, 112px) var(--am-gutter); border-top: 1px solid var(--cl-border-subtle); }

/* TUTORIAL */
.am-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.am-step {
  display: grid; grid-template-columns: 64px minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px clamp(20px, 3vw, 40px); align-items: start;
  padding: 26px 0; border-top: 1px solid var(--cl-border-subtle);
}
@media (max-width: 900px) {
  .am-step { grid-template-columns: 44px minmax(0, 1fr); }
  .am-step-shot { grid-column: 2 / -1; }
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
.am-table { width: 100%; border-collapse: collapse; font-size: 15px; min-width: 680px; }
.am-table th, .am-table td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--cl-border-subtle); }
.am-table thead th { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cl-text-secondary); font-weight: 700; }
.am-table thead th.is-us { color: var(--cl-accent); }
.am-table tbody th { font-weight: 500; color: var(--cl-text-secondary); }
.am-table td { text-align: center; width: 116px; }
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
