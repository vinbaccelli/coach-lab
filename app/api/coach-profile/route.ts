import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

/** Generous, but small enough that an accidental paste of a document is caught. */
const MAX_BIO_CHARS = 4000;
const MAX_URL_CHARS = 2048;

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
    return NextResponse.json({ error: 'Name and URL slug are both required.' }, { status: 400 });
  }

  /* Explicit limits with explicit messages. Without these, an oversized value
     surfaces as an opaque 500 from Postgres and the editor shows nothing at
     all — the failure mode reported for avatar uploads. */
  if (profileData.name.length > 120) {
    return NextResponse.json({ error: 'Display name must be under 120 characters.' }, { status: 400 });
  }
  if (profileData.slug.length > 80) {
    return NextResponse.json({ error: 'URL slug must be under 80 characters.' }, { status: 400 });
  }
  if ((profileData.tagline ?? '').length > 200) {
    return NextResponse.json({ error: 'Tagline must be under 200 characters.' }, { status: 400 });
  }
  if ((profileData.bio ?? '').length > MAX_BIO_CHARS) {
    return NextResponse.json(
      { error: `Bio is too long (${profileData.bio!.length.toLocaleString()} characters). Keep it under ${MAX_BIO_CHARS.toLocaleString()}.` },
      { status: 400 },
    );
  }
  if ((profileData.avatar_url ?? '').length > MAX_URL_CHARS) {
    return NextResponse.json(
      { error: 'Profile photo URL is too long to store. Re-upload the photo.' },
      { status: 400 },
    );
  }
  /* A data: URL here means a raw image is being pushed into a text column —
     the classic cause of a silent oversized-payload 500. Uploads must go
     through Supabase Storage and store a URL. */
  if (/^data:/i.test(profileData.avatar_url ?? '')) {
    return NextResponse.json(
      { error: 'Profile photo must be uploaded, not embedded. Choose the photo again.' },
      { status: 400 },
    );
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

  /* These deletes used to run unchecked, so a missing table or a denied policy
     vanished and the request failed later with no usable message. See
     docs/KNOWN_ISSUES.md 004. */
  const { error: svcDelErr } = await session.supabase.from('coach_services').delete().eq('profile_id', profileId);
  if (svcDelErr) {
    return NextResponse.json(
      { error: `Saved your profile, but services could not be updated: ${svcDelErr.message}` },
      { status: 500 },
    );
  }
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

  const { error: linkDelErr } = await session.supabase.from('coach_links').delete().eq('profile_id', profileId);
  if (linkDelErr) {
    return NextResponse.json(
      { error: `Saved your profile, but links could not be updated: ${linkDelErr.message}` },
      { status: 500 },
    );
  }
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
