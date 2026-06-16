const BUCKET = 'player-assets';

export function sessionArtifactPath(
  coachId: string,
  playerId: string,
  sessionId: string,
  artifactId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/^\./, '');
  return `${coachId}/${playerId}/${sessionId}/${artifactId}.${safeExt}`;
}

export function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'application/json': 'json',
  };
  return map[mime] ?? 'bin';
}

export { BUCKET as PLAYER_ASSETS_BUCKET };
