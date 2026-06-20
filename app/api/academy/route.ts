import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await session.supabase
    .from('academy_resources')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ resources: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json()) as {
    title: string;
    description?: string;
    category?: string;
    pdf_url: string;
    sort_order?: number;
  };

  if (!body.title?.trim() || !body.pdf_url?.trim()) {
    return NextResponse.json({ error: 'title and pdf_url are required' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('academy_resources')
    .insert({
      title: body.title.trim(),
      description: body.description ?? '',
      category: body.category ?? 'guide',
      pdf_url: body.pdf_url.trim(),
      sort_order: body.sort_order ?? 0,
      created_by: session.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ resource: data });
}

export async function DELETE(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = (await req.json()) as { id: string };
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await session.supabase
    .from('academy_resources')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
