'use client';

/**
 * Public coach profile (`/coach/[slug]`).
 *
 * Mode: this is a public, revenue-facing page, but it is rendered in the APP's
 * own design system — "The Quiet Instrument" (DESIGN.md) — not the landing
 * page's louder marketing scale. Type runs on the app ramp (11 / 13 / 16 / 18
 * plus a restrained display step for the coach's name), radii stay at 8 / 10 /
 * 16, colour comes from `--cl-*` tokens, and every interactive target clears
 * 44px. It should read as a premium, quiet link-in-bio page, not a landing page.
 *
 * TWO RENDERING PATHS, AND WHY
 *
 *  1. CURATED (lib/coach/curated) — a slug in `CURATED_PROFILES` renders the
 *     rich block layout from typed content. Curated content WINS over the
 *     `coach_profiles` row for that slug.
 *
 *     Why it has to win: the database stores a flat linktree (name, tagline,
 *     bio, services, links). It has no columns for tiered stroke-count pricing,
 *     credential lists, testimonials or a sourced review grid, so this content
 *     cannot be expressed as a row. Confirmed against production on 2026-09-05:
 *     the `vinbaccelli` row exists but carries `tagline: "Tennis coach"` and a
 *     `bio` containing an entire pasted HTML document, and the `coach_services`
 *     / `coach_links` tables do not exist in that database at all — so the DB
 *     path renders a broken page for this slug today.
 *
 *     ONE EXCEPTION: `avatarUrl` still comes from the database when set, so the
 *     existing photo-upload flow in CoachProfileEditor.tsx (`handleAvatarUpload`
 *     → Supabase Storage `coach-avatars` → `PUT /api/coach-profile`) keeps
 *     working for curated coaches. Without this exception, uploading a photo
 *     would silently do nothing on this page.
 *
 *  2. DATABASE / STATIC (everything else) — unchanged behaviour for every other
 *     coach: the `dbProfile` row wins, falling back to the static `PROFILES` map
 *     and then to `FALLBACK`. `ServiceItem`, `LinkItem`, `CoachProfileData` and
 *     `DbProfile` are deliberately untouched, and CoachProfileEditor.tsx and
 *     app/api/coach-profile/route.ts are not modified by this file's existence.
 *
 * DISCOVERY: this page is also a way INTO AngleMotion, not only a way to book
 * this coach. Five route-level links carry that: the header wordmark, the header
 * "Coaches" link, and three in the footer. A sixth, contextual one sits directly
 * under the video-analysis tiers, where the product being described is the thing
 * that produced the deliverable.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { CoachRichText } from '@/lib/coach/richText';
import { getCuratedProfile } from '@/lib/coach/curated';
import { parseBioLines } from '@/lib/coach/bioLines';
import type {
  AnalysisTier,
  CoachBlock,
  CuratedCoachProfile,
  DiscoveryNote,
  MenuItem,
  SocialIcon,
  TieredAnalysisBlock,
} from '@/lib/coach/curated/types';
import {
  Instagram,
  Youtube,
  Linkedin,
  Globe,
  Mail,
  ExternalLink,
  Users,
  Star,
  Check,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  BadgeCheck,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Legacy database-driven shape. UNCHANGED — the editor and the API depend on
   these exact fields.
   ──────────────────────────────────────────────────────────────────────────── */

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  price: string;
  ctaLabel: string;
  ctaUrl: string;
}

interface LinkItem {
  id: string;
  label: string;
  url: string;
  icon?: 'instagram' | 'youtube' | 'globe' | 'mail' | 'external' | 'whatsapp' | 'trustpilot' | 'google';
}

interface CoachProfileData {
  slug: string;
  name: string;
  tagline: string;
  bio: string;
  avatarUrl?: string;
  accentColor: string;
  services: ServiceItem[];
  links: LinkItem[];
  socials: { instagram?: string; youtube?: string; website?: string; email?: string; whatsapp?: string; trustpilot?: string; googleReviews?: string };
}

const PROFILES: Record<string, CoachProfileData> = {};

const FALLBACK: CoachProfileData = {
  slug: '',
  name: 'Coach',
  tagline: 'Tennis Professional',
  bio: 'This coach has not set up their profile yet.',
  accentColor: '#007AFF',
  services: [],
  links: [],
  socials: {},
};

interface DbProfile {
  slug: string;
  name: string;
  tagline: string;
  bio: string;
  avatarUrl?: string;
  accentColor: string;
  services: ServiceItem[];
  links: LinkItem[];
}

/* ────────────────────────────────────────────────────────────────────────────
   Shared visual constants. Kept as named values so the page reads as one system
   rather than a thousand inline decisions.
   ──────────────────────────────────────────────────────────────────────────── */

const COLUMN = 600;
const CARD: React.CSSProperties = {
  background: 'var(--cl-bg-panel)',
  border: '1px solid var(--cl-border-subtle)',
  borderRadius: 16,
};
const HAIRLINE = '1px solid var(--cl-border-subtle)';

/** Browser surfaces the design system would otherwise leave to the browser. */
const PAGE_CSS = `
.cp-root { scrollbar-width: thin; scrollbar-color: var(--cl-border) transparent; scroll-behavior: smooth; }
.cp-root ::selection { background: var(--cl-accent-soft); color: var(--cl-text-primary); }
.cp-root a:focus-visible,
.cp-root button:focus-visible {
  outline: 2px solid var(--cl-accent);
  outline-offset: 2px;
  border-radius: var(--cl-radius-sm);
}
.cp-root .cp-num { font-variant-numeric: tabular-nums; }
.cp-root .cp-press { transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease; }
.cp-root .cp-press:active { transform: scale(0.985); }
@media (prefers-reduced-motion: reduce) {
  .cp-root { scroll-behavior: auto; }
  .cp-root .cp-press { transition: none; }
  .cp-root .cp-press:active { transform: none; }
}
`;

/* ────────────────────────────────────────────────────────────────────────────
   Icons. lucide 0.263 ships no brand icons at all, so the WhatsApp, X and
   TikTok marks are authored here on the same 24×24 box as the lucide set, so
   the social row reads as one family rather than a generic stand-in beside
   real logos.
   ──────────────────────────────────────────────────────────────────────────── */

function XMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.53 3h3.06l-6.69 7.64L21.75 21h-6.16l-4.83-6.3L5.24 21H2.18l7.15-8.17L2.25 3h6.32l4.36 5.77L17.53 3Zm-1.07 16.2h1.7L7.62 4.71H5.8L16.46 19.2Z" />
    </svg>
  );
}

/**
 * WhatsApp's brand glyph. lucide 0.263 ships no brand icons and no icon library
 * in this project has one, so the path is inlined here on the same 24×24 box as
 * the other marks. Path from Simple Icons (the icon set is CC0); the WhatsApp
 * name and mark remain trademarks of their owner and are used here only to
 * label a link to Vin's own WhatsApp account.
 */
function WhatsAppMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

function TikTokMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .77-5.06V9.7a5.67 5.67 0 1 0 4.91 5.61V9.01a7.35 7.35 0 0 0 4.29 1.38V7.3a4.29 4.29 0 0 1-3.23-1.48Z" />
    </svg>
  );
}

function SocialGlyph({ icon }: { icon: SocialIcon }) {
  if (icon === 'instagram') return <Instagram size={18} />;
  if (icon === 'youtube') return <Youtube size={18} />;
  if (icon === 'linkedin') return <Linkedin size={18} />;
  if (icon === 'whatsapp') return <WhatsAppMark />;
  if (icon === 'x') return <XMark />;
  return <TikTokMark />;
}

function LinkIcon({ type }: { type?: string }) {
  const size = 18;
  if (type === 'instagram') return <Instagram size={size} />;
  if (type === 'youtube') return <Youtube size={size} />;
  if (type === 'globe') return <Globe size={size} />;
  if (type === 'mail') return <Mail size={size} />;
  if (type === 'whatsapp') return <WhatsAppMark size={size} />;
  if (type === 'trustpilot' || type === 'google') return <Star size={size} />;
  return <ExternalLink size={size} />;
}

/* ────────────────────────────────────────────────────────────────────────────
   Primitives
   ──────────────────────────────────────────────────────────────────────────── */

/** The product-level commit button: dark fill, per DESIGN.md's Two Primaries Rule. */
function CommitButton({
  href,
  children,
  external = true,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      className="cp-press"
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44,
        padding: '10px 16px',
        borderRadius: 10,
        background: 'var(--cl-action-primary)',
        color: 'var(--cl-text-on-fill)',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        width: '100%',
      }}
    >
      {children}
    </a>
  );
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="cp-press"
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'var(--cl-bg-panel)',
        border: HAIRLINE,
        color: 'var(--cl-text-primary)',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        flex: 1,
      }}
    >
      {children}
    </a>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--cl-text-primary)' }}>
        {title}
      </h2>
      {description && (
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}>
          {description}
        </p>
      )}
    </div>
  );
}

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  // More space above a heading than below it. `scrollMarginTop` keeps the
  // sticky nav from covering a heading when a menu button anchors to it.
  return (
    <section id={id} style={{ marginTop: 44, scrollMarginTop: 76 }}>
      {children}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Video analysis — the one genuinely hard block.

   Four tiers × five stroke counts is twenty-one real Stripe links. Rendering
   them as twenty-one buttons is the honest-but-unusable option; hiding them
   behind a dropdown buries the price. Instead each tier carries a segmented
   stroke selector that resolves to exactly one price and one link, so the
   visitor makes two small choices instead of scanning a matrix. Every link is
   present in the data and reachable — nothing is summarised away.
   ──────────────────────────────────────────────────────────────────────────── */

function StrokeSelector({
  tierId,
  options,
  selected,
  onSelect,
}: {
  tierId: string;
  options: NonNullable<AnalysisTier['options']>;
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div>
      <div
        id={`${tierId}-strokes-label`}
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--cl-text-secondary)', marginBottom: 6 }}
      >
        Strokes
      </div>
      <div
        role="group"
        aria-labelledby={`${tierId}-strokes-label`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${options.length}, 1fr)`,
          gap: 4,
          padding: 4,
          background: 'var(--cl-bg-secondary)',
          borderRadius: 10,
        }}
      >
        {options.map((opt, i) => {
          const active = i === selected;
          return (
            <button
              key={opt.strokes}
              type="button"
              className="cp-press cp-num"
              aria-pressed={active}
              aria-label={`${opt.strokes} ${opt.strokes === 1 ? 'stroke' : 'strokes'}, ${opt.price}`}
              onClick={() => onSelect(i)}
              style={{
                minHeight: 44,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 700 : 600,
                fontFamily: 'inherit',
                background: active ? 'var(--cl-bg-panel)' : 'transparent',
                color: active ? 'var(--cl-text-primary)' : 'var(--cl-text-secondary)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
              }}
            >
              {opt.strokes}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisTierCard({ tier }: { tier: AnalysisTier }) {
  const [selected, setSelected] = useState(0);
  const active = tier.options ? tier.options[selected] : null;
  const price = active ? active.price : tier.flat?.price ?? '';
  const url = active ? active.url : tier.flat?.url ?? '#';

  return (
    <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{tier.name}</h3>
        {tier.subtitle && (
          <div style={{ marginTop: 2, fontSize: 13, color: 'var(--cl-text-secondary)' }}>{tier.subtitle}</div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--cl-text-secondary)' }}>{tier.detail}</div>
      </div>

      {tier.options && (
        <StrokeSelector tierId={tier.id} options={tier.options} selected={selected} onSelect={setSelected} />
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span className="cp-num" style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {price}
        </span>
        {tier.options && (
          <span style={{ fontSize: 11, color: 'var(--cl-text-secondary)' }}>
            {tier.options[selected].strokes} {tier.options[selected].strokes === 1 ? 'stroke' : 'strokes'}
          </span>
        )}
      </div>

      <CommitButton href={url}>{tier.ctaLabel}</CommitButton>
    </div>
  );
}

/**
 * The contextual AngleMotion callout. Deliberately not a card and not a banner:
 * a card would read as another offer, a banner as an ad. It is one quiet line
 * where the visitor has just finished reading what they would receive.
 */
function DiscoveryCallout({ note }: { note: DiscoveryNote }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: HAIRLINE }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--cl-text-secondary)' }}>
        {note.text}{' '}
        <Link
          href={note.href}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: 'var(--cl-accent)',
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            verticalAlign: 'bottom',
            textUnderlineOffset: 3,
          }}
        >
          {note.linkLabel}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}

function TieredAnalysisSection({ block }: { block: TieredAnalysisBlock }) {
  return (
    <Section id={block.id}>
      <SectionHeading title={block.title} description={block.description} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {block.tiers.map(tier => (
          <AnalysisTierCard key={tier.id} tier={tier} />
        ))}
      </div>
      {block.discovery && <DiscoveryCallout note={block.discovery} />}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Remaining block renderers
   ──────────────────────────────────────────────────────────────────────────── */

function BlockRenderer({ block }: { block: CoachBlock }) {
  switch (block.kind) {
    case 'tieredAnalysis':
      return <TieredAnalysisSection block={block} />;

    case 'offer':
      return (
        <Section id={block.id}>
          <SectionHeading title={block.title} />
          <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--cl-text-secondary)' }}>
              {block.description}
            </p>
            {block.bullets && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {block.bullets.map(b => (
                  <li key={b} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--cl-text-primary)' }}>
                    <Check size={15} style={{ color: 'var(--cl-accent)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            {block.price && (
              <span className="cp-num" style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {block.price}
              </span>
            )}
            <CommitButton href={block.ctaUrl}>{block.ctaLabel}</CommitButton>
            {block.note && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--cl-text-secondary)', textAlign: 'center' }}>{block.note}</p>
            )}
          </div>
        </Section>
      );

    case 'priceList': {
      // Every option leading to the same destination gets one shared action
      // rather than three identical buttons.
      const urls = new Set(block.options.map(o => o.ctaUrl));
      const shared = urls.size === 1 ? block.options[0] : null;

      return (
        <Section id={block.id}>
          <SectionHeading title={block.title} description={block.description} />
          <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {block.bullets && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {block.bullets.map(b => (
                  <li key={b} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--cl-text-primary)' }}>
                    <Check size={15} style={{ color: 'var(--cl-accent)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            )}

            <div>
              {block.options.map((opt, i) => {
                const row = (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {/* Ink rather than accent: System Blue at 11px is ~4.0:1 on white. */}
                      {opt.note && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cl-text-primary)' }}>{opt.note}</span>
                      )}
                      <span className="cp-num" style={{ fontSize: 16, fontWeight: 700 }}>
                        {opt.price}
                      </span>
                    </span>
                  </>
                );

                const rowStyle: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  minHeight: 44,
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : HAIRLINE,
                  color: 'var(--cl-text-primary)',
                  textDecoration: 'none',
                };

                return shared ? (
                  <div key={opt.id} style={rowStyle}>
                    {row}
                  </div>
                ) : (
                  <a
                    key={opt.id}
                    className="cp-press"
                    href={opt.ctaUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${opt.ctaLabel} — ${opt.label}, ${opt.price}`}
                    style={rowStyle}
                  >
                    {row}
                    <ChevronRight size={16} style={{ color: 'var(--cl-text-secondary)' }} aria-hidden="true" />
                  </a>
                );
              })}
            </div>

            {shared && <CommitButton href={shared.ctaUrl}>{shared.ctaLabel}</CommitButton>}
          </div>
        </Section>
      );
    }

    case 'reviewBonus': {
      const actions = block.actions.filter(a => a.url);
      return (
        <Section id={block.id}>
          <SectionHeading title={block.title} />
          <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--cl-text-secondary)' }}>
              {block.description}
            </p>

            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {block.steps.map((step, i) => (
                <li key={step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span
                    className="cp-num"
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      background: 'var(--cl-accent-soft)',
                      // Ink, not accent: System Blue on the soft accent wash is
                      // ~3.5:1, under the 4.5:1 floor at this size.
                      color: 'var(--cl-text-primary)',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.55 }}>{step}</span>
                </li>
              ))}
            </ol>

            {actions.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {actions.map(a => (
                  <SecondaryButton key={a.id} href={a.url as string}>
                    <Star size={14} style={{ color: 'var(--cl-accent)' }} aria-hidden="true" />
                    {a.label}
                  </SecondaryButton>
                ))}
              </div>
            )}
          </div>
        </Section>
      );
    }

    case 'about':
      return (
        <Section id={block.id}>
          <SectionHeading title={block.title} />
          <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {block.paragraphs.map(p => (
                <p key={p} style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--cl-text-primary)' }}>
                  {p}
                </p>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {block.credentials.map(c => (
                <span
                  key={c}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: 'var(--cl-bg-secondary)',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--cl-text-secondary)',
                  }}
                >
                  <BadgeCheck size={13} style={{ color: 'var(--cl-accent)' }} aria-hidden="true" />
                  {c}
                </span>
              ))}
            </div>
          </div>
        </Section>
      );

    case 'testimonials':
      return (
        <Section id={block.id}>
          {block.title && <SectionHeading title={block.title} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {block.items.map(t => (
              <figure key={t.id} style={{ ...CARD, margin: 0, padding: 18 }}>
                <blockquote style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--cl-text-primary)' }}>
                  “{t.quote}”
                </blockquote>
                <figcaption style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--cl-text-secondary)' }}>
                  {t.name}
                  {t.role ? ` · ${t.role}` : ''}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      );

    case 'reviewGrid':
      return (
        <Section id={block.id}>
          <SectionHeading title={block.title} description={block.note} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 10,
              alignItems: 'start',
            }}
          >
            {block.columns.map(col => (
              <div key={col.id} style={{ ...CARD, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{col.source}</span>
                  {col.starNote && (
                    <span style={{ fontSize: 11, color: 'var(--cl-text-secondary)' }}>{col.starNote}</span>
                  )}
                </div>

                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
                  {col.reviews.map((r, i) => (
                    <div key={r.id} style={{ paddingTop: i === 0 ? 0 : 12, marginTop: i === 0 ? 0 : 12, borderTop: i === 0 ? 'none' : HAIRLINE }}>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--cl-text-primary)' }}>
                        “{r.quote}”
                      </p>
                      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--cl-text-secondary)' }}>
                        {r.name}
                        {r.where ? ` · ${r.where}` : ''}
                      </div>
                    </div>
                  ))}
                </div>

                {col.profileUrl && (
                  <a
                    href={col.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      marginTop: 14,
                      minHeight: 44,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--cl-accent)',
                      textDecoration: 'none',
                    }}
                  >
                    Read on {col.source} <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>
      );

    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Chrome shared by both rendering paths
   ──────────────────────────────────────────────────────────────────────────── */

function NavBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 20px',
        borderBottom: HAIRLINE,
        // Sanctioned here: a marketing-facing surface with no video beneath it.
        background: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {/* Discovery link 1 of 6 — the wordmark home. */}
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 44,
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'var(--cl-text-primary)',
          textDecoration: 'none',
        }}
      >
        Angle<span style={{ color: 'var(--cl-accent)' }}>Motion</span>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Discovery link 2 of 6 — the coach directory. */}
        <Link
          className="cp-press"
          href="/coaches"
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 10,
            border: HAIRLINE,
            background: 'var(--cl-bg-panel)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--cl-text-primary)',
            textDecoration: 'none',
          }}
        >
          Coaches
        </Link>
        <Link
          className="cp-press"
          href="/analysis"
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 10,
            background: 'var(--cl-action-primary)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--cl-text-on-fill)',
            textDecoration: 'none',
          }}
        >
          Try free
        </Link>
      </div>
    </div>
  );
}

/**
 * Discovery footer. This page is a way IN, not only a way to book this coach:
 * visitors can reach the full directory, and players or parents who are not
 * looking for a coach can reach the product itself rather than dead-ending here.
 */
function DiscoveryFooter() {
  return (
    <>
      <div
        style={{
          marginTop: 44,
          paddingTop: 24,
          borderTop: HAIRLINE,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Discovery links 4 and 5 of 6. */}
        <Link
          className="cp-press"
          href="/coaches"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 44,
            padding: '10px 16px',
            borderRadius: 10,
            border: HAIRLINE,
            background: 'var(--cl-bg-panel)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--cl-text-primary)',
            textDecoration: 'none',
          }}
        >
          <Users size={15} aria-hidden="true" /> Browse other coaches
        </Link>
        <Link
          className="cp-press"
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 44,
            padding: '10px 16px',
            borderRadius: 10,
            border: HAIRLINE,
            background: 'transparent',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--cl-text-secondary)',
            textDecoration: 'none',
          }}
        >
          What is AngleMotion?
        </Link>
      </div>

      {/* Discovery link 6 of 6. */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            padding: '0 12px',
            fontSize: 11,
            color: 'var(--cl-text-secondary)',
            textDecoration: 'none',
          }}
        >
          Powered by AngleMotion
        </Link>
      </div>
    </>
  );
}

function Avatar({
  name,
  avatarUrl,
  accentColor,
  size = 88,
}: {
  name: string;
  avatarUrl?: string;
  accentColor: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        margin: '0 auto 16px',
        overflow: 'hidden',
        background: 'var(--cl-accent-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 800,
        // Per-coach identity colour is stored user state, so it stays a literal.
        color: accentColor,
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        name.charAt(0)
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Curated rendering path
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The top-of-page button menu. Every entry is an in-page anchor to a section
 * further down, so this is a table of contents rather than navigation — which
 * is why it uses plain `<a href="#id">` and not next/link: the browser's own
 * anchor scrolling, smoothed by `scroll-behavior` on the scroll container, is
 * what makes it work without any JavaScript.
 */
function MenuButtons({ items, label }: { items: MenuItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => (
        <a
          key={item.id}
          className="cp-press"
          href={`#${item.targetId}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 44,
            padding: '11px 14px',
            borderRadius: 10,
            border: HAIRLINE,
            background: 'var(--cl-bg-panel)',
            color: 'var(--cl-text-primary)',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {/* Balances the chevron so the label stays optically centred. */}
          <span aria-hidden="true" style={{ width: 16, flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>{item.label}</span>
          <ChevronDown size={16} style={{ color: 'var(--cl-text-secondary)', flexShrink: 0 }} aria-hidden="true" />
        </a>
      ))}
    </nav>
  );
}

function CuratedProfile({
  profile,
  avatarUrl,
  bioLines,
}: {
  profile: CuratedCoachProfile;
  avatarUrl?: string;
  bioLines: string[];
}) {
  return (
    <div style={{ maxWidth: COLUMN, margin: '0 auto', padding: '32px 20px 72px' }}>
      {/* ── Hero: photo → name → bio → socials → menu ── */}
      <header style={{ textAlign: 'center' }}>
        <Avatar name={profile.name} avatarUrl={avatarUrl} accentColor={profile.accentColor} size={176} />

        <h1 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 800, letterSpacing: '-0.025em' }}>
          {profile.name}
        </h1>

        {/* Bio — one line per entry, in the coach's own order and wording. */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {bioLines.map((line, i) => (
            <p
              key={`${i}-${line}`}
              style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--cl-text-secondary)' }}
            >
              {line}
            </p>
          ))}
        </div>

        {/* Socials, directly after the bio. */}
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {profile.socials.map(s => (
            <a
              key={s.id}
              className="cp-press"
              href={s.url}
              target="_blank"
              rel="noreferrer"
              aria-label={s.label}
              title={s.label}
              style={{
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                border: HAIRLINE,
                background: 'var(--cl-bg-panel)',
                color: 'var(--cl-text-primary)',
              }}
            >
              <SocialGlyph icon={s.icon} />
            </a>
          ))}
        </div>

        {/* Direct contact. Deliberately the page's one dark button above the
            fold: the social row is a list of places to find him, this is the
            way to reach him. Its dark fill also keeps it distinct from the
            white menu buttons directly beneath it. */}
        {profile.contact && (
          <div style={{ marginTop: 14 }}>
            <CommitButton href={profile.contact.url}>
              <WhatsAppMark size={16} />
              {profile.contact.label}
            </CommitButton>
          </div>
        )}

        <MenuButtons items={profile.menu} label={`${profile.name} — jump to a section`} />
      </header>

      {/* ── Blocks, in the coach's own order ── */}
      {profile.blocks.map(block => (
        <BlockRenderer key={block.id} block={block} />
      ))}

      <DiscoveryFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Database / static rendering path — behaviour unchanged, restyled into the
   same light world so the two paths are one surface.
   ──────────────────────────────────────────────────────────────────────────── */

function GenericProfile({ profile }: { profile: CoachProfileData }) {
  const { accentColor } = profile;

  return (
    <div style={{ maxWidth: COLUMN, margin: '0 auto', padding: '32px 20px 72px' }}>
      <header style={{ textAlign: 'center', marginBottom: 32 }}>
        <Avatar name={profile.name} avatarUrl={profile.avatarUrl} accentColor={accentColor} />
        <h1 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 800, letterSpacing: '-0.025em' }}>
          {profile.name}
        </h1>
        <p style={{ margin: '4px 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--cl-text-secondary)' }}>
          {profile.tagline}
        </p>
        {/* Safe formatted bio — paragraphs, line breaks, bold/italic, lists and
            http(s) links, rendered as React elements. No innerHTML, so nothing a
            coach types can become markup. See lib/coach/richText.tsx. */}
        <CoachRichText
          text={profile.bio}
          style={{
            margin: '0 auto',
            fontSize: 13,
            lineHeight: 1.65,
            color: 'var(--cl-text-secondary)',
            maxWidth: 460,
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {profile.socials.instagram && (
            <a className="cp-press" href={profile.socials.instagram} target="_blank" rel="noreferrer" aria-label="Instagram"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: HAIRLINE, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' }}>
              <Instagram size={18} />
            </a>
          )}
          {profile.socials.youtube && (
            <a className="cp-press" href={profile.socials.youtube} target="_blank" rel="noreferrer" aria-label="YouTube"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: HAIRLINE, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' }}>
              <Youtube size={18} />
            </a>
          )}
          {profile.socials.website && (
            <a className="cp-press" href={profile.socials.website} target="_blank" rel="noreferrer" aria-label="Website"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: HAIRLINE, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' }}>
              <Globe size={18} />
            </a>
          )}
          {profile.socials.email && (
            <a className="cp-press" href={`mailto:${profile.socials.email}`} aria-label="Email"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: HAIRLINE, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)' }}>
              <Mail size={18} />
            </a>
          )}
        </div>
      </header>

      {profile.services.length > 0 && (
        <Section>
          <SectionHeading title="Services" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profile.services.map(svc => (
              <div key={svc.id} style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{svc.title}</span>
                  <span className="cp-num" style={{ fontSize: 16, fontWeight: 700, flexShrink: 0 }}>{svc.price}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--cl-text-secondary)' }}>{svc.description}</p>
                <CommitButton href={svc.ctaUrl}>{svc.ctaLabel}</CommitButton>
              </div>
            ))}
          </div>
        </Section>
      )}

      {profile.links.length > 0 && (
        <Section>
          <SectionHeading title="Links" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {profile.links.map(link => (
              <a
                key={link.id}
                className="cp-press"
                href={link.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 44,
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'var(--cl-bg-panel)',
                  border: HAIRLINE,
                  color: 'var(--cl-text-primary)',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--cl-accent)', display: 'flex', flexShrink: 0 }}>
                  <LinkIcon type={link.icon} />
                </span>
                {link.label}
                <ExternalLink size={13} style={{ marginLeft: 'auto', color: 'var(--cl-text-secondary)' }} aria-hidden="true" />
              </a>
            ))}
          </div>
        </Section>
      )}

      <DiscoveryFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Entry point
   ──────────────────────────────────────────────────────────────────────────── */

export default function CoachPublicProfile({ slug, dbProfile }: { slug: string; dbProfile?: DbProfile | null }) {
  const curated = getCuratedProfile(slug);

  const generic: CoachProfileData | null = curated
    ? null
    : dbProfile
      ? {
          ...dbProfile,
          socials: {
            instagram: dbProfile.links.find(l => l.icon === 'instagram')?.url,
            youtube: dbProfile.links.find(l => l.icon === 'youtube')?.url,
            website: dbProfile.links.find(l => l.icon === 'globe')?.url,
            email: dbProfile.links.find(l => l.icon === 'mail')?.url?.replace('mailto:', ''),
          },
        }
      : PROFILES[slug] ?? { ...FALLBACK, slug };

  return (
    <div
      className="cp-root"
      style={{
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background: 'var(--cl-bg-primary)',
        color: 'var(--cl-text-primary)',
        fontFamily: 'var(--cl-font)',
      }}
    >
      <style>{PAGE_CSS}</style>
      <NavBar />
      {curated ? (
        // Two things still come from the database even on a curated profile, so
        // the coach can actually edit them: the uploaded photo, and the bio
        // lines saved through CoachProfileEditor. Saved bio lines win; the
        // curated defaults are the fallback until the coach edits them.
        <CuratedProfile
          profile={curated}
          avatarUrl={dbProfile?.avatarUrl ?? curated.avatarUrl}
          bioLines={parseBioLines(dbProfile?.bio) ?? curated.bioLines}
        />
      ) : (
        <GenericProfile profile={generic as CoachProfileData} />
      )}
    </div>
  );
}
