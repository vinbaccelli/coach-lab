'use client';

/** Shrink a picture to at most `max` px on its long side and re-encode it as JPEG (small, quick uploads from a phone). */
export async function shrinkImage(file: Blob, max = 1280, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));
  c.width = c.height = 0;
  if (!blob) throw new Error('Could not read that picture');
  return blob;
}
