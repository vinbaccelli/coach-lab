/** Pull the Drive file id out of the URL forms upload-image and Drive itself produce. */
export function driveFileId(url: string): string | null {
  const m = /[?&]id=([\w-]{10,})/.exec(url) ?? /\/file\/d\/([\w-]{10,})/.exec(url) ?? /googleusercontent\.com\/d\/([\w-]{10,})/.exec(url);
  return m ? m[1] : null;
}
