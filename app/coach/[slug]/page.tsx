import CoachPublicProfile from '@/components/coach/CoachPublicProfile';
import type { Metadata } from 'next';
import JsonLd from '@/components/blog/JsonLd';
import { getCuratedProfile } from '@/lib/coach/curated';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { absoluteUrl, DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_SIZE, SITE_NAME } from '@/lib/seo/site';

export const dynamic = 'force-dynamic';

interface CoachProfileRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  bio: string | null;
  avatar_url: string | null;
  accent_color: string | null;
}

interface CoachServiceRow {
  id: string;
  title: string;
  description: string | null;
  price: string | null;
  cta_label: string | null;
  cta_url: string | null;
  sort_order: number;
}

interface CoachLinkRow {
  id: string;
  label: string;
  url: string;
  icon: string | null;
  sort_order: number;
}

/**
 * Unique title and description for curated profiles, read from static data, so
 * this adds no database query. Other coaches keep the site defaults until a
 * per-coach title is wanted (that would need a query; not done here).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const profile = getCuratedProfile(slug);
  if (!profile) return {};
  const title = `${profile.name} – ${profile.role} | ${SITE_NAME}`;
  const url = absoluteUrl(`/coach/${slug}`);
  return {
    title,
    description: profile.directoryBlurb,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      siteName: SITE_NAME,
      url,
      title,
      description: profile.directoryBlurb,
      images: [{ url: absoluteUrl(DEFAULT_OG_IMAGE), ...DEFAULT_OG_IMAGE_SIZE }],
    },
    twitter: { card: 'summary_large_image', title, description: profile.directoryBlurb },
  };
}

export default async function CoachPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  try { supabase = await createSupabaseServerClient(); } catch { /* env not configured */ }
  let dbProfile = null;

  if (supabase) {
    try {
      const { data: profile } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('slug', slug)
        .single<CoachProfileRow>();

      if (profile) {
        const [servicesRes, linksRes] = await Promise.all([
          supabase.from('coach_services').select('*').eq('profile_id', profile.id).order('sort_order'),
          supabase.from('coach_links').select('*').eq('profile_id', profile.id).order('sort_order'),
        ]);

        const services = (servicesRes.data as CoachServiceRow[] | null) ?? [];
        const links = (linksRes.data as CoachLinkRow[] | null) ?? [];

        dbProfile = {
          slug: profile.slug,
          name: profile.name,
          tagline: profile.tagline ?? '',
          bio: profile.bio ?? '',
          avatarUrl: profile.avatar_url ?? undefined,
          accentColor: profile.accent_color ?? '#007AFF',
          services: services.map(s => ({
            id: s.id,
            title: s.title,
            description: s.description ?? '',
            price: s.price ?? '',
            ctaLabel: s.cta_label ?? 'Book Now',
            ctaUrl: s.cta_url ?? '#',
          })),
          links: links.map(l => ({
            id: l.id,
            label: l.label,
            url: l.url,
            icon: (l.icon as 'instagram' | 'youtube' | 'globe' | 'mail' | 'external') ?? undefined,
          })),
        };
      }
    } catch {
      // DB not available — fall through to static profile
    }
  }

  const curated = getCuratedProfile(slug);
  return (
    <>
      {curated && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            mainEntity: {
              '@type': 'Person',
              name: curated.name,
              url: absoluteUrl(`/coach/${slug}`),
              jobTitle: curated.role,
              description: curated.directoryBlurb,
              worksFor: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
              sameAs: curated.socials.filter((s) => s.icon !== 'whatsapp').map((s) => s.url),
            },
          }}
        />
      )}
      <CoachPublicProfile slug={slug} dbProfile={dbProfile} />
    </>
  );
}
