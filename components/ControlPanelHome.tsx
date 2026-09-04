import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import {
  Video,
  Users,
  ClipboardList,
  Sparkles,
  UserCircle,
  Globe,
  CreditCard,
  GraduationCap,
  Settings,
} from 'lucide-react';

/**
 * Control Panel — the authenticated home screen.
 *
 * Operate surface, not a marketing one: it uses the app's own design system
 * (DESIGN.md "Quiet Instrument"), not the landing page's marketing type scale.
 * Every colour comes from a --cl-* token; System Blue stays reserved for the
 * primary action, per the One Voice Rule, which is why the tool icons are ink
 * rather than a per-tool palette.
 *
 * A returning coach wants the analysis lab, so the lab is the single dominant
 * entry and everything else is quiet beneath it. Each tool carries a short
 * explanation plus a collapsed "How it works" walkthrough — native <details>,
 * so the page stays clean by default, needs no client-side JS, and remains
 * keyboard-operable. Every step describes behaviour the app actually has.
 *
 * Deliberately NOT here: competitor comparisons, plan pitches and testimonials
 * all live on the landing page. A signed-in coach came to work, not to be sold
 * to.
 */

const shell: CSSProperties = {
  width: '100%',
  maxWidth: 1120,
  margin: '0 auto',
  padding: '28px 16px calc(100px + env(safe-area-inset-bottom, 0px))',
  background: 'var(--cl-bg-primary)',
  color: 'var(--cl-text-primary)',
};

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 18,
  borderRadius: 16,
  background: 'var(--cl-bg-panel)',
  border: '1px solid var(--cl-border)',
  color: 'var(--cl-text-primary)',
  textDecoration: 'none',
};

const groupLabel: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--cl-text-secondary)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
  gap: 12,
  marginBottom: 30,
};

type Tool = {
  href: string;
  name: string;
  Icon: React.ElementType;
  what: string;
  /** Short, truthful walkthrough. Omitted for settings screens, which need none. */
  steps?: string[];
};

const PLAYER_TOOLS: Tool[] = [
  {
    href: '/players',
    name: 'Player database',
    Icon: Users,
    what:
      'Every player you coach, each carrying two documents that grow all season — technical analysis and match analysis.',
    steps: [
      'Add a player and open their profile.',
      'Send analysis output — frames, composites, readings — into their technical document.',
      'Match tools write into their match-analysis document automatically.',
      'Share either document with the player or their parent when you want them to see it.',
    ],
  },
  {
    href: '/academy',
    name: 'AngleMotion Academy',
    Icon: GraduationCap,
    what:
      'A library of eBooks, guides and drill breakdowns on how to film, what to look for, and how to turn a reading into coaching.',
    steps: [
      'Open the library and pick a category — eBooks, guides, or drills and exercises.',
      'Read or download the PDF.',
      'Apply it on your next analysis: framing, camera angle, which phase actually explains the fault.',
    ],
  },
];

const MATCH_TOOLS: Tool[] = [
  {
    href: '/match-report',
    name: 'Manual match report',
    Icon: ClipboardList,
    what:
      'Follow a player through a live match and log it point by point, on your phone, courtside.',
    steps: [
      'Start a match and set who serves.',
      'Log each point: first or second serve, stroke, rally length, and the cause of any error.',
      'Tap undo if you mis-record a point — nothing is locked in.',
      'Finish to get the full statistical report, into the player’s match document or as a PDF.',
    ],
  },
  {
    href: '/decoder',
    name: 'AI match decoder',
    Icon: Sparkles,
    what:
      'Reads your SwingVision match screenshots and derives the statistics SwingVision itself does not surface.',
    steps: [
      'Export or screenshot the match summary from SwingVision.',
      'Upload the images here.',
      'The decoder reads them and works out ratios and patterns behind the raw numbers.',
      'Review the output, then send it to the player’s match document.',
    ],
  },
];

const BUSINESS_TOOLS: Tool[] = [
  {
    href: '/profile',
    name: 'Coach profile',
    Icon: UserCircle,
    what: 'Your services, rates and payment links — the public-facing coaching identity behind your player work.',
  },
  {
    href: '/catalog',
    name: 'Public catalog',
    Icon: Globe,
    what: 'Optional listing in the AngleMotion coaches directory, with your socials, website and review links.',
  },
  {
    href: '/pricing',
    name: 'Plans',
    Icon: CreditCard,
    what: 'Light, Pro and Academy. Yearly billing runs two months cheaper than monthly.',
  },
  {
    href: '/billing',
    name: 'Account & billing',
    Icon: Settings,
    what: 'Your subscription, invoices and payment method, handled through Stripe.',
  },
];

function ToolCard({ tool }: { tool: Tool }) {
  const { href, name, Icon, what, steps } = tool;
  return (
    <div style={card}>
      <Link href={href} className="cp-tool-link" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
        <Icon size={18} strokeWidth={2} aria-hidden="true" style={{ flex: 'none', color: 'var(--cl-text-primary)' }} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{name}</span>
      </Link>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>{what}</p>
      {steps ? <Walkthrough steps={steps} /> : null}
    </div>
  );
}

/** Collapsed by default: the dashboard reads clean, the explanation is one tap away. */
function Walkthrough({ steps }: { steps: string[] }) {
  return (
    <details className="cp-details">
      <summary className="cp-summary">How it works</summary>
      <ol className="cp-steps">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </details>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={groupLabel}>{label}</h2>
      <div style={grid}>{children}</div>
    </section>
  );
}

export default function ControlPanelHome() {
  return (
    <div style={shell}>
      <style>{CSS}</style>

      <header style={{ marginBottom: 26 }}>
        <img
          src="/logo-rect-new.jpg"
          alt=""
          style={{ height: 40, width: 'auto', marginBottom: 10, borderRadius: 8 }}
        />
        <h1 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
          Control Panel
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--cl-text-secondary)', maxWidth: 640 }}>
          Your coaching workspace. Analyse video, keep every player’s file, log matches, and publish
          the result — each tool below explains itself if you have not used it yet.
        </p>
      </header>

      {/* ── Primary entry: the analysis lab ─────────────────────────────── */}
      <Link href="/analysis" className="cp-primary" style={{ ...card, gap: 10, padding: 22, marginBottom: 30, border: '1px solid var(--cl-accent)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, borderRadius: 10, flex: 'none',
              background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)',
            }}
          >
            <Video size={22} strokeWidth={2.25} />
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Video analysis</span>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--cl-accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Start here
            </span>
          </span>
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--cl-text-secondary)' }}>
          Draw, measure 13+ joint angles, run the AI skeleton and correct it by hand, compare
          side-by-side, step frame by frame, build Motion Layer composites, and record your screen
          with webcam and mic.
        </span>
      </Link>

      <details className="cp-details cp-details-primary">
        <summary className="cp-summary">How a full analysis works, start to finish</summary>
        <ol className="cp-steps">
          <li>Bring a video in — upload a file, or import from a YouTube link.</li>
          <li>Step frame by frame to the moment that matters and snapshot it as a phase.</li>
          <li>Run the AI skeleton and Detect Angles, then drag any point the AI got wrong. Your correction wins.</li>
          <li>Build a Motion Layer composite from the frames you choose, as a still or a video.</li>
          <li>Record the explanation with your screen, webcam and mic while you talk it through.</li>
          <li>Publish to YouTube as unlisted and drop everything into the player’s document.</li>
        </ol>
      </details>

      <Group label="Players &amp; learning">
        {PLAYER_TOOLS.map((t) => <ToolCard key={t.href} tool={t} />)}
      </Group>

      <Group label="Match intelligence">
        {MATCH_TOOLS.map((t) => <ToolCard key={t.href} tool={t} />)}
      </Group>

      <Group label="Your business">
        {BUSINESS_TOOLS.map((t) => <ToolCard key={t.href} tool={t} />)}
      </Group>
    </div>
  );
}

const CSS = `
.cp-primary,
.cp-tool-link { transition: color .18s cubic-bezier(.16,1,.3,1); }
.cp-primary { box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,122,255,.10); }
.cp-primary:hover { box-shadow: 0 2px 4px rgba(0,0,0,.05), 0 12px 30px rgba(0,122,255,.16); }
.cp-tool-link:hover span { color: var(--cl-accent); }

.cp-details { margin-top: 4px; }
.cp-details-primary { margin: -18px 0 30px; }
.cp-summary {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 44px; cursor: pointer; list-style: none;
  font-size: 13px; font-weight: 600; color: var(--cl-accent);
}
.cp-summary::-webkit-details-marker { display: none; }
.cp-summary::after {
  content: ''; width: 6px; height: 6px; flex: none;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translate(-1px, -1px);
  transition: transform .2s cubic-bezier(.16,1,.3,1);
}
.cp-details[open] .cp-summary::after { transform: rotate(-135deg) translate(-2px, -2px); }
.cp-summary:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 3px; border-radius: 8px; }

.cp-steps {
  margin: 2px 0 8px; padding: 0 0 0 20px;
  display: grid; gap: 7px;
  font-size: 13px; line-height: 1.5; color: var(--cl-text-secondary);
}
.cp-steps li::marker { color: var(--cl-text-muted); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .cp-primary, .cp-tool-link, .cp-summary::after { transition: none; }
}
`;
