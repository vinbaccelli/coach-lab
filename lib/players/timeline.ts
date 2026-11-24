/** Pure logic for the player timeline: input validation and merging sources by date. */
import { extractYoutubeVideoId } from '@/lib/youtubeId';

export type TimelineKind = 'note' | 'picture' | 'video' | 'report' | 'metric';

export interface TimelineItem {
  key: string;
  kind: TimelineKind;
  at: string; // ISO timestamp or YYYY-MM-DD
  title: string;
  body?: string;
  imageUrl?: string;
  youtubeId?: string;
  /** id in player_timeline_items, only for items the user can delete. */
  deletableId?: string;
}

export interface RawItem { id: string; kind: 'note' | 'picture' | 'video'; body: string; media_url: string | null; youtube_id: string | null; created_at: string }
export interface RawEntry { id: string; category: string; folder_label: string; body_text: string; created_at: string }
export interface RawMetric { id: string; name: string; unit: string; value: number; recorded_on: string }

export const youtubeEmbedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;

/** Merge every source into one list, newest first. Stable for equal times. */
export function buildTimeline(src: { items: RawItem[]; entries: RawEntry[]; metrics: RawMetric[] }): TimelineItem[] {
  const out: TimelineItem[] = [];
  src.items.forEach((i) => {
    out.push({
      key: `i-${i.id}`,
      kind: i.kind,
      at: i.created_at,
      title: i.kind === 'note' ? 'Comment' : i.kind === 'picture' ? 'Picture' : 'Video',
      body: i.body || undefined,
      imageUrl: i.kind === 'picture' ? i.media_url ?? undefined : undefined,
      youtubeId: i.kind === 'video' ? i.youtube_id ?? undefined : undefined,
      deletableId: i.id,
    });
  });
  src.entries.forEach((e) => {
    out.push({
      key: `e-${e.id}`,
      kind: 'report',
      at: e.created_at,
      title: `${e.category === 'match' ? 'Match' : 'Technical'} report: ${e.folder_label}`,
      body: e.body_text ? e.body_text.slice(0, 280) : undefined,
    });
  });
  src.metrics.forEach((m) => {
    out.push({
      key: `m-${m.id}`,
      kind: 'metric',
      at: m.recorded_on,
      title: `${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`,
    });
  });
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const ta = Date.parse(a.x.at), tb = Date.parse(b.x.at);
      return tb - ta || a.i - b.i;
    })
    .map((v) => v.x);
}

export type NewItem =
  | { kind: 'note'; body: string }
  | { kind: 'video'; youtube_id: string; body: string };

/** Validate a JSON body for a comment or a video link. (Pictures go through the upload path.) */
export function validateNewItem(raw: unknown): { ok: true; item: NewItem } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (body.length > 4000) return { ok: false, error: 'Comment is too long (max 4000 characters)' };
  if (b.kind === 'note') {
    if (!body) return { ok: false, error: 'Write something first' };
    return { ok: true, item: { kind: 'note', body } };
  }
  if (b.kind === 'video') {
    const id = typeof b.youtube_url === 'string' ? extractYoutubeVideoId(b.youtube_url) : null;
    if (!id) return { ok: false, error: 'Paste a valid YouTube link' };
    return { ok: true, item: { kind: 'video', youtube_id: id, body } };
  }
  return { ok: false, error: 'Unknown kind' };
}
