import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import type { docs_v1 } from 'googleapis';
import { getRouteSession } from '@/lib/auth/routeSession';
import { playerFolderChain, reportsFolderChain } from '@/lib/google/drive';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Create a formatted coaching report as a Google Doc.
 *
 * Shared by Metrics and StroMotion Generate (ExportService). Payload:
 *   title           — document title + H1
 *   playerId?       — file the doc into AngleMotion/Players/<Name> and prepend
 *                     a dated link entry to the player's Timeline Doc
 *   youtubeUrl?     — linked under the header
 *   intro?          — free text under the header
 *   settingsLines?  — e.g. StroMotion render settings
 *   sections[]      — { heading, imageUrl?, lines?, notes? } per snapshot/render
 *
 * Formatting strategy (index-safe):
 *   1. insertText of the whole body at index 1,
 *   2. paragraph/text styles using ranges computed on that text,
 *   3. inline images inserted at placeholder positions in DESCENDING order.
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

const IMG_PLACEHOLDER = '￼'; // object-replacement char marks image slots

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

  // ── Compose body text, tracking style ranges as we go ────────────────────
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

  try {
    const created = await docs.documents.create({ requestBody: { title } });
    const docId = created.data.documentId;
    if (!docId) throw new Error('Failed to create document');

    // 1. Whole body in one insert.
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text } }] },
    });

    // 2. Styles — ranges reference the placeholder text, which is stable.
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

    // 3. Images — replace each placeholder char, descending so indexes hold.
    //    (insertInlineImage adds 1 char; deleting the placeholder first keeps
    //    the net shift at 0 for everything BELOW, and descending order keeps
    //    everything ABOVE untouched.)
    const imageRequests: docs_v1.Schema$Request[] = [];
    for (const slot of [...imageSlots].sort((a, b) => b.index - a.index)) {
      imageRequests.push({
        deleteContentRange: { range: { startIndex: slot.index, endIndex: slot.index + 1 } },
      });
      imageRequests.push({
        insertInlineImage: {
          location: { index: slot.index },
          uri: slot.uri,
          objectSize: {
            width: { magnitude: 440, unit: 'PT' },
            height: { magnitude: 248, unit: 'PT' },
          },
        },
      });
    }
    if (imageRequests.length) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: imageRequests } });
    }

    // ── File the doc + update the player's Timeline Doc ─────────────────────
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    if (payload.playerId) {
      const { data: player } = await session.supabase
        .from('players')
        .select('id, display_name, google_doc_id')
        .eq('id', payload.playerId)
        .single<{ id: string; display_name: string; google_doc_id: string | null }>();

      if (player) {
        const folderId = await playerFolderChain(drive, player.display_name);
        await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id' }).catch(() => {});

        // Record the report in the player's timeline so the Player Database
        // lists it and links straight to this Doc (best-effort).
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

        // Prepend a dated link entry to the player's Timeline Doc (best-effort).
        if (player.google_doc_id) {
          const entry = `${new Date().toLocaleString()} — ${title}`;
          await docs.documents.batchUpdate({
            documentId: player.google_doc_id,
            requestBody: {
              requests: [
                { insertText: { location: { index: 1 }, text: `${entry}\n` } },
                {
                  updateTextStyle: {
                    range: { startIndex: 1, endIndex: 1 + entry.length },
                    textStyle: { link: { url: docUrl }, underline: true },
                    fields: 'link,underline',
                  },
                },
              ],
            },
          }).catch(() => {});
        }
      }
    } else {
      const folderId = await reportsFolderChain(drive).catch(() => null);
      if (folderId) {
        await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id' }).catch(() => {});
      }
    }

    return NextResponse.json({ documentId: docId, url: docUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google Docs report failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
