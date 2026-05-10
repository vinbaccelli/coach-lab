/** Match-analysis folder title: YYYY-MM-DD — Player A vs Player B */
export function formatMatchFolderLabel(isoDate: string, playerName: string, opponentName: string): string {
  const d = isoDate.trim().slice(0, 10);
  return `${d} — ${playerName.trim()} vs ${opponentName.trim()}`;
}

export function localDateTimeForFolder(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
