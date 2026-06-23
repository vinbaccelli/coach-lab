import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await session.supabase
    .from('coach_profiles')
    .select('*')
    .eq('user_id', session.userId)
    .single();

  if (!profile) return NextResponse.json({ profile: null });

  const [servicesRes, linksRes] = await Promise.all([
    session.supabase.from('coach_services').select('*').eq('profile_id', profile.id).order('sort_order'),
    session.supabase.from('coach_links').select('*').eq('profile_id', profile.id).order('sort_order'),
  ]);

  return NextResponse.json({
    profile,
    services: servicesRes.data ?? [],
    links: linksRes.data ?? [],
  });
}

export async function PUT(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { profile: profileData, services, links } = body as {
    profile: {
      slug: string;
      name: string;
      tagline?: string;
      bio?: string;
      avatar_url?: string;
      accent_color?: string;
    };
    services: Array<{
      id?: string;
      title: string;
      description?: string;
      price?: string;
      cta_label?: string;
      cta_url?: string;
      sort_order: number;
    }>;
    links: Array<{
      id?: string;
      label: string;
      url: string;
      icon?: string;
      sort_order: number;
    }>;
  };

  if (!profileData.name?.trim() || !profileData.slug?.trim()) {
    return NextResponse.json({ error: 'name and slug are required' }, { status: 400 });
  }

  const { data: existing } = await session.supabase
    .from('coach_profiles')
    .select('id')
    .eq('user_id', session.userId)
    .single();

  let profileId: string;

  if (existing) {
    profileId = existing.id;
    const { error } = await session.supabase
      .from('coach_profiles')
      .update({
        slug: profileData.slug.trim(),
        name: profileData.name.trim(),
        tagline: profileData.tagline ?? '',
        bio: profileData.bio ?? '',
        avatar_url: profileData.avatar_url ?? null,
        accent_color: profileData.accent_color ?? '#007AFF',
        updated_at: new Date().toISOString(),
      })
      .eq('id', profileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await session.supabase
      .from('coach_profiles')
      .insert({
        user_id: session.userId,
        slug: profileData.slug.trim(),
        name: profileData.name.trim(),
        tagline: profileData.tagline ?? '',
        bio: profileData.bio ?? '',
        avatar_url: profileData.avatar_url ?? null,
        accent_color: profileData.accent_color ?? '#007AFF',
      })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    profileId = data.id;
  }

  await session.supabase.from('coach_services').delete().eq('profile_id', profileId);
  if (services.length > 0) {
    const { error } = await session.supabase
      .from('coach_services')
      .insert(services.map((s, i) => ({
        profile_id: profileId,
        title: s.title,
        description: s.description ?? '',
        price: s.price ?? '',
        cta_label: s.cta_label ?? 'Book Now',
        cta_url: s.cta_url ?? '#',
        sort_order: i,
      })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await session.supabase.from('coach_links').delete().eq('profile_id', profileId);
  if (links.length > 0) {
    const { error } = await session.supabase
      .from('coach_links')
      .insert(links.map((l, i) => ({
        profile_id: profileId,
        label: l.label,
        url: l.url,
        icon: l.icon ?? 'external',
        sort_order: i,
      })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profileId });
}
