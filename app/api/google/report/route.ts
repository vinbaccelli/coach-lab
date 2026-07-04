import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import type { docs_v1 } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { reportsFolderChain } from '@/lib/google/drive';
import { ensurePlayerDoc, insertSessionAtTop, type PlayerDocRow } from '@/lib/google/playerDocs';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Coaching report export (Metrics + StroMotion Generate).
 *
 * With `playerId`: the report is inserted as a session at the TOP of the
 * player's Technical Analysis doc (standard two-doc layout, newest first) and
 * recorded in player_entries.
 *
 * Without a player: a standalone formatted doc in AngleMotion/Reports.
 */

interface ReportSection {
  heading: string;
  imageUrl?: string;
  lines?: string[];
  notes?: string;
}

interface ReportPayload {
  title?: string;
  playerId?: string;
  youtubeUrl?: string;
  intro?: string;
  settingsLines?: string[];
  sections?: ReportSection[];
}

const IMG_PLACEHOLDER = '￼';

export async function POST(req: Request) {
  const session = await getRouteSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.googleAccessToken) {
    return NextResponse.json(
      { error: 'Google access not granted — sign out and sign in again to enable Docs export.' },
      { status: 403 },
    );
  }

  const payload = (await req.json()) as ReportPayload;
  const sections = payload.sections ?? [];
  const title = payload.title?.trim() || 'AngleMotion — Coaching Report';

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: session.googleAccessToken });
  const docs = google.docs({ version: 'v1', auth: oauth2 });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  try {
    // ── Player path: session inserted into the Technical Analysis doc ──────
    if (payload.playerId) {
      const { data: player } = await session.supabase
        .from('players')
        .select('id, display_name, google_doc_id, google_match_doc_id')
        .eq('id', payload.playerId)
        .single<PlayerDocRow>();
      if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

      const docId = await ensurePlayerDoc(docs, drive, session.supabase, player, 'technical');
      await insertSessionAtTop(docs, docId, {
        title,
        sections,
        youtubeUrl: payload.youtubeUrl,
        notes: payload.intro,
        settingsLines: payload.settingsLines,
      });
      const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

      // Record the report in the player's timeline (best-effort).
      await session.supabase.from('player_entries').insert({
        coach_id: session.userId,
        player_id: player.id,
        category: 'technique',
        folder_label: title,
        body_text: payload.intro ?? '',
        youtube_url: payload.youtubeUrl ?? null,
        screenshots: [],
        source: 'report-export',
        metadata: { doc_url: docUrl, doc_id: docId },
      }).then(({ error }) => { if (error) console.error('[google/report] entry insert failed:', error.message); });

      return NextResponse.json({ documentId: docId, url: docUrl });
    }

    // ── No player: standalone formatted report doc ──────────────────────────
    let text = '';
    const at = () => text.length + 1; // Docs body starts at index 1
    const headingRanges: Array<{ start: number; end: number; style: string }> = [];
    const linkRanges: Array<{ start: number; end: number; url: string }> = [];
    const boldRanges: Array<{ start: number; end: number }> = [];
    const imageSlots: Array<{ index: number; uri: string }> = [];

    const pushLine = (line: string) => { text += `${line}\n`; };
    const pushHeading = (line: string, style: 'HEADING_1' | 'HEADING_2' | 'HEADING_3') => {
      const start = at();
      pushLine(line);
      headingRanges.push({ start, end: start + line.length, style });
    };

    pushHeading(title, 'HEADING_1');
    pushLine(new Date().toLocaleString());
    pushLine('');

    if (payload.youtubeUrl) {
      const label = 'Watch the analysis video on YouTube';
      const start = at();
      pushLine(label);
      linkRanges.push({ start, end: start + label.length, url: payload.youtubeUrl });
      pushLine('');
    }

    if (payload.intro?.trim()) {
      pushLine(payload.intro.trim());
      pushLine('');
    }

    if (payload.settingsLines?.length) {
      pushHeading('Render settings', 'HEADING_3');
      for (const line of payload.settingsLines) pushLine(line);
      pushLine('');
    }

    for (const section of sections) {
      pushHeading(section.heading, 'HEADING_2');
      if (section.imageUrl) {
        imageSlots.push({ index: at(), uri: section.imageUrl });
        pushLine(IMG_PLACEHOLDER);
        pushLine('');
      }
      if (section.lines?.length) {
        const start = at();
        pushLine('Measurements');
        boldRanges.push({ start, end: start + 'Measurements'.length });
        for (const line of section.lines) pushLine(`• ${line}`);
        pushLine('');
      }
      if (section.notes?.trim()) {
        const start = at();
        pushLine('Coach notes');
        boldRanges.push({ start, end: start + 'Coach notes'.length });
        pushLine(section.notes.trim());
        pushLine('');
      }
    }

    pushLine('Generated with AngleMotion');

    const created = await docs.documents.create({ requestBody: { title } });
    const docId = created.data.documentId;
    if (!docId) throw new Error('Failed to create document');

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text } }] },
    });

    const styleRequests: docs_v1.Schema$Request[] = [];
    for (const h of headingRanges) {
      styleRequests.push({
        updateParagraphStyle: {
          range: { startIndex: h.start, endIndex: h.end },
          paragraphStyle: { namedStyleType: h.style },
          fields: 'namedStyleType',
        },
      });
    }
    for (const b of boldRanges) {
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: b.start, endIndex: b.end },
          textStyle: { bold: true },
          fields: 'bold',
        },
      });
    }
    for (const l of linkRanges) {
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: l.start, endIndex: l.end },
          textStyle: { link: { url: l.url }, foregroundColor: { color: { rgbColor: { red: 0.04, green: 0.33, blue: 0.85 } } }, underline: true },
          fields: 'link,foregroundColor,underline',
        },
      });
    }
    if (styleRequests.length) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: styleRequests } });
    }

    const imageRequests: docs_v1.Schema$Request[] = [];
    for (const slot of [...imageSlots].sort((a, b) => b.index - a.index)) {
      imageRequests.push({ deleteContentRange: { range: { startIndex: slot.index, endIndex: slot.index + 1 } } });
      imageRequests.push({
        insertInlineImage: {
          location: { index: slot.index },
          uri: slot.uri,
          objectSize: { width: { magnitude: 440, unit: 'PT' }, height: { magnitude: 248, unit: 'PT' } },
        },
      });
    }
    if (imageRequests.length) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: imageRequests } });
    }

    const folderId = await reportsFolderChain(drive).catch(() => null);
    if (folderId) {
      await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id' }).catch(() => {});
    }

    return NextResponse.json({ documentId: docId, url: `https://docs.google.com/document/d/${docId}/edit` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google Docs report failed';
    console.error('[google/report] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
