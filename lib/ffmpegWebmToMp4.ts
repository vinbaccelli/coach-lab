/**
 * Lazy-loaded WebM → MP4 conversion using ffmpeg.wasm (browser-only).
 * Loads `@ffmpeg/ffmpeg` / `@ffmpeg/util` and the single-thread `@ffmpeg/core`
 * (smaller than core-mt) from a CDN only when conversion runs.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

/** Pin to a core build compatible with `@ffmpeg/ffmpeg` 0.12.x */
const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegSingleton: FFmpeg | null = null;

/** Release WASM worker memory between analysis sessions or on page leave. */
export function disposeFfmpegWasm(): void {
  if (!ffmpegSingleton) return;
  try {
    ffmpegSingleton.terminate();
  } catch {
    /* noop */
  }
  ffmpegSingleton = null;
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);

  const ffmpeg = new FFmpeg();
  const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
  const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
  await ffmpeg.load({ coreURL, wasmURL });

  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

export async function convertWebmBlobToMp4(
  webmBlob: Blob,
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const inputName = 'in.webm';
  const outputName = 'out.mp4';

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await webmBlob.arrayBuffer()));

    const primary = [
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outputName,
    ];
    let code = await ffmpeg.exec(primary);

    if (code !== 0) {
      await ffmpeg.deleteFile(outputName).catch(() => {});
      const fallback = ['-i', inputName, '-c:v', 'mpeg4', '-q:v', '8', '-an', outputName];
      code = await ffmpeg.exec(fallback);
    }

    await ffmpeg.deleteFile(inputName).catch(() => {});

    if (code !== 0) {
      await ffmpeg.deleteFile(outputName).catch(() => {});
      return { ok: false, error: `ffmpeg exited with code ${code}` };
    }

    const data = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (typeof data === 'string') {
      return { ok: false, error: 'Unexpected text output from ffmpeg' };
    }
    const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
    return { ok: true, blob };
  } catch (e) {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}
