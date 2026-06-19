import CoachPublicProfile from '@/components/coach/CoachPublicProfile';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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

export default async function CoachPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

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

  return <CoachPublicProfile slug={slug} dbProfile={dbProfile} />;
}
