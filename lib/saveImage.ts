/**
 * Save an image (data: or blob: URL) from a button tap.
 *
 * Real iPhone (Chrome/WebKit, 2026-11-10): the Motion Layer "Download PNG" button did nothing however often it was tapped, while the video download
 * (a blob URL on an anchor appended to the page) worked. The old path (lib/drawingTools downloadDataURL) clicks a DETACHED anchor holding a very long
 * data: URL, which WebKit ignores. So: turn the URL into a Blob, offer the share sheet on iOS (Save Image / Photos / Files), else click an anchor that
 * IS in the page with a blob URL. Returns what happened so the caller can say so.
 */
import { isIosUserAgent } from '@/lib/stroMotion';

export type SaveImageResult = 'shared' | 'downloaded' | 'cancelled';

export async function saveImageFromUrl(url: string, filename: string): Promise<SaveImageResult> {
  const blob = await (await fetch(url)).blob();
  const type = blob.type || 'image/png';
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && isIosUserAgent(nav.userAgent) && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const file = new File([blob], filename, { type });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'; // the coach closed the sheet
        // any other failure: fall through to the plain download
      }
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return 'downloaded';
}
