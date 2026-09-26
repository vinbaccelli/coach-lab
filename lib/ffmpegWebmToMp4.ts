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

/** Copy into a fresh Uint8Array so `Blob` accepts it under strict TS (no SharedArrayBuffer). */
function mp4BlobFromBytes(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'video/mp4' });
}

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
  opts?: {
    /**
     * Multiply every presentation timestamp by this factor (setpts). < 1 speeds
     * the video up — e.g. a stroke recorded at 0.25× playback with retimeFactor
     * 0.25 plays back at true 1× in the output. Output resampled to 30 fps.
     */
    retimeFactor?: number;
  },
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

  const f = opts?.retimeFactor;
  const retimeArgs = f && f > 0 && Math.abs(f - 1) > 0.001
    ? ['-vf', `setpts=${f.toFixed(4)}*PTS`, '-r', '30']
    : [];

  try {
    const inBytes = new Uint8Array(await webmBlob.arrayBuffer());
    // Validate the INPUT (H3). A recording that produced no data at all cannot be
    // converted, and feeding ffmpeg an empty file returns a non-zero code whose
    // message blames the encoder for the recorder's failure.
    if (inBytes.byteLength < 32) {
      return { ok: false, error: 'Recording data was empty or incomplete.' };
    }
    await ffmpeg.writeFile(inputName, inBytes);

    // ── Codec ladder ────────────────────────────────────────────────────────
    // H.264 is the only codec here that plays everywhere. The ladder therefore
    // spends BOTH of its first two attempts on libx264 and reaches mpeg4 only as a
    // genuine last resort:
    //
    //   1. libx264 + faststart — what the working screen-record path produces.
    //   2. libx264, no faststart, veryfast — faststart rewrites the file to move
    //      the moov atom to the front, and that second pass is its own failure
    //      mode under WASM memory pressure. Dropping it still yields a normal,
    //      universally playable MP4 (it just cannot start playing before it is
    //      fully downloaded, which is irrelevant for a local blob).
    //   3. mpeg4 — MPEG-4 Part 2, a valid .mp4 container that Safari, QuickTime
    //      and current Chrome will NOT decode. It used to be attempt 2, so a
    //      single libx264 hiccup shipped a file the coach could not play, reported
    //      as "not supported" with nothing in the UI to explain it. Kept only
    //      because some file beats no file, and loudly logged.
    const attempts: Array<{ label: string; args: string[] }> = [
      {
        label: 'libx264+faststart',
        args: [
          '-i', inputName, ...retimeArgs,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', '-an', outputName,
        ],
      },
      {
        label: 'libx264',
        args: [
          '-i', inputName, ...retimeArgs,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
          '-an', outputName,
        ],
      },
      {
        label: 'mpeg4',
        args: ['-i', inputName, ...retimeArgs, '-c:v', 'mpeg4', '-q:v', '8', '-an', outputName],
      },
    ];

    let code = -1;
    let bytes: Uint8Array | null = null;
    let usedLabel = '';
    for (const attempt of attempts) {
      code = await ffmpeg.exec(attempt.args);
      if (code === 0) {
        const data = await ffmpeg.readFile(outputName);
        if (typeof data !== 'string') {
          const candidate = new Uint8Array(data);
          // Validate the OUTPUT (H3). A zero-exit ffmpeg run can still leave a
          // truncated or empty file behind, and this function used to return
          // `ok: true` for it — an unplayable "MP4" reported as success.
          if (candidate.byteLength >= 64) {
            bytes = candidate;
            usedLabel = attempt.label;
            break;
          }
        }
        console.warn(`[ffmpegWebmToMp4] ${attempt.label} exited 0 but produced no usable file — trying the next encoder.`);
      } else {
        console.warn(`[ffmpegWebmToMp4] ${attempt.label} failed (code ${code}) — trying the next encoder.`);
      }
      await ffmpeg.deleteFile(outputName).catch(() => {});
    }

    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (!bytes) {
      return { ok: false, error: `ffmpeg produced no playable MP4 (last exit code ${code})` };
    }
    if (usedLabel === 'mpeg4') {
      // Never silent: MPEG-4 Part 2 is the one output here that many players
      // reject, so the console says which file the coach actually got.
      console.warn('[ffmpegWebmToMp4] both H.264 passes failed — output is MPEG-4 Part 2, which Safari/QuickTime may refuse to play.');
    } else if (process.env.NODE_ENV !== 'production') {
      console.log(`[ffmpegWebmToMp4] converted with ${usedLabel} (${bytes.byteLength} bytes)`);
    }
    return { ok: true, blob: mp4BlobFromBytes(bytes) };
  } catch (e) {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}

/**
 * Screen recording export: try H.264 + AAC (mic/webcam audio), then video-only, then mpeg4 fallback.
 * Uses the same FFmpeg singleton as tab-capture conversion — avoids a second WASM load that can crash Safari/WebKit.
 */
export async function convertWebmToMp4ForScreenRecord(
  webmBlob: Blob,
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const inputName = 'screen-in.webm';
  const outputName = 'screen-out.mp4';

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }

  try {
    const buf = new Uint8Array(await webmBlob.arrayBuffer());
    if (buf.byteLength < 32) {
      return { ok: false, error: 'Recording data was empty or incomplete.' };
    }
    await ffmpeg.writeFile(inputName, buf);

    const withAudio = [
      '-i', inputName,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ];
    const videoOnly = [
      '-i', inputName,
      '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputName,
    ];
    const fallbackMpeg = [
      '-i', inputName,
      '-an',
      '-c:v', 'mpeg4', '-q:v', '8',
      outputName,
    ];

    let code = await ffmpeg.exec(withAudio);
    if (code !== 0) {
      // Both remaining attempts pass -an, i.e. they DELIBERATELY DROP AUDIO to
      // salvage the video. That is the right trade, but it must never happen
      // quietly — a silent MP4 out of a recording that had sound is otherwise
      // indistinguishable from the mic never being captured at all.
      console.warn(
        `[ffmpegWebmToMp4] H.264+AAC pass failed (code ${code}); retrying WITHOUT AUDIO — output will be silent.`,
      );
      await ffmpeg.deleteFile(outputName).catch(() => {});
      code = await ffmpeg.exec(videoOnly);
    }
    if (code !== 0) {
      console.warn(`[ffmpegWebmToMp4] libx264 pass failed (code ${code}); falling back to mpeg4, still without audio.`);
      await ffmpeg.deleteFile(outputName).catch(() => {});
      code = await ffmpeg.exec(fallbackMpeg);
    }

    await ffmpeg.deleteFile(inputName).catch(() => {});

    if (code !== 0) {
      await ffmpeg.deleteFile(outputName).catch(() => {});
      return { ok: false, error: `ffmpeg exited with code ${code}` };
    }

    const data = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (!data || typeof data === 'string') {
      return { ok: false, error: 'Could not read converted video.' };
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    if (bytes.byteLength < 64) {
      return { ok: false, error: 'Converted file was empty.' };
    }
    const blob = mp4BlobFromBytes(bytes);
    return { ok: true, blob };
  } catch (e) {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}
