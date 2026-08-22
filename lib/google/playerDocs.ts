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

/**
 * True for Google errors meaning "this token cannot touch that resource" —
 * as opposed to a bad request or an outage.
 *
 * Matters because the app holds the PER-FILE `drive.file` scope
 * (lib/featureFlags.ts): it can only ever see files IT created. A doc id
 * persisted by an earlier grant, a different Google account, or a since-deleted
 * file is therefore unreachable, and Google answers "The caller does not have
 * permission" rather than anything that reads as "make a new one".
 */
export function isGooglePermissionError(e: unknown): boolean {
  const err = e as { code?: number; status?: number; message?: string } | null;
  const msg = String(err?.message ?? '');
  // A FULL Drive also answers 403. Recreating the doc cannot fix that — the new
  // doc needs quota too — and the retry would pointlessly discard a perfectly
  // valid google_doc_id on the way. Let quota errors surface as themselves.
  if (isGoogleQuotaError(e)) return false;
  const code = err?.code ?? err?.status;
  if (code === 403 || code === 404) return true;
  return /caller does not have permission|permission|not found|insufficient/i.test(msg);
}

/** Google Drive storage quota exhausted — the coach must free space; no retry helps. */
export function isGoogleQuotaError(e: unknown): boolean {
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return /storagequotaexceeded|storage quota|quota has been exceeded|not enough storage/i.test(msg);
}

/**
 * The file DEFINITIVELY no longer exists — deleted outright, or never did.
 *
 * This is the ONLY condition that justifies creating a replacement doc. Every
 * other failure (quota, permission, rate limit, network) leaves the existing
 * doc perfectly intact, so replacing it would abandon a live document and add
 * another file to a Drive that is often already full — which is exactly how
 * dozens of orphaned "<Player> — Technical Analysis" docs accumulated.
 */
function isDefinitivelyGone(e: unknown): boolean {
  const err = e as { code?: number; status?: number; message?: string } | null;
  if ((err?.code ?? err?.status) === 404) return true;
  return /file not found|notfound/i.test(String(err?.message ?? ''));
}

/**
 * Run a Google call tagged with the operation name, so a failure names the
 * EXACT step instead of surfacing a bare "The caller does not have permission"
 * that could have come from any of a dozen calls.
 */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const wrapped = new Error(`${label}: ${msg}`);
    Object.assign(wrapped, {
      code: (e as { code?: number })?.code,
      status: (e as { status?: number })?.status,
      googleStep: label,
      cause: e,
    });
    throw wrapped;
  }
}

/** Get (or create) the player's doc of the given kind. Persists the id on the player row. */
export async function ensurePlayerDoc(
  docs: DocsClient,
  drive: DriveClient,
  supabase: SupabaseClient,
  player: PlayerDocRow,
  kind: PlayerDocKind,
): Promise<string> {
  return (await ensurePlayerDocEx(docs, drive, supabase, player, kind)).docId;
}

/**
 * As ensurePlayerDoc, but reports whether the doc was CREATED by this call.
 *
 * Callers need that to avoid leaving orphans: if a later step fails, a doc we
 * just created should be cleaned up, while a pre-existing one must be left
 * alone.
 */
export async function ensurePlayerDocEx(
  docs: DocsClient,
  drive: DriveClient,
  supabase: SupabaseClient,
  player: PlayerDocRow,
  kind: PlayerDocKind,
): Promise<{ docId: string; created: boolean }> {
  const meta = KIND_META[kind];
  let docId = player[meta.column] ?? undefined;

  // REUSE the player's existing doc whenever it is still there — that is what
  // makes the doc a running timeline instead of a pile of one-entry files.
  //
  // Only a definitive "gone" (404, or trashed) falls through to creating a
  // replacement. A quota or permission failure means the doc probably still
  // exists and we simply cannot see it right now, so we raise instead: better
  // one clear error than a duplicate doc on every attempt.
  if (docId) {
    let reuse: boolean;
    try {
      const r = await drive.files.get({ fileId: docId, fields: 'id,trashed' });
      reuse = !!r.data.id && !r.data.trashed;
    } catch (e) {
      if (!isDefinitivelyGone(e)) {
        const why = e instanceof Error ? e.message : String(e);
        throw new Error(
          `files.get(existing ${meta.column}): ${why} — refusing to create a duplicate doc while the stored one may still exist`,
        );
      }
      reuse = false;
    }
    if (reuse) return { docId, created: false };
  }

  const created = await step('documents.create', () =>
    docs.documents.create({
      requestBody: { title: `${player.display_name} — ${meta.suffix}` },
    }),
  );
  docId = created.data.documentId ?? undefined;
  if (!docId) throw new Error('Failed to create document');

  // Header: player name as Heading 1 on line one; history begins below.
  const header = `${player.display_name}\n`;
  await step('documents.batchUpdate(header)', () => docs.documents.batchUpdate({
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
  }));

  // File it under AngleMotion/Players/<Name> and persist the id.
  //
  // Both calls stay best-effort ON PURPOSE. Under the per-file `drive.file`
  // scope the folder SEARCH in findOrCreateFolder cannot see folders this app
  // did not create, and on restricted/Workspace accounts it can 403 outright.
  // Neither is a reason to lose the coach's screenshot: the doc has already
  // been created in the user's own Drive root, which they always own, so a
  // failure here just means it is not filed into a subfolder.
  const folderId = await playerFolderChain(drive, player.display_name).catch((e) => {
    console.error('[playerDocs] playerFolderChain failed (doc stays in Drive root):', e instanceof Error ? e.message : e);
    return null;
  });
  if (folderId) {
    await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id' }).catch((e) => {
      console.error('[playerDocs] files.update(addParents) failed (doc stays in Drive root):', e instanceof Error ? e.message : e);
    });
  }
  // `folderId` was computed and used above but never written to the row, so
  // google_folder_id stayed null even when the Drive folder genuinely existed
  // (players.google_folder_id — surfaced as the "Open Drive folder" link in
  // PlayerProfileClient.tsx). Persist it alongside the doc id whenever we have
  // one; a failed folder lookup (folderId null) leaves the column untouched
  // rather than clobbering a value a previous export already wrote.
  await supabase.from('players')
    .update({ [meta.column]: docId, ...(folderId ? { google_folder_id: folderId } : {}) })
    .eq('id', player.id);

  return { docId, created: true };
}

/**
 * Bin a doc this request created before a later step failed, and drop the id we
 * just persisted. Without this a failed save leaves a header-only doc behind
 * and burns quota on a Drive that may already be full. Best-effort by design:
 * cleanup must never mask the original error.
 */
export async function discardCreatedDoc(
  drive: DriveClient,
  supabase: SupabaseClient,
  playerId: string,
  column: 'google_doc_id' | 'google_match_doc_id',
  docId: string,
): Promise<void> {
  try {
    await drive.files.update({ fileId: docId, requestBody: { trashed: true } });
  } catch (e) {
    console.error('[playerDocs] could not bin partially-created doc', docId, e instanceof Error ? e.message : e);
  }
  try {
    await supabase.from('players').update({ [column]: null }).eq('id', playerId);
  } catch { /* the row keeps a dead id; the next save re-creates cleanly */ }
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
  /**
   * Render the heading as a real Docs heading rather than a bold line.
   *
   * ADDITIVE AND OPT-IN: callers that omit it get exactly the previous bold-label
   * behaviour, so the technical-analysis and coaching-report exports are
   * untouched. The match report sets it to get a genuine type hierarchy — a
   * document built entirely from bold body text reads as a data dump no matter
   * how good the numbers are.
   */
  headingLevel?: 'h2' | 'h3';
  /**
   * Blank lines to emit after this section's image — comment space for the
   * coach to type under the screenshot, timeline-style.
   *
   * ADDITIVE AND OPT-IN: defaults to none, so the match-report and coaching-
   * report exports keep their exact previous spacing.
   */
  blankLinesAfter?: number;
  /**
   * Override the fixed 440×248pt image box for THIS section's image.
   *
   * ADDITIVE AND OPT-IN: omitted, every image keeps the previous fixed
   * landscape box — correct for a chart or a screenshot, both roughly
   * landscape. A full-page report capture is tall portrait; forcing that into
   * a 248pt-high box would squash it illegibly, so the manual recorder's
   * full-report export computes its own box from the capture's real aspect
   * ratio (see lib/matchAnalysis/captureReportImage.ts) and passes it here.
   */
  imageObjectSizePt?: { width: number; height: number };
}

export interface SessionBlock {
  /** Optional report title shown under the Session heading. */
  title?: string;
  sections: SessionSection[];
  youtubeUrl?: string;
  notes?: string;
  settingsLines?: string[];
  /**
   * Replace the auto-generated "Session — <now>" heading with this exact text
   * (still Heading 2, still the ONE timestamp line).
   *
   * ADDITIVE AND OPT-IN: omitted, this is byte-identical to before — the
   * report and match-entries callers are untouched. The screenshot-save route
   * sets it to the screenshot's own timestamp so the entry doesn't carry two
   * timestamps (this heading plus a separate title line).
   */
  timestampOverride?: string;
  /**
   * Replace the bold "Screenshots" label printed once before the entry's
   * image(s).
   *
   * ADDITIVE AND OPT-IN: omitted, this is exactly "Screenshots" as before.
   */
  imagesLabel?: string;
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
  const imageSlots: Array<{ index: number; uri: string; objectSizePt?: { width: number; height: number } }> = [];

  const pushLine = (line: string) => { text += `${line}\n`; };
  const pushBoldLabel = (label: string) => {
    const start = at();
    pushLine(label);
    boldRanges.push({ start, end: start + label.length });
  };

  const sessionTitle = session.timestampOverride?.trim() || `Session — ${new Date().toLocaleString()}`;
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
  if (hasImages) pushBoldLabel(session.imagesLabel?.trim() || 'Screenshots');
  for (const section of session.sections) {
    if (section.heading?.trim()) {
      const text = section.heading.trim();
      if (section.headingLevel) {
        const start = at();
        pushLine(text);
        headingRanges.push({
          start,
          end: start + text.length,
          style: section.headingLevel === 'h2' ? 'HEADING_2' : 'HEADING_3',
        });
      } else {
        pushBoldLabel(text);
      }
    }
    if (section.imageUrl) {
      imageSlots.push({ index: at(), uri: section.imageUrl, objectSizePt: section.imageObjectSizePt });
      pushLine(IMG_PLACEHOLDER);
    }
    for (const line of section.lines ?? []) pushLine(`• ${line}`);
    if (section.notes?.trim()) pushLine(section.notes.trim());
    for (let i = 0; i < (section.blankLinesAfter ?? 0); i++) pushLine('');
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
  await step('documents.batchUpdate(insertText)', () => docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: base }, text } }] },
  }));

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
  await step('documents.batchUpdate(styles)', () =>
    docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: styleRequests } }));

  // 3. Images — replace placeholders in DESCENDING index order so earlier
  //    indexes stay valid (delete 1 char + insert image = net 0 shift below).
  const buildImageRequests = (uriFor: (uri: string) => string): docs_v1.Schema$Request[] => {
    const reqs: docs_v1.Schema$Request[] = [];
    for (const slot of [...imageSlots].sort((a, b) => b.index - a.index)) {
      reqs.push({ deleteContentRange: { range: { startIndex: slot.index, endIndex: slot.index + 1 } } });
      const size = slot.objectSizePt ?? { width: 440, height: 248 };
      reqs.push({
        insertInlineImage: {
          location: { index: slot.index },
          uri: uriFor(slot.uri),
          objectSize: {
            width: { magnitude: size.width, unit: 'PT' },
            height: { magnitude: size.height, unit: 'PT' },
          },
        },
      });
    }
    return reqs;
  };

  if (imageSlots.length) {
    try {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: buildImageRequests((u) => u) },
      });
    } catch (e) {
      // insertInlineImage makes Google fetch the URI SERVER-SIDE and it must
      // return raw image bytes. Drive's `uc?export=view&id=` endpoint often
      // answers with an HTML interstitial instead, which the Docs API rejects
      // even though the file is shared anyone-with-link. `thumbnail?id=&sz=`
      // does return bytes, so retry through that before giving up.
      const retryable = imageSlots.some((s) => driveFileId(s.uri));
      if (!retryable) throw e;
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: buildImageRequests((u) => {
            const id = driveFileId(u);
            return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : u;
          }),
        },
      });
    }
  }
}

/** Extract a Drive file id from the URL shapes this app hands to the Docs API. */
function driveFileId(uri: string): string | null {
  const m =
    /[?&]id=([a-zA-Z0-9_-]+)/.exec(uri) ??
    /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(uri);
  return m?.[1] ?? null;
}
