/**
 * Player Google Docs — the standard two-doc layout.
 *
 * Every player has exactly two Docs, both titled with the player's name on
 * the first line and the analysis history below it in reverse-chronological
 * order (newest session first, inserted immediately below the header):
 *
 *   - Technical Analysis (players.google_doc_id) — video-analysis reports,
 *     screenshots, video links, notes.
 *   - Match Analysis (players.google_match_doc_id) — match decoder / manual
 *     match reports.
 *
 * Session block format:
 *   Session — <Date & Time>        (Heading 2)
 *   Screenshots                    (bold, when images present)
 *   <images>
 *   Video                          (bold, only when a link exists)
 *   <link>
 *   Notes                          (bold, optional)
 *   <text>
 */
import { google } from 'googleapis';
import type { docs_v1 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { playerFolderChain } from '@/lib/google/drive';

type DocsClient = ReturnType<typeof google.docs>;
type DriveClient = ReturnType<typeof google.drive>;

export type PlayerDocKind = 'technical' | 'match';

export interface PlayerDocRow {
  id: string;
  display_name: string;
  google_doc_id: string | null;
  google_match_doc_id: string | null;
}

const KIND_META: Record<PlayerDocKind, { column: 'google_doc_id' | 'google_match_doc_id'; suffix: string }> = {
  technical: { column: 'google_doc_id', suffix: 'Technical Analysis' },
  match: { column: 'google_match_doc_id', suffix: 'Match Analysis' },
};

const IMG_PLACEHOLDER = '￼';

/** Get (or create) the player's doc of the given kind. Persists the id on the player row. */
export async function ensurePlayerDoc(
  docs: DocsClient,
  drive: DriveClient,
  supabase: SupabaseClient,
  player: PlayerDocRow,
  kind: PlayerDocKind,
): Promise<string> {
  const meta = KIND_META[kind];
  let docId = player[meta.column] ?? undefined;

  // Verify the cached doc still exists; otherwise recreate.
  if (docId) {
    const ok = await drive.files
      .get({ fileId: docId, fields: 'id,trashed' })
      .then((r) => !!r.data.id && !r.data.trashed)
      .catch(() => false);
    if (!ok) docId = undefined;
  }
  if (docId) return docId;

  const created = await docs.documents.create({
    requestBody: { title: `${player.display_name} — ${meta.suffix}` },
  });
  docId = created.data.documentId ?? undefined;
  if (!docId) throw new Error('Failed to create document');

  // Header: player name as Heading 1 on line one; history begins below.
  const header = `${player.display_name}\n`;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        { insertText: { location: { index: 1 }, text: header } },
        {
          updateParagraphStyle: {
            range: { startIndex: 1, endIndex: 1 + player.display_name.length },
            paragraphStyle: { namedStyleType: 'HEADING_1' },
            fields: 'namedStyleType',
          },
        },
      ],
    },
  });

  // File it under AngleMotion/Players/<Name> and persist the id.
  const folderId = await playerFolderChain(drive, player.display_name).catch(() => null);
  if (folderId) {
    await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id' }).catch(() => {});
  }
  await supabase.from('players').update({ [meta.column]: docId }).eq('id', player.id);

  return docId;
}

/** Index right after the first paragraph (the player-name header line). */
async function topInsertIndex(docs: DocsClient, docId: string): Promise<number> {
  try {
    const doc = await docs.documents.get({
      documentId: docId,
      fields: 'body(content(endIndex,paragraph))',
    });
    for (const el of doc.data.body?.content ?? []) {
      if (el.paragraph && typeof el.endIndex === 'number') return el.endIndex;
    }
  } catch { /* fall through */ }
  return 1;
}

export interface SessionSection {
  heading?: string;
  imageUrl?: string;
  lines?: string[];
  notes?: string;
}

export interface SessionBlock {
  /** Optional report title shown under the Session heading. */
  title?: string;
  sections: SessionSection[];
  youtubeUrl?: string;
  notes?: string;
  settingsLines?: string[];
}

/**
 * Insert a session block at the TOP of the analysis history (directly below
 * the player-name header). Newest first; the header is never duplicated.
 */
export async function insertSessionAtTop(
  docs: DocsClient,
  docId: string,
  session: SessionBlock,
): Promise<void> {
  const base = await topInsertIndex(docs, docId);

  let text = '';
  const at = () => base + text.length;
  const headingRanges: Array<{ start: number; end: number; style: string }> = [];
  const boldRanges: Array<{ start: number; end: number }> = [];
  const linkRanges: Array<{ start: number; end: number; url: string }> = [];
  const imageSlots: Array<{ index: number; uri: string }> = [];

  const pushLine = (line: string) => { text += `${line}\n`; };
  const pushBoldLabel = (label: string) => {
    const start = at();
    pushLine(label);
    boldRanges.push({ start, end: start + label.length });
  };

  const sessionTitle = `Session — ${new Date().toLocaleString()}`;
  {
    const start = at();
    pushLine(sessionTitle);
    headingRanges.push({ start, end: start + sessionTitle.length, style: 'HEADING_2' });
  }
  if (session.title?.trim()) pushLine(session.title.trim());
  if (session.settingsLines?.length) {
    for (const line of session.settingsLines) pushLine(line);
  }

  const hasImages = session.sections.some((s) => s.imageUrl);
  if (hasImages) pushBoldLabel('Screenshots');
  for (const section of session.sections) {
    if (section.heading?.trim()) pushBoldLabel(section.heading.trim());
    if (section.imageUrl) {
      imageSlots.push({ index: at(), uri: section.imageUrl });
      pushLine(IMG_PLACEHOLDER);
    }
    for (const line of section.lines ?? []) pushLine(`• ${line}`);
    if (section.notes?.trim()) pushLine(section.notes.trim());
  }

  if (session.youtubeUrl) {
    pushBoldLabel('Video');
    const start = at();
    const label = session.youtubeUrl;
    pushLine(label);
    linkRanges.push({ start, end: start + label.length, url: session.youtubeUrl });
  }

  if (session.notes?.trim()) {
    pushBoldLabel('Notes');
    pushLine(session.notes.trim());
  }
  pushLine('');

  // 1. The whole block in one insert at the top of the history.
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: base }, text } }] },
  });

  // 2. Styles (ranges are stable — placeholders still in place). Reset the
  //    session block to NORMAL_TEXT first so it never inherits header styling.
  const styleRequests: docs_v1.Schema$Request[] = [
    {
      updateParagraphStyle: {
        range: { startIndex: base, endIndex: base + text.length },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: 'namedStyleType',
      },
    },
  ];
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
        textStyle: { link: { url: l.url }, underline: true },
        fields: 'link,underline',
      },
    });
  }
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: styleRequests } });

  // 3. Images — replace placeholders in DESCENDING index order so earlier
  //    indexes stay valid (delete 1 char + insert image = net 0 shift below).
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
}
