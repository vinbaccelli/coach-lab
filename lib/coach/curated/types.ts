/**
 * Curated coach profile content — the data shape behind rich public profiles.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE DATABASE
 * `coach_profiles` / `coach_services` / `coach_links` (lib/supabase/schema.sql)
 * store a flat linktree: name, tagline, bio, and two ordered lists. That schema
 * has nowhere to put tiered stroke-count pricing, credential lists, client
 * testimonials, or a sourced review grid. A real coach's page needs all four,
 * so curated content lives here as typed data rather than being forced into
 * columns that do not exist.
 *
 * PHASE 2 — THE BLOCK BUILDER
 * `blocks` is an ORDERED array and every block carries a stable `id`. That is
 * the whole forward-compatibility bet: reordering a profile is reordering this
 * array, and persisting it later means storing these objects (a `sort_order`
 * column plus a JSON payload, or one row per block) without reshaping anything
 * a renderer reads. Adding a block kind is a new member of the `CoachBlock`
 * union plus a new case in the renderer's switch — no change to existing kinds.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT TOUCH
 * `ServiceItem`, `LinkItem`, `CoachProfileData` and `DbProfile` in
 * components/coach/CoachPublicProfile.tsx, and the request/response shapes in
 * app/api/coach-profile/route.ts. CoachProfileEditor.tsx declares its own local
 * copies of those interfaces and imports nothing from the public profile, so
 * curated content is purely additive: the editor and the API are untouched.
 */

export type SocialIcon =
  | 'whatsapp'
  | 'instagram'
  | 'youtube'
  | 'x'
  | 'tiktok'
  | 'linkedin';

export interface SocialLink {
  id: string;
  label: string;
  url: string;
  icon: SocialIcon;
}

/** One purchasable step inside a tier that is priced by how many strokes you send. */
export interface StrokeOption {
  strokes: number;
  price: string;
  url: string;
}

/**
 * A single analysis tier. Either it is priced per stroke count (`options`) or it
 * is a single flat price (`flat`). Exactly one of the two is set; the renderer
 * shows a stroke selector for the first and a plain price for the second.
 */
export interface AnalysisTier {
  id: string;
  name: string;
  /** The qualifier after the em dash, e.g. "Fundamentals Check". Optional. */
  subtitle?: string;
  /** What you send and what you get back, in one line. */
  detail: string;
  options?: StrokeOption[];
  flat?: { price: string; url: string };
  ctaLabel: string;
}

/** A quiet in-context link back into AngleMotion itself. */
export interface DiscoveryNote {
  text: string;
  linkLabel: string;
  href: string;
}

/**
 * One button in the top-of-page menu. `targetId` is the `id` of a block further
 * down the same page; the button is an anchor link that smooth-scrolls to it.
 */
export interface MenuItem {
  id: string;
  label: string;
  targetId: string;
}

export interface TieredAnalysisBlock {
  kind: 'tieredAnalysis';
  id: string;
  title: string;
  description?: string;
  tiers: AnalysisTier[];
  /** The contextual AngleMotion callout, rendered under the tiers. */
  discovery?: DiscoveryNote;
}

/** A single offer with one price and one call to action. */
export interface OfferBlock {
  kind: 'offer';
  id: string;
  title: string;
  description: string;
  price?: string;
  bullets?: string[];
  ctaLabel: string;
  ctaUrl: string;
  note?: string;
}

/** An offer with several priced options that all lead to the same kind of action. */
export interface PriceListBlock {
  kind: 'priceList';
  id: string;
  title: string;
  description?: string;
  bullets?: string[];
  options: Array<{
    id: string;
    label: string;
    price: string;
    note?: string;
    ctaLabel: string;
    ctaUrl: string;
  }>;
}

export interface ReviewBonusBlock {
  kind: 'reviewBonus';
  id: string;
  title: string;
  description: string;
  steps: string[];
  actions: Array<{
    id: string;
    label: string;
    /** `null` means the real URL is not on file yet; the button is not rendered. */
    url: string | null;
    icon: 'trustpilot' | 'google';
  }>;
}

export interface AboutBlock {
  kind: 'about';
  id: string;
  title: string;
  paragraphs: string[];
  credentials: string[];
}

export interface TestimonialsBlock {
  kind: 'testimonials';
  id: string;
  title?: string;
  items: Array<{ id: string; name: string; role?: string; quote: string }>;
}

/**
 * Sourced public reviews, grouped by platform.
 *
 * CONTENT RULE: every quote here is a real review of Vin's COACHING, carried
 * verbatim from components/LandingPage.tsx where its provenance is documented.
 * `starNote` may state a review record only for a profile that actually has
 * one, and only for the profile the quotes came from.
 */
export interface ReviewGridBlock {
  kind: 'reviewGrid';
  id: string;
  title: string;
  note?: string;
  columns: Array<{
    id: string;
    source: 'Trustpilot' | 'Google';
    profileUrl: string | null;
    starNote?: string;
    reviews: Array<{ id: string; name: string; where?: string; quote: string }>;
  }>;
}

export type CoachBlock =
  | TieredAnalysisBlock
  | OfferBlock
  | PriceListBlock
  | ReviewBonusBlock
  | AboutBlock
  | TestimonialsBlock
  | ReviewGridBlock;

export interface CuratedCoachProfile {
  slug: string;
  name: string;
  /**
   * The coach's role. Profile metadata — NOT rendered on this surface: the
   * first bio line already establishes it, so the heading carries the name
   * alone. Kept because it is real profile data a directory or card view would
   * want; delete it if nothing claims it.
   */
  role: string;
  /**
   * Primary contact call to action in the hero — the direct, prominent way to
   * reach this coach, distinct from the small social icon of the same service.
   */
  contact?: { label: string; url: string };
  /**
   * The bio, one short line per entry, rendered in order directly under the
   * name. Editable: a coach who saves bio lines through CoachProfileEditor
   * overrides these defaults (see `resolveBioLines` in CoachPublicProfile.tsx).
   */
  bioLines: string[];
  /**
   * Per-coach identity colour. Stays a hex literal, never a token: it is stored
   * user state, not a presentation value (DESIGN.md — The Presentation-Only Rule).
   */
  accentColor: string;
  /** Fallback only. A photo uploaded through the profile editor wins over this. */
  avatarUrl?: string;
  socials: SocialLink[];
  /**
   * The top-of-page button menu. Each entry anchors to a block below it on the
   * same page, so this is a table of contents, not navigation.
   */
  menu: MenuItem[];
  /** ORDERED. Phase 2 reorders this array; nothing else needs to change. */
  blocks: CoachBlock[];
}
