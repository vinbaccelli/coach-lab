import { NextResponse } from 'next/server';
import { getRouteSession } from '@/lib/auth/routeSession';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { question_id, reply_id } = await req.json();
  if (!question_id && !reply_id) return NextResponse.json({ error: 'question_id or reply_id required' }, { status: 400 });

  const table = question_id ? 'question_id' : 'reply_id';
  const targetId = question_id || reply_id;

  const { data: existing } = await session.supabase
    .from('academy_votes')
    .select('id')
    .eq('user_id', session.userId)
    .eq(table, targetId)
    .single();

  if (existing) {
    await session.supabase.from('academy_votes').delete().eq('id', existing.id);

    const targetTable = question_id ? 'academy_questions' : 'academy_replies';
    const { data: current } = await session.supabase.from(targetTable).select('upvotes').eq('id', targetId).single();
    if (current) {
      await session.supabase.from(targetTable).update({ upvotes: Math.max(0, (current.upvotes ?? 1) - 1) }).eq('id', targetId);
    }

    return NextResponse.json({ voted: false });
  }

  const insertData: Record<string, string> = { user_id: session.userId };
  insertData[table] = targetId;
  await session.supabase.from('academy_votes').insert(insertData);

  const targetTable = question_id ? 'academy_questions' : 'academy_replies';
  const { data: current } = await session.supabase.from(targetTable).select('upvotes').eq('id', targetId).single();
  if (current) {
    await session.supabase.from(targetTable).update({ upvotes: (current.upvotes ?? 0) + 1 }).eq('id', targetId);
  }

  return NextResponse.json({ voted: true });
}
