/** Start a YouTube RESUMABLE upload session for a given access token. Server only. */
export type UploadSessionResult =
  | { ok: true; uploadUrl: string }
  | { ok: false; status: number; needsConnect: boolean; error: string };

export async function createYoutubeUploadSession(opts: {
  accessToken: string;
  origin: string;
  title: string;
  description: string;
  sizeBytes: number;
  mimeType: string;
}): Promise<UploadSessionResult> {
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      Origin: opts.origin,
      'X-Upload-Content-Length': String(opts.sizeBytes),
      'X-Upload-Content-Type': opts.mimeType,
    },
    body: JSON.stringify({
      snippet: { title: opts.title, description: opts.description, categoryId: '17' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) {
    const detail = await init.text().catch(() => '');
    console.error(`[youtube/uploadSession] init failed ${init.status}: ${detail.slice(0, 300)}`);
    const needsConnect = init.status === 401 || init.status === 403;
    return { ok: false, status: needsConnect ? 403 : 502, needsConnect, error: needsConnect ? 'YouTube authorization was rejected.' : `YouTube refused the upload (${init.status}).` };
  }
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) return { ok: false, status: 502, needsConnect: false, error: 'YouTube did not return an upload URL.' };
  return { ok: true, uploadUrl };
}
