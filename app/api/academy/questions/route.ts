import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

export async function GET() {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await session.supabase
    .from('academy_questions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questions: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const { data, error } = await session.supabase
    .from('academy_questions')
    .insert({
      user_id: session.userId,
      user_email: session.email ?? '',
      user_name: body.user_name ?? session.email?.split('@')[0] ?? '',
      title: body.title.trim(),
      body: body.body ?? '',
      category: body.category ?? 'general',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}

export async function DELETE(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  const { error } = await session.supabase
    .from('academy_questions')
    .delete()
    .eq('id', id)
    .eq('user_id', session.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
