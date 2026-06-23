import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data, error } = await session.supabase
    .from('academy_replies')
    .select('*')
    .eq('question_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ replies: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.body?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const { data, error } = await session.supabase
    .from('academy_replies')
    .insert({
      question_id: id,
      user_id: session.userId,
      user_email: session.email ?? '',
      user_name: body.user_name ?? session.email?.split('@')[0] ?? '',
      body: body.body.trim(),
      is_coach_answer: isAdmin(session.email),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reply: data });
}
