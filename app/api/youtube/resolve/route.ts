import { NextResponse } from 'next/server';
import { resolveYoutubeWatchUrl } from '@/lib/youtubeResolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET JSON resolver (curl / manual checks). Prefer {@link resolveYoutubeForAnalysis} from the UI.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url')?.trim() ?? '';
  const debug = searchParams.get('debug') === '1';

  const result = await resolveYoutubeWatchUrl(target);

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      directUrl: result.directUrl,
      title: result.title,
      chosen: result.chosen,
      ...(debug ? { debug: true } : {}),
    });
  }

  const err = result.error;
  const status =
    err === 'Missing/invalid url' || err === 'Not a YouTube URL' ? 400 : 422;

  return NextResponse.json({ ok: false, error: err }, { status });
}
