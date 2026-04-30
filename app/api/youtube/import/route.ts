export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import ytdlp from 'yt-dlp-exec';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

function safeTitle(name: string) {
  return name.replace(/[^\w\s.-]+/g, '').trim().slice(0, 120) || 'Coach Lab Import';
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing access token' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const url = body?.url?.trim?.() ?? '';
  if (!url || !isHttpUrl(url)) {
    return NextResponse.json({ ok: false, error: 'Missing/invalid url' }, { status: 400 });
  }

  const tmpDir = os.tmpdir();
  const base = `coachlab-import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const outPath = path.join(tmpDir, `${base}.mp4`);

  let title: string | null = null;

  try {
    // Download best effort MP4 (or best available); we force mp4 container when possible.
    const info: any = await (ytdlp as any)(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      format: 'bv*+ba/b',
    });
    title = typeof info?.title === 'string' ? safeTitle(info.title) : null;

    await (ytdlp as any)(url, {
      output: outPath,
      noWarnings: true,
      noCheckCertificates: true,
      // Prefer mp4 streams
      format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      mergeOutputFormat: 'mp4',
    });

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      return NextResponse.json({ ok: false, error: 'Download produced empty file' }, { status: 500 });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const upload = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title ?? 'Coach Lab Import',
          description: `Imported by Coach Lab from URL.\n\nSource: ${url}`,
        },
        status: {
          privacyStatus: 'unlisted',
        },
      },
      media: {
        body: fs.createReadStream(outPath),
      },
    });

    const videoId = upload.data.id;
    if (!videoId) {
      return NextResponse.json({ ok: false, error: 'Upload failed (no videoId)' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Import failed' }, { status: 500 });
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

