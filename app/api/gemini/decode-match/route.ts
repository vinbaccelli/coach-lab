import { NextResponse } from 'next/server';
import { decodeMatchScreenshots } from '@/lib/gemini/decodeMatchScreenshots';
import { getRouteSession } from '@/lib/auth/routeSession';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data with image fields' }, { status: 400 });
  }

  const form = await req.formData();
  const files = form.getAll('images') as File[];
  if (!files.length) return NextResponse.json({ error: 'No images uploaded' }, { status: 400 });

  const buffers: Buffer[] = [];
  const types: string[] = [];

  for (const f of files.slice(0, 16)) {
    const ab = await f.arrayBuffer();
    buffers.push(Buffer.from(ab));
    types.push(f.type || 'image/png');
  }

  try {
    const report = await decodeMatchScreenshots(buffers, types);
    return NextResponse.json({ report });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Decode failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
