import type { CuratedCoachProfile } from './types';

/**
 * Vin Baccelli's public coach profile — real content, supplied by Vin.
 *
 * CONTENT RULES THIS FILE IS HELD TO
 *  - Every price, Stripe link, testimonial and review here is REAL and was
 *    supplied by Vin or carried verbatim from components/LandingPage.tsx.
 *    Nothing is invented, completed, or rounded. If a fact is missing it is
 *    left out or set to `null`, never filled with a plausible stand-in.
 *  - The seven platform reviews in the review grid are reviews of VIN'S
 *    COACHING. On this page that is exactly what they describe, so they need no
 *    disclaimer of the kind the landing page carries — but they may still never
 *    be presented as reviews of the AngleMotion product.
 *  - TWO Trustpilot profiles exist and are never conflated: this page links only
 *    to the COACHING profile (it.trustpilot.com/review/vinbaccelli.com), which
 *    is where these quotes live. The app's own profile has no reviews and does
 *    not appear here. See components/LandingPage.tsx for the full provenance
 *    note, verified in a browser on 2026-09-04.
 *  - Section order is Vin's and is deliberate: he sells before he explains, and
 *    proof lands last. Do not reorder without asking him.
 */

const WHATSAPP = 'https://api.whatsapp.com/message/CIFH5W444GPEO1?autoload=1&app_absent=0';

/** The founder's COACHING Trustpilot profile — the one these quotes come from. */
const TRUSTPILOT_COACH_URL = 'https://it.trustpilot.com/review/vinbaccelli.com';

/**
 * Google reviews link, supplied by Vin for this purpose. It is a Google
 * share/redirect URL; automated fetching is blocked by robots.txt, so its
 * destination was not machine-verified — it is used as given because Vin
 * confirmed it resolves for a real visitor in a browser.
 */
const GOOGLE_REVIEWS_URL = 'https://share.google/XLnbpPQXA0VpKRUFt';

export const vinbaccelli: CuratedCoachProfile = {
  slug: 'vinbaccelli',
  name: 'Vin Baccelli',
  role: 'Tennis Coach',
  accentColor: '#007AFF',

  /** Direct contact. Same WhatsApp as the social icon, given its own CTA. */
  contact: { label: 'Message Me', url: WHATSAPP },

  /**
   * Vin's real bio copy, supplied verbatim. Four lines, this order, reproduced
   * exactly — including the flag and chart emoji and the `|` separators. Do not
   * reword, retitle, or "clean up" these strings.
   *
   * These are DEFAULTS. If Vin saves bio lines through CoachProfileEditor, those
   * take precedence at render time and these are never shown.
   */
  bioLines: [
    '🇮🇹 PTR Coach (Milan) | Former NCAA 🇺🇸',
    'Technique Fundamentals & Style Variations',
    'Technique Specialist & Video Analyst',
    'Sharing knowledge to elevate your game 📈',
  ],

  socials: [
    { id: 'whatsapp', label: 'WhatsApp', url: WHATSAPP, icon: 'whatsapp' },
    { id: 'instagram', label: 'Instagram', url: 'https://instagram.com/vinbaccelli', icon: 'instagram' },
    { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@Vinbaccelli', icon: 'youtube' },
    { id: 'x', label: 'X', url: 'https://x.com/VinBaccelli', icon: 'x' },
    { id: 'tiktok', label: 'TikTok', url: 'https://tiktok.com/@vinbaccelli', icon: 'tiktok' },
    { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/vinbaccelli/', icon: 'linkedin' },
  ],

  /**
   * The seven menu buttons, in Vin's order. Each `targetId` is a block `id`
   * further down this same file, so every button is an in-page anchor.
   * Labels are verbatim, emoji included. There is deliberately NO button for
   * the testimonials or the review grid.
   */
  menu: [
    { id: 'm-video', label: 'Video Analysis', targetId: 'video-analysis' },
    { id: 'm-ebook', label: 'Ebook', targetId: 'ebook' },
    {
      id: 'm-coachlife',
      label: '🎁 Join Coach Life through my link and get eBook for free 👉',
      targetId: 'coach-life',
    },
    { id: 'm-online', label: 'Online Coaching', targetId: 'online-coaching' },
    { id: 'm-ncaa', label: 'NCAA Consulting', targetId: 'ncaa-consulting' },
    {
      id: 'm-bonus',
      label: 'Get €10 Bonus to use on my services or eBook',
      targetId: 'review-bonus',
    },
    { id: 'm-about', label: 'About Me', targetId: 'about' },
  ],

  blocks: [
    // ── 1. Video analysis ───────────────────────────────────────────────────
    {
      kind: 'tieredAnalysis',
      id: 'video-analysis',
      title: 'Video Analysis',
      description:
        'Send your footage and get it back broken down frame by frame. Pick the depth you want, then how many strokes you want covered.',
      tiers: [
        {
          id: 'quick-feedback',
          name: 'Quick Feedback',
          subtitle: 'Fundamentals Check',
          detail: '1–2 min video · stroke ×5',
          ctaLabel: 'Book Quick Feedback',
          options: [
            { strokes: 1, price: '€20', url: 'https://buy.stripe.com/eVq7sLdgB7ve3QYbEi7kc03' },
            { strokes: 2, price: '€36', url: 'https://buy.stripe.com/aFa3cv4K5eXGgDK8s67kc04' },
            { strokes: 3, price: '€52', url: 'https://buy.stripe.com/5kQeVd5O94j24V2eQu7kc05' },
            { strokes: 4, price: '€68', url: 'https://buy.stripe.com/eVq3cvb8t6ra87e5fU7kc06' },
            { strokes: 5, price: '€84', url: 'https://buy.stripe.com/3cI8wPekF8zi5Z6dMq7kc07' },
          ],
        },
        {
          id: 'in-depth',
          name: 'In-Depth Analysis',
          subtitle: 'Fundamentals + Variants',
          detail: 'Up to 10 min video',
          ctaLabel: 'Book In-Depth Analysis',
          options: [
            { strokes: 1, price: '€50', url: 'https://buy.stripe.com/aFaeVd0tP02MevCfUy7kc08' },
            { strokes: 2, price: '€90', url: 'https://buy.stripe.com/00w9AT2BX4j2gDKfUy7kc09' },
            { strokes: 3, price: '€130', url: 'https://buy.stripe.com/9B6aEXfoJ4j24V2gYC7kc0a' },
            { strokes: 4, price: '€170', url: 'https://buy.stripe.com/bJefZh3G102MgDKcIm7kc0b' },
            { strokes: 5, price: '€210', url: 'https://buy.stripe.com/bJeaEXa4p7ve9bigYC7kc0c' },
          ],
        },
        {
          id: 'complete',
          name: 'Complete Analysis & Action Plan',
          detail: 'Up to 25 min video',
          ctaLabel: 'Book Complete Analysis',
          options: [
            { strokes: 1, price: '€100', url: 'https://buy.stripe.com/cNi9AT4K5aHq87efUy7kc0d' },
            { strokes: 2, price: '€180', url: 'https://buy.stripe.com/9B63cv6Sd3eY73a9wa7kc0e' },
            { strokes: 3, price: '€260', url: 'https://buy.stripe.com/5kQaEX90l3eY0EM4bQ7kc0f' },
            { strokes: 4, price: '€340', url: 'https://buy.stripe.com/cNi9AT90lbLubjqgYC7kc0g' },
            { strokes: 5, price: '€420', url: 'https://buy.stripe.com/00w28r2BX5n6evC0ZE7kc0h' },
          ],
        },
        {
          id: 'elite',
          name: 'Elite Analysis & Live Consultation',
          detail: 'Up to 50 min video + 20–30 min live call',
          ctaLabel: 'Book Elite Analysis',
          flat: { price: '€500', url: 'https://buy.stripe.com/fZu7sLekF6radrydMq7kc0i' },
        },
      ],
      discovery: {
        text: 'I build these breakdowns in AngleMotion — my own analysis platform. You can open the same tool yourself.',
        linkLabel: 'See how it works',
        href: '/',
      },
    },

    // ── 2. Ebook ────────────────────────────────────────────────────────────
    {
      kind: 'offer',
      id: 'ebook',
      title: 'Spin Mechanics',
      description:
        'My ebook on how spin is actually produced — what creates it, what kills it, and how to build it into a stroke you can repeat.',
      ctaLabel: 'Get the ebook',
      ctaUrl: 'https://buy.stripe.com/14A00jgsN4j2cnu7o27kc02',
    },

    // ── 3. Coach Life subscription ──────────────────────────────────────────
    {
      kind: 'offer',
      id: 'coach-life',
      title: 'Coach Life subscription',
      description:
        'An ongoing coaching subscription — and the Spin Mechanics ebook comes with it, free.',
      ctaLabel: 'Join Coach Life',
      ctaUrl: 'https://coachlife.com/?ref=VBC',
      note: 'Includes the Spin Mechanics ebook (€30 value)',
    },

    // ── 4. Online coaching ──────────────────────────────────────────────────
    {
      kind: 'priceList',
      id: 'online-coaching',
      title: 'Online Coaching',
      description: 'One-to-one sessions over video call. We cover:',
      bullets: [
        'Technique analysis',
        'Match strategy',
        'Point construction',
        'Training planning',
        'Match and practice video review',
      ],
      options: [
        { id: 'oc-30', label: '30 minutes', price: '€60', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
        { id: 'oc-60', label: '1 hour', price: '€120', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
        { id: 'oc-3h', label: '3-hour pack', price: '€300', note: 'Save €60', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
      ],
    },

    // ── 5. NCAA consulting ──────────────────────────────────────────────────
    {
      kind: 'priceList',
      id: 'ncaa-consulting',
      title: 'NCAA Consulting',
      description:
        'Guidance on the US college route — from where you actually stand to how the recruiting process works.',
      options: [
        { id: 'ncaa-30', label: '30 minutes', price: '€60', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
        { id: 'ncaa-60', label: '1 hour', price: '€120', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
        { id: 'ncaa-3h', label: '3 hours', price: '€360', ctaLabel: 'Message me to book', ctaUrl: WHATSAPP },
      ],
    },

    // Mariela's testimonial sits here, beside NCAA, because it is a parent
    // speaking about exactly this service.
    {
      kind: 'testimonials',
      id: 'ncaa-testimonial',
      items: [
        {
          id: 'mariela',
          name: 'Mariela',
          role: 'Parent',
          quote: 'Vin guided my son from the very beginning.',
        },
      ],
    },

    // ── 6. €10 review bonus ─────────────────────────────────────────────────
    {
      kind: 'reviewBonus',
      id: 'review-bonus',
      title: 'Get €10 back',
      description:
        'Leave a 5-star review on Trustpilot and Google, send me a screenshot, and I will credit €10 toward any service.',
      steps: [
        'Leave a 5-star review on Trustpilot and on Google.',
        'Take a screenshot of both.',
        'Send them to me on WhatsApp and I will credit you €10.',
      ],
      actions: [
        { id: 'trustpilot', label: 'Review on Trustpilot', url: TRUSTPILOT_COACH_URL, icon: 'trustpilot' },
        { id: 'google', label: 'Review on Google', url: GOOGLE_REVIEWS_URL, icon: 'google' },
      ],
    },

    // ── 7. About ────────────────────────────────────────────────────────────
    {
      kind: 'about',
      id: 'about',
      title: 'About me',
      paragraphs: [
        'I have spent over a decade coaching tennis. I competed myself until 17, then earned a scholarship to Lindenwood University, where I played NCAA Division I.',
        'I am PTR-certified, and my coaching combines on-court work with frame-by-frame video analysis — the same method behind every breakdown on this page.',
        'I have worked with more than 1,000 clients.',
      ],
      credentials: ['PTR Certified', 'Former NCAA Scholarship Player', '1,000+ Clients Coached'],
    },

    // ── 8. Testimonials ─────────────────────────────────────────────────────
    {
      kind: 'testimonials',
      id: 'testimonials',
      title: 'What players say',
      items: [
        {
          id: 'marco',
          name: 'Marco P.',
          quote: 'Vin helped me rebuild my forehand from the ground up.',
        },
        {
          id: 'daniel',
          name: 'Daniel R.',
          quote: 'The match-strategy session was incredible.',
        },
        {
          id: 'alessia',
          name: 'Alessia M.',
          quote: 'Most coaches just give tips — Vin gives structure.',
        },
      ],
    },

    // ── 9. Platform reviews ────────────────────────────────────────────────
    // Carried verbatim from components/LandingPage.tsx (FOUNDER_REVIEWS).
    {
      kind: 'reviewGrid',
      id: 'reviews',
      title: 'Reviews',
      note: 'Public reviews of my coaching, on Trustpilot and Google.',
      columns: [
        {
          id: 'trustpilot',
          source: 'Trustpilot',
          profileUrl: TRUSTPILOT_COACH_URL,
          starNote: 'All 6 reviews are 5 stars',
          reviews: [
            {
              id: 'philipp',
              name: 'Philipp Irsara',
              where: 'IT',
              quote:
                'Thank you Vin, your feedback was so, so useful — very professional, technical, and precise… your analysis is worth far more than the price… none went into this level of detail.',
            },
            {
              id: 'angelica',
              name: 'Angelica Ayoub',
              where: 'US',
              quote:
                'Vin’s expertise in biomechanics is remarkable. His thorough analysis of my son’s forehand revealed insights at a depth I’ve never experienced.',
            },
            {
              id: 'robert',
              name: 'Robert',
              where: 'SE',
              quote:
                'Outstanding tennis video analysis — clear, detailed and highly professional. A clear, structured breakdown of his stroke mechanics.',
            },
            {
              id: 'luca',
              name: 'Luca',
              where: 'IT',
              quote: 'Great experience — great analysis, highly recommended.',
            },
          ],
        },
        {
          id: 'google',
          source: 'Google',
          profileUrl: GOOGLE_REVIEWS_URL,
          reviews: [
            {
              id: 'lalito',
              name: 'Lalito Ayob',
              quote:
                'Vin is truly an expert in biomechanics. He did an incredible job analyzing my son’s forehand, providing insights and analysis at a level I’ve never encountered before.',
            },
            {
              id: 'gerardo',
              name: 'Gerardo Serna',
              quote:
                'Vin gave me an amazing review about my swing… he saw areas of improvement my coach has never detected before… he really cares that I improve my game.',
            },
            {
              id: 'nathan',
              name: 'Nathan Matthews',
              quote:
                'I’ve recently come across Vin’s content and I’ve been really impressed so far. Communication has been great and he has taken the time to answer all my questions.',
            },
          ],
        },
      ],
    },
  ],
};
