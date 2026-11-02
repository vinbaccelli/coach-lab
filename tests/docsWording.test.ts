import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sentryBaseOptions, sentryEnabled, scrubEvent } from '@/lib/sentryConfig';
import { DEFAULT_TECHNICAL_SHEET_LABELS } from '@/lib/players/technicalSheet';
import { REPORTS_IN_APP } from '@/lib/featureFlags';

const read = (p: string) => readFileSync(p, 'utf8');
const landing = read('components/LandingPage.tsx');
const playersTour = read('components/tours/playersTour.ts');
const privacy = read('app/privacy/page.tsx');
// The prose of the page, without the code comment at the top.
const privacyText = privacy.slice(privacy.indexOf('export default function PrivacyPage'));

test('reports are in the app: the switch this wording follows is on', () => {
  assert.equal(REPORTS_IN_APP, true);
});

test('landing and players tour no longer say reports are saved to Google Docs', () => {
  for (const stale of [
    'which is a Google Doc',
    'your reports in your Google Drive',
    'per-player Google Docs coaching reports',
    'drop everything into the player’s document',
    'Every player carries two documents',
  ]) assert.equal(landing.includes(stale), false, `landing: ${stale}`);
  for (const stale of [
    'The frame goes into their Technical Analysis Doc',
    'add theirs to the Match Analysis Doc',
    'it is written into their Technical Analysis Doc.',
  ]) assert.equal(playersTour.includes(stale), false, `tour: ${stale}`);
});

test('the new wording says what is true: report text in AngleMotion, screenshots in the coach’s Drive, no share links', () => {
  assert.ok(landing.includes('your screenshots in your own Google Drive; the report text is kept in AngleMotion'));
  assert.ok(playersTour.includes('the image itself goes to your own Google Drive'));
  assert.ok(playersTour.includes('Export Google Docs report'));
  for (const claim of [/share link/i, /shareable/i, /public report/i]) {
    assert.equal(claim.test(landing) && /report/i.test(landing.match(claim)?.[0] ?? ''), false);
    assert.equal(claim.test(privacyText), false, String(claim));
  }
});

test('where Google Docs is still true, it is still said: the Docs export buttons exist', () => {
  assert.ok(read('components/metrics/GenerateWorkspace.tsx').includes('Export Google Docs report'));
  assert.ok(read('components/stroMotion/StroMotionPreviewModal.tsx').includes('Export Google Docs report'));
  assert.ok(read('lib/plans.ts').includes('Google Docs report export'));
});

test('privacy page: the sections the task asked for are there', () => {
  for (const title of [
    'Player data you store', 'Where your data is stored', 'Your responsibility for players&rsquo; data',
    'Services we use', 'Error monitoring (Sentry)', 'Data retention and deletion',
  ]) assert.ok(privacyText.includes(`<Section title="${title}">`), title);
});

test('privacy page: every uncertain item carries a visible [VIN TO CONFIRM] tag, and no retention period is invented', () => {
  const tags = [...privacyText.matchAll(/<Confirm>([\s\S]*?)<\/Confirm>/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.equal(tags.length, 4, tags.join(' | '));
  for (const t of tags) assert.ok(t.length > 15, t);
  assert.ok(privacy.includes('[VIN TO CONFIRM: {children}]'), 'the tag renders its marker');
  // Only a duration the code itself fixes (referral cookie: 60 days). The 30-day deletion promise was removed: no period is promised.
  const durations = new Set([...privacyText.matchAll(/\b(\d+)[ -](days?|months?|years?)\b/gi)].map((m) => `${m[1]} ${m[2].replace(/s$/, '')}`));
  assert.deepEqual([...durations].sort(), ['60 day']);
  assert.ok(read('lib/affiliates.ts').includes('REF_COOKIE_MAX_AGE_S = 60 * 24 * 60 * 60'), 'the 60 days is the real cookie lifetime');
});

test('privacy page ↔ code: Sentry is EU only, no replay or tracing, scrubbed', () => {
  assert.equal(sentryEnabled('https://k@o1.ingest.de.sentry.io/1'), true);
  assert.equal(sentryEnabled('https://k@o1.ingest.us.sentry.io/1'), false);
  assert.equal(sentryEnabled(''), false);
  assert.equal(sentryBaseOptions({ dsn: 'https://k@o1.ingest.de.sentry.io/1' }).sendDefaultPii, false);
  const out = scrubEvent({ user: { email: 'a@b.it' }, request: { cookies: 'x', headers: { a: 1 }, data: 'y', query_string: 'q', url: 'https://x.test/a?b=1' }, message: 'mail a@b.it clip.mp4' }) as Record<string, any>;
  assert.equal(out.user, undefined);
  assert.equal(out.request.cookies, undefined);
  assert.equal(out.request.url, 'https://x.test/a');
  assert.equal(out.message, 'mail [email] [file]');
  const client = read('instrumentation-client.ts');
  assert.equal(/replayIntegration|replaysSessionSampleRate|tracesSampleRate/.test(client + read('sentry.server.config.ts')), false);
  assert.ok(client.includes('showName: false') && client.includes('showEmail: false') && client.includes('enableScreenshot: false'));
  assert.ok(privacyText.includes('EU region only') && privacyText.includes('session') && privacyText.includes('replay'));
});

test('privacy page ↔ code: player data, storage and deletion statements match what the code does', () => {
  // Fields the page lists exist on the players table / profile.
  const players = read('supabase/migrations/20260210120000_players_and_entries.sql');
  for (const col of ['display_name', 'photo_url', 'date_of_birth', 'nationality', 'playing_hand', 'notes']) assert.ok(players.includes(col), col);
  assert.ok(players.includes('opponent_name') && players.includes('match_date'));
  // The technical sheet's starting rows are the ones the page names.
  assert.deepEqual([...DEFAULT_TECHNICAL_SHEET_LABELS].map((l) => l.toLowerCase()),
    ['age', 'height', 'weight', 'dominant hand', 'backhand', 'strengths', 'weaknesses', 'level']);
  assert.ok(privacyText.includes('age, height, weight, dominant hand, backhand, strengths, weaknesses and level'));
  // The photo is a link, not an upload.
  assert.ok(read('components/players/PlayerProfileClient.tsx').includes('onChange={(e) => setPlayer({ ...player, photo_url: e.target.value })}'));
  // Screenshots in Drive are link-viewable (the page says so, and asks Vin to confirm).
  assert.ok(read('app/api/google/upload-image/route.ts').includes("role: 'reader', type: 'anyone'"));
  assert.ok(privacyText.includes('anyone who has its link can view it'));
  // Deleting a player: rows, Drive TRASH (not permanent), stored images.
  const del = read('lib/players/deletePlayer.ts');
  assert.ok(del.includes('Move the Drive folder (and the two Docs) to the Drive trash') && del.includes('Remove the player\'s Storage objects'));
  assert.ok(privacyText.includes('moves the player&rsquo;s Drive folder to your Drive trash'));
  // YouTube token: stored encrypted; disconnect deletes it.
  assert.ok(read('supabase/migrations/20260728120000_youtube_connections.sql').includes('refresh_token_enc'));
  assert.ok(/delete\s+\*?\s*the stored row/.test(read('app/api/youtube/disconnect/route.ts')));
  // Services named on the page are the ones the code calls.
  // Gemini is not on the page: its only route is admin-only and unreferenced, so it never sees a coach's data.
  assert.ok(read('app/api/gemini/decode-match/route.ts').includes('isAdmin(session.email)'));
  assert.equal(privacyText.includes('Gemini'), false);
  // Public addresses in Supabase Storage: saved Motion Layer clips (session artifacts) are served by public URL.
  assert.ok(read('lib/sessions/serverStorage.ts').includes('getPublicUrl'));
  assert.ok(privacyText.includes('a Motion Layer clip you save with a session is stored here'));
  // Retention: no promised period, and nothing in the repo deletes inactive accounts on a schedule.
  assert.equal(/\b30 days?\b/.test(privacyText), false);
  assert.ok(privacyText.includes('We do not automatically delete inactive accounts'));
  assert.equal(existsSync('vercel.json'), false, 'no scheduled jobs are configured');
  assert.ok(read('lib/youtubeResolve.ts').includes('pipedapi.'));
  assert.ok(read('lib/ffmpegWebmToMp4.ts').includes('cdn.jsdelivr.net') && read('components/ExportModal.tsx').includes('unpkg.com'));
});

test('privacy page ↔ code: the Docs scope is described as the optional export; the Google scopes are the ones requested', () => {
  assert.ok(read('lib/featureFlags.ts').includes("'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file'"));
  assert.ok(privacyText.includes('only for the optional &ldquo;Export Google Docs report&rdquo; buttons'));
});
