/**
 * Post-recording crop / trim export (Phase 3, Section 6).
 *
 * Editing happens ONLY at export time and is canvas-based — there is no live
 * cropping during capture and no browser-coordinate dependency:
 *   1. Load the recorded blob into a hidden <video>
 *   2. (trim) seek to the in-point
 *   3. Draw the cropped region of each frame into a canvas
 *   4. canvas.captureStream() -> MediaRecorder -> final blob
 *      (trim) stop at the out-point
 *   5. (best-effort) convert WebM -> MP4 for download
 *
 * `region` is in the recorded video's intrinsic pixel space; `trim` is in
 * seconds on the source timeline.
 *
 * CROP AND TRIM ARE ONE PASS. Running two passes would re-encode the recording
 * twice — double the wait and a second generation of compression loss — so both
 * edits are applied in this single render.
 */

import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';
import { scaledExportSize } from '@/lib/exportEstimate';
import {
  emptyExportError, holdResumeSeek, holdSeekLanded, NO_FRAME_GIVE_UP_MS, outputProgress, resumeAction, RESUME_FAILED_TEXT, runOverlay, type OverlayFn,
} from '@/lib/exportOverlay';
import {
  countAudioTracksInContainer, rateCandidates, rateWorked, RATE_PROBE_MS, sourceAudioFromProbe, type SourceAudio,
} from '@/lib/exportSpeed';

export type ExportRegion = { x: number; y: number; w: number; h: number };
/** In/out points in seconds on the SOURCE timeline. */
export type TrimRange = { start: number; end: number };

export interface EditExportOptions {
  /** Omit (or null) to keep the full frame. */
  region?: ExportRegion | null;
  /** Omit (or null) to keep the whole clip. */
  trim?: TrimRange | null;
  onProgress?: (msg: string) => void;
  /**
   * The settings below are optional and used only by the Metrics export
   * (components/metrics/MetricsExportPanel.tsx). Omitted, the render is exactly
   * the Recording Hub's: full source size, 5 Mbps, crf 23 on MP4 conversion,
   * no cancel, no pausing.
   */
  /** Scale the output down so its height is at most this (aspect kept; never upscales). */
  maxHeight?: number | null;
  /** Recorder video bitrate (default 5 Mbps). Also caps the MP4 conversion when one is needed. */
  videoBitsPerSecond?: number;
  /** Abort → the render stops, nothing is returned but `{ ok: false, cancelled: true }`. */
  signal?: AbortSignal;
  /**
   * Pause the render (video + recorder) while the tab is hidden and resume when
   * it is visible again: hidden tabs stop requestAnimationFrame, so the frames
   * would otherwise be lost while the source keeps playing.
   */
  pauseWhenHidden?: boolean;
  /**
   * Fraction rendered so far (0..1), reported from the paint loop. With `holds`
   * it is on the OUTPUT timeline: (media seconds + hold seconds done) ÷ (range +
   * all holds), so it keeps moving while a hold stands still.
   */
  onRenderProgress?: (fraction: number) => void;
  /**
   * Draws on top of each video frame, right after it is drawn: `mediaTime` is
   * the source video's time, `ow`×`oh` the output size (Metrics export:
   * skeleton + drawings). `hold` is the index into `holds` while one is shown,
   * else null. Omitted, nothing else is drawn.
   */
  drawOverlay?: OverlayFn;
  /**
   * Freeze points (Metrics export snapshot holds), in source seconds. At each
   * `at` the video is paused and seeked exactly to `at`, and that frame is drawn
   * on every paint for `seconds` (the recorder keeps receiving frames), then
   * playback continues. Audio is silent during a hold. Omitted or empty: the
   * render is exactly as before (the Recording Hub never passes any).
   */
  holds?: ReadonlyArray<{ at: number; seconds: number }>;
  /**
   * Slow motion (Metrics export): the hidden video plays at this playbackRate, so
   * the file lasts range ÷ rate. Overlays still get the video's media time and
   * holds keep their own seconds. Default 1. A rate the device cannot play (a
   * short probe before recording checks) falls back to the nearest faster one;
   * the result says which was used.
   */
  playbackRate?: number;
  /** false: no sound track at all. Default true. Kept at every speed (slow motion plays the sound slowed, pitch not corrected). */
  includeAudio?: boolean;
  /** Diagnostic lines (render start, each hold's seek / end / play() result, media time once a second). */
  onDiag?: (msg: string) => void;
}

export type EditExportResult =
  | { ok: true; blob: Blob; ext: string; /** The playbackRate actually used (differs from the asked one after a fallback). */ rate?: number; /** Sound was asked for: did an audio track reach the recorder? (false: the file is silent). */ audioCaptured?: boolean }
  | { ok: false; error: string; cancelled?: true };

const CANCELLED: EditExportResult = { ok: false, error: 'Export cancelled.', cancelled: true };

/**
 * A hold's exact seek that has not landed by then (holdSeekLanded) is given
 * up on, never retried: the hold shows the frame copied when it started, the
 * first one painted at or after `at` (within one frame of it). iOS does not
 * reliably seek a detached, hidden, paused video (KNOWN_ISSUES 057).
 */
const HOLD_SEEK_TIMEOUT_MS = 300;

function even(n: number): number {
  const v = Math.max(0, Math.round(n));
  return v - (v % 2);
}

function pickMime(): string {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}

/**
 * Renders `srcBlob` with an optional crop region and/or trim range applied.
 * Both are optional: with neither, this is a straight re-encode.
 */
export async function exportEditedVideo(
  srcBlob: Blob,
  {
    region = null, trim = null, onProgress,
    maxHeight = null, videoBitsPerSecond, signal, pauseWhenHidden = false, onRenderProgress, drawOverlay, holds, onDiag,
    playbackRate: wantedRate = 1, includeAudio = true,
  }: EditExportOptions = {},
): Promise<EditExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'Recording is not supported in this browser.' };
  }
  if (signal?.aborted) return CANCELLED;

  const url = URL.createObjectURL(srcBlob);
  // Holds only: the Web Audio route for the audio track (closed on every exit).
  let audioCtx: AudioContext | null = null;
  const closeAudio = () => { try { void audioCtx?.close(); } catch { /* noop */ } audioCtx = null; };
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.muted = true; // muted so autoplay/play() is allowed; audio is taken from the stream
  // Slowed sound plays slowed AND lower: pitch correction is off for the exported audio. (Set
  // before any play(); the vendor names cover older Safari / Firefox.)
  if (includeAudio) {
    const pv = video as HTMLVideoElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    pv.preservesPitch = false;
    pv.webkitPreservesPitch = false;
    pv.mozPreservesPitch = false;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not load the recording for export.'));
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) {
      URL.revokeObjectURL(url);
      return CANCELLED;
    }

    // Region defaults to the full frame, so a trim-only export needs no crop box.
    const src = region ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
    const cw = even(src.w);
    const ch = even(src.h);
    const cx = even(src.x);
    const cy = even(src.y);
    if (cw < 2 || ch < 2) {
      URL.revokeObjectURL(url);
      return { ok: false, error: region ? 'Crop region is too small.' : 'The recording has no video frames.' };
    }

    // Clamp the trim to the real clip. A MediaRecorder file can report a
    // non-finite duration, in which case only the in-point is trusted and the
    // render simply runs to the natural end.
    let inPoint = 0;
    let outPoint = Number.POSITIVE_INFINITY;
    if (trim) {
      const dur = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
      inPoint = Math.max(0, Math.min(trim.start, Number.isFinite(dur) ? dur : trim.start));
      outPoint = Math.max(inPoint + 0.1, Math.min(trim.end, dur));
      if (Number.isFinite(dur) && outPoint - inPoint < 0.1) {
        URL.revokeObjectURL(url);
        return { ok: false, error: 'Trimmed clip is too short.' };
      }
    }

    // Output size: the region itself unless `maxHeight` scales it down.
    const out = scaledExportSize(cw, ch, maxHeight);
    const ow = out.width;
    const oh = out.height;

    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { ok: false, error: 'Canvas not available.' };
    }

    // Seek to the in-point BEFORE the recorder starts, so the trimmed head is
    // never encoded. Seeking a just-loaded element can resolve instantly or not
    // at all on a malformed file — time out rather than hang the export.
    const seekToInPoint = async () => {
      if (!(inPoint > 0) && video.currentTime === 0) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        video.onseeked = done;
        setTimeout(done, 4000);
        signal?.addEventListener('abort', done, { once: true });
        try { video.currentTime = inPoint; } catch { done(); }
      });
      video.onseeked = null;
    };
    if (inPoint > 0) {
      onProgress?.('Seeking…');
      await seekToInPoint();
      if (signal?.aborted) {
        URL.revokeObjectURL(url);
        return CANCELLED;
      }
    }

    // Slow motion: find a playbackRate this device really plays at. Each
    // candidate (the asked rate, then each faster export speed) plays for a
    // moment; the media time must move at about that rate. Then back to the
    // in-point. Rate 1 needs no probe.
    let rate = 1;
    if (wantedRate !== 1) {
      onProgress?.('Checking playback speed…');
      rate = 1;
      for (const cand of rateCandidates(wantedRate)) {
        if (cand === 1) { rate = 1; break; }
        if (signal?.aborted) break;
        const t0 = video.currentTime;
        const w0 = performance.now();
        let worked = false;
        try {
          video.playbackRate = cand;
          if (video.playbackRate === cand) {
            await video.play();
            await new Promise<void>((r) => setTimeout(r, RATE_PROBE_MS));
            // A range at the very end of the clip can run out during the probe: it still moved.
            worked = video.ended ? video.currentTime - t0 > 0 : rateWorked(cand, video.currentTime - t0, (performance.now() - w0) / 1000);
          }
        } catch { worked = false; }
        try { video.pause(); } catch { /* noop */ }
        onDiag?.(`speed probe ${cand}× → ${worked ? 'ok' : 'failed'} (moved ${(video.currentTime - t0).toFixed(3)} s in ${((performance.now() - w0) / 1000).toFixed(2)} s, rate reads ${video.playbackRate})`);
        if (worked) { rate = cand; break; }
      }
      video.playbackRate = rate;
      await seekToInPoint();
      if (signal?.aborted) {
        URL.revokeObjectURL(url);
        return CANCELLED;
      }
    }
    /** Every play() sets the rate first: some browsers reset it on pause or seek. */
    const playRated = () => { video.playbackRate = rate; return video.play(); };

    // Holds inside the range, in time order (`index` = position in `holds`).
    const holdList = (holds ?? [])
      .map((h, index) => ({ at: h.at, ms: h.seconds * 1000, index }))
      .filter((h) => Number.isFinite(h.at) && h.ms > 0 && h.at >= inPoint - 1e-3 && h.at < outPoint)
      .sort((a, b) => a.at - b.at || a.index - b.index);
    const totalHoldMs = holdList.reduce((sum, h) => sum + h.ms, 0);

    const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    // Carry the recording's audio (mic/webcam) through, if any (not when the caller turned
    // sound off). The speed does not matter: the element plays at `rate` and its captured
    // audio follows it.
    //
    // DIAGNOSTIC (?vdebug=1 trace): what the source offers, what reached the recorder, what the
    // finished file holds. Answers "why is there no sound" without a phone-side guess.
    let audioInRecorder = 0;
    const audioDiag: string[] = [];
    if (includeAudio) try {
      const vAny = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
        audioTracks?: { length: number };
        mozHasAudio?: boolean;
      };
      const captureFn = vAny.captureStream ?? vAny.mozCaptureStream;
      const srcStream = vAny.captureStream?.() ?? vAny.mozCaptureStream?.();
      const srcAudio = srcStream?.getAudioTracks() ?? [];
      audioDiag.push(
        `source: captureStream ${captureFn ? 'yes' : 'NO (this browser cannot capture a video element\'s sound)'}, ` +
        `captured audio tracks ${srcStream ? srcAudio.length : 'n/a'}, video.audioTracks ${vAny.audioTracks ? vAny.audioTracks.length : 'n/a'}, ` +
        `mozHasAudio ${typeof vAny.mozHasAudio === 'boolean' ? vAny.mozHasAudio : 'n/a'}, element muted ${video.muted}, rate ${rate}, pitch kept ${String((video as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch)}`,
      );
      // With holds: a paused element sends no audio at all, and the recorder
      // closes that gap — everything after a hold would play early by the
      // hold's length (measured: −2 s after two 2 s holds). Through Web Audio
      // the track runs on in real time: silence during a hold, in sync after.
      // Without holds the element's track goes in directly, as before.
      const holdAudio = holdList.length && srcAudio.length ? await realTimeAudio(srcAudio, signal) : null;
      if (holdAudio) { audioCtx = holdAudio.ctx; tracks.push(holdAudio.track); }
      else srcAudio.forEach((t) => tracks.push(t));
      audioInRecorder = tracks.filter((t) => t.kind === 'audio').length;
      audioDiag.push(`recorder: ${audioInRecorder} audio track(s) in the recorded stream (${holdAudio ? 'through Web Audio, holds' : 'direct'})`);
    } catch (e) {
      /* audio optional */
      audioDiag.push(`audio setup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    onDiag?.(includeAudio ? `audio: ${audioDiag.join(' | ')}` : 'audio: not requested (sound switch off)');

    const combined = new MediaStream(tracks);
    const mime = pickMime();

    let recorder: MediaRecorder;
    try {
      // Explicit audio bitrate: every crop/trim is a full re-encode of the audio
      // as well as the video, so leaving the allocation to the UA here quietly
      // added a second generation of loss on top of the capture.
      recorder = new MediaRecorder(combined, {
        mimeType: mime || undefined,
        videoBitsPerSecond: videoBitsPerSecond ?? 5_000_000,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      closeAudio();
      URL.revokeObjectURL(url);
      return { ok: false, error: 'MediaRecorder could not be created.' };
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

    let raf = 0;
    let reachedOutPoint: (() => void) | null = null;
    // Progress span: the trim range, else the clip (unknown length → no progress).
    const progressSpan = Number.isFinite(outPoint)
      ? outPoint - inPoint
      : (Number.isFinite(video.duration) ? video.duration - inPoint : 0);
    // Time spent paused in a hidden tab (pauseWhenHidden) — not part of the clip.
    let pausedMs = 0;
    let pausedAt = 0;

    let nextHold = 0;
    let holdDoneMs = 0;
    let hold: { k: number; startedAt: number; pausedMs0: number; ready: boolean; timer: ReturnType<typeof setTimeout> | null; onSeeked: (() => void) | null } | null = null;
    // The picture a hold shows: copied from the video when the hold starts,
    // replaced by the exact frame if the seek lands. Painted from this copy, so
    // a paused hidden video that drops its frame cannot blank the hold.
    let holdFrame: HTMLCanvasElement | null = null;
    let holdFrameOk = false;
    let framesPainted = 0;
    // After a hold: playback must move again (play() retried, then a clear error).
    let resume: { from: number; since: number; lastPlay: number; pausedMs0: number; k: number } | null = null;
    let failure: string | null = null;
    // The video's frame; with `orLastDrawn`, else the last frame drawn to the output.
    const copyToHoldFrame = (orLastDrawn = false): boolean => {
      const fromVideo = video.readyState >= 2;
      if (!fromVideo && !(orLastDrawn && framesPainted > 0)) return false;
      if (!holdFrame) { holdFrame = document.createElement('canvas'); holdFrame.width = ow; holdFrame.height = oh; }
      const hctx = holdFrame.getContext('2d');
      if (!hctx) return false;
      if (fromVideo) hctx.drawImage(video, cx, cy, cw, ch, 0, 0, ow, oh);
      else hctx.drawImage(canvas, 0, 0);
      return true;
    };
    // Hold time shown so far: running time only (a hidden tab pauses it with the recorder).
    const holdElapsedMs = () => (hold
      ? Date.now() - hold.startedAt - (pausedMs - hold.pausedMs0) - (pausedAt ? Date.now() - pausedAt : 0)
      : 0);
    const startHold = (k: number) => {
      const h = holdList[k];
      // The frame on screen now (at or just past `at`), before anything can lose it.
      const copied = copyToHoldFrame(true);
      holdFrameOk = copied;
      try { video.pause(); } catch { /* noop */ }
      const st = { k, startedAt: Date.now(), pausedMs0: pausedMs, ready: false, timer: null as ReturnType<typeof setTimeout> | null, onSeeked: null as (() => void) | null };
      hold = st;
      resume = null;
      onDiag?.(`hold ${k + 1} start at t=${video.currentTime.toFixed(3)} → seek ${h.at.toFixed(3)}${copied ? '' : ' (no frame to copy)'}`);
      // Until the seek lands or is given up on, the copy is shown (none: the canvas keeps the last good frame).
      const settle = (seeked: boolean) => {
        const late = st.ready;
        st.ready = true;
        if (st.timer) { clearTimeout(st.timer); st.timer = null; }
        const landed = holdSeekLanded(seeked, video.readyState, video.currentTime, h.at) && copyToHoldFrame();
        if (landed) holdFrameOk = true;
        // A 'seeked' after the 300 ms fallback still counts if it lands (no new seek is made).
        if (seeked || landed) { video.removeEventListener('seeked', onSeeked); st.onSeeked = null; }
        if (late && !landed) return;
        onDiag?.(`hold ${k + 1} ${landed ? (late ? 'seeked late' : 'seeked') : seeked ? "seeked but not there" : `seek fallback (no 'seeked' in ${HOLD_SEEK_TIMEOUT_MS} ms)`} t=${video.currentTime.toFixed(3)} rs=${video.readyState}${landed ? '' : ' → holding the last drawn frame'}`);
      };
      const onSeeked = () => settle(true);
      st.onSeeked = onSeeked;
      video.addEventListener('seeked', onSeeked);
      st.timer = setTimeout(() => settle(false), HOLD_SEEK_TIMEOUT_MS);
      try { video.currentTime = h.at; } catch { settle(false); }
    };
    const fail = (msg: string) => { if (!failure) failure = msg; reachedOutPoint?.(); };
    /** play() after a hold; the paint loop calls it again until media time moves. */
    const playAfterHold = (k: number, why: string) => {
      if (resume) resume.lastPlay = Date.now();
      playRated().then(
        () => onDiag?.(`hold ${k} ${why} → play() ok, t=${video.currentTime.toFixed(3)}`),
        (e) => onDiag?.(`hold ${k} ${why} → play() REJECTED: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`.slice(0, 140)),
      );
    };
    const reportProgress = () => {
      if (!onRenderProgress || !(progressSpan > 0)) return;
      // Output timeline: slow motion stretches the media part by 1 / rate.
      if (!holdList.length) { onRenderProgress((video.currentTime - inPoint) / progressSpan); return; }
      // During a hold and until playback moves again, the paused video's clock is not trusted (iOS: 0.000).
      const mediaT = hold ? holdList[hold.k].at : resume ? Math.max(resume.from, video.currentTime) : video.currentTime;
      onRenderProgress(outputProgress((mediaT - inPoint) / rate, (holdDoneMs + holdElapsedMs()) / 1000, progressSpan / rate, totalHoldMs / 1000));
    };
    const paint = (holdIndex: number | null) => {
      // Always the video's CURRENT frame: a slow frame is dropped, never caught up.
      if (video.readyState >= 2) {
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, ow, oh);
        framesPainted++;
        // The video is passed along for a live frame (not a hold's copy): the Metrics export detects the skeleton on it.
        runOverlay(drawOverlay, ctx, video.currentTime, ow, oh, holdIndex, video);
      }
    };
    /** A hold's frame: the copy, at the hold's own time (the paused video's clock is not trusted). */
    const paintHold = (h: { at: number; index: number }) => {
      if (!holdFrame || !holdFrameOk) { paint(h.index); return; }
      ctx.drawImage(holdFrame, 0, 0);
      framesPainted++;
      runOverlay(drawOverlay, ctx, h.at, ow, oh, h.index);
    };
    // Media time once a second (a video whose time stops advancing shows here).
    let diagAt = 0;
    let diagT = -1;
    const diagTick = () => {
      if (!onDiag) return;
      const now = performance.now();
      if (now - diagAt < 1000) return;
      const t = video.currentTime;
      onDiag(`media t=${t.toFixed(3)}${diagT >= 0 ? ` (+${(t - diagT).toFixed(2)} s)` : ''} ${hold ? 'HOLD' : video.paused ? 'PAUSED' : 'playing'} rs=${video.readyState}`);
      diagAt = now; diagT = t;
    };
    const draw = () => {
      diagTick();
      // Metrics export: nothing could be drawn for a while — stop now rather than record nothing.
      if (drawOverlay && framesPainted === 0 && !pausedAt && Date.now() - startedAt - pausedMs >= NO_FRAME_GIVE_UP_MS) {
        onDiag?.(`no frame painted in ${NO_FRAME_GIVE_UP_MS} ms (t=${video.currentTime.toFixed(3)} rs=${video.readyState})`);
        fail(emptyExportError(0, 0, holdList.length) ?? 'Export failed.');
        return;
      }
      if (hold) {
        // Holding: the paused frame is drawn again on every paint so the
        // canvas stream keeps feeding the recorder; then playback continues.
        const h = holdList[hold.k];
        if (hold.ready || holdFrameOk) paintHold(h);
        reportProgress();
        if (holdElapsedMs() >= h.ms) {
          if (hold.timer) clearTimeout(hold.timer);
          if (hold.onSeeked) video.removeEventListener('seeked', hold.onSeeked);
          holdDoneMs += h.ms;
          hold = null;
          nextHold++;
          const k = nextHold;
          // A last-frame hold at the clip's end: nothing left to play.
          if (video.ended && nextHold >= holdList.length) { onDiag?.(`hold ${k} end at the clip's end`); reachedOutPoint?.(); return; }
          // Continue from the hold's time if the video lost its place (seen: t=0.000).
          const back = holdResumeSeek(video.currentTime, h.at);
          if (back !== null) {
            onDiag?.(`hold ${k} end: video at t=${video.currentTime.toFixed(3)}, continuing from ${back.toFixed(3)}`);
            try { video.currentTime = back; } catch { /* play() below still runs */ }
          }
          resume = { from: back ?? video.currentTime, since: Date.now(), lastPlay: 0, pausedMs0: pausedMs, k };
          playAfterHold(k, 'end');
        }
        raf = requestAnimationFrame(draw);
        return;
      }
      if (resume) {
        // Playing again once media time moves; else play() again, then give up clearly.
        if (video.currentTime > resume.from + 0.05 * rate && !video.paused) {
          onDiag?.(`hold ${resume.k}: playing again at t=${video.currentTime.toFixed(3)}`);
          resume = null;
        } else if (!pausedAt) {
          const now = Date.now();
          const action = resumeAction(now - resume.since - (pausedMs - resume.pausedMs0), now - resume.lastPlay);
          if (action === 'fail') { onDiag?.(`hold ${resume.k}: video did not play again (t=${video.currentTime.toFixed(3)} rs=${video.readyState})`); fail(RESUME_FAILED_TEXT); return; }
          if (action === 'retry') playAfterHold(resume.k, 'retry');
        }
      }
      if (nextHold < holdList.length && video.currentTime >= holdList[nextHold].at) {
        startHold(nextHold);
        reportProgress();
        raf = requestAnimationFrame(draw);
        return;
      }
      paint(null);
      reportProgress();
      // Out-point is checked on the paint loop (not `timeupdate`, which fires
      // only ~4x/second and would overshoot the cut by up to a quarter second).
      if (video.currentTime >= outPoint) {
        reachedOutPoint?.();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    onProgress?.(trim ? 'Rendering edit…' : 'Rendering crop…');
    onDiag?.(`render start: in=${inPoint.toFixed(3)} out=${Number.isFinite(outPoint) ? outPoint.toFixed(3) : 'end'} holds=${holdList.length} ${ow}x${oh} rate=${rate}${rate !== wantedRate ? ` (asked ${wantedRate})` : ''}`);
    const startedAt = Date.now();
    recorder.start(250);
    draw();
    // A hold at the in-point has already paused the video: it plays when the hold ends.
    if (!hold) await playRated().catch(() => {});

    let onVisibility: (() => void) | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      reachedOutPoint = done;
      // The clip's end with a hold still to show (a last-frame hold the paint
      // loop had not reached): the loop holds it, seeking back, and the video
      // ends again after it.
      video.onended = () => { if (!hold && nextHold >= holdList.length) done(); };
      signal?.addEventListener('abort', done, { once: true });
      // Failsafe: stop if the video stalls past the length we expect to render
      // (the range plus every hold).
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const spanS = Number.isFinite(outPoint) ? outPoint - inPoint : Math.max(0, dur - inPoint);
      const guardMs = spanS > 0 ? (spanS / rate) * 1000 + 5000 + totalHoldMs : 0;
      if (!pauseWhenHidden) {
        if (guardMs > 0) setTimeout(done, guardMs);
        return;
      }
      // Same failsafe, counting only the time the render was running.
      const activeMs = () => Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0);
      const guard = () => {
        if (settled) return;
        if (guardMs > 0 && !pausedAt && activeMs() >= guardMs) { done(); return; }
        guardTimer = setTimeout(guard, 1000);
      };
      guardTimer = setTimeout(guard, 1000);
      onVisibility = () => {
        if (settled) return;
        if (document.visibilityState === 'hidden' && !pausedAt) {
          pausedAt = Date.now();
          try { video.pause(); } catch { /* noop */ }
          try { if (recorder.state === 'recording') recorder.pause(); } catch { /* noop */ }
        } else if (document.visibilityState === 'visible' && pausedAt) {
          pausedMs += Date.now() - pausedAt;
          pausedAt = 0;
          try { if (recorder.state === 'paused') recorder.resume(); } catch { /* noop */ }
          // During a hold the video stays paused; the paint loop plays it when the hold ends.
          if (!hold) void playRated().catch(() => {});
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      if (document.visibilityState === 'hidden') onVisibility();
    });
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    if (guardTimer) clearTimeout(guardTimer);
    if (pausedAt) { pausedMs += Date.now() - pausedAt; pausedAt = 0; }

    cancelAnimationFrame(raf);
    const lastHold = hold as { timer: ReturnType<typeof setTimeout> | null; onSeeked: (() => void) | null } | null;
    if (lastHold?.timer) clearTimeout(lastHold.timer);
    if (lastHold?.onSeeked) video.removeEventListener('seeked', lastHold.onSeeked);
    try { video.pause(); } catch { /* noop */ }

    if (signal?.aborted || failure) {
      try { recorder.stop(); } catch { /* noop */ }
      canvasStream.getTracks().forEach((t) => t.stop());
      closeAudio();
      URL.revokeObjectURL(url);
      return failure ? { ok: false, error: failure } : CANCELLED;
    }

    const duration = Date.now() - startedAt - pausedMs;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch { /* noop */ }
      try { recorder.stop(); } catch { resolve(); }
    });

    canvasStream.getTracks().forEach((t) => t.stop());
    closeAudio();
    URL.revokeObjectURL(url);

    let result = new Blob(chunks, { type: mime || 'video/webm' });
    // The Metrics export (it always draws an overlay) also refuses a render that
    // painted no frame; other callers (post-recording crop) keep the 0-byte check.
    const empty = drawOverlay
      ? emptyExportError(framesPainted, result.size, holdList.length)
      : (result.size === 0 ? 'Export produced an empty file.' : null);
    if (empty) { onDiag?.(`nothing recorded: ${framesPainted} frames painted, ${result.size} bytes`); return { ok: false, error: empty }; }
    try {
      result = await webmFixDuration(result, duration, mime || 'video/webm');
    } catch { /* noop */ }

    const audioCaptured = includeAudio ? audioInRecorder > 0 : undefined;
    const recordedAudio = await containerAudioTracks(result);
    onDiag?.(`audio: recorded file ${mime || 'webm'} has ${recordedAudio ?? 'an unreadable number of'} audio track(s)`);
    if (/mp4/i.test(mime)) return { ok: true, blob: result, ext: 'mp4', rate, audioCaptured };

    if (signal?.aborted) return CANCELLED;
    onProgress?.('Converting to MP4…');
    const conv = await convertWebmToMp4ForScreenRecord(
      result,
      videoBitsPerSecond !== undefined ? { videoBitsPerSecond } : undefined,
    );
    if (signal?.aborted) return CANCELLED;
    if (conv.ok) {
      onDiag?.(`audio: final mp4 has ${(await containerAudioTracks(conv.blob)) ?? 'an unreadable number of'} audio track(s)`);
      return { ok: true, blob: conv.blob, ext: 'mp4', rate, audioCaptured };
    }
    return { ok: false, error: 'Could not convert the edited recording to MP4.' };
  } catch (e) {
    closeAudio();
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/** Audio tracks in a finished file, from its container bytes (start and end read; no decoding). Null if unreadable. */
async function containerAudioTracks(blob: Blob): Promise<number | null> {
  try {
    const CHUNK = 512 * 1024;
    const head = new Uint8Array(await blob.slice(0, CHUNK).arrayBuffer());
    const headCount = countAudioTracksInContainer(head);
    if (headCount === null || blob.size <= CHUNK) return headCount;
    // A non-fragmented MP4 keeps its track list (moov) at the end.
    const tail = new Uint8Array(await blob.slice(Math.max(CHUNK, blob.size - CHUNK)).arrayBuffer());
    const tailBytes = new Uint8Array(head.length + tail.length);
    tailBytes.set(head, 0);
    tailBytes.set(tail, head.length);
    // The two windows are joined: a track box cannot straddle the join in practice (boxes are small).
    return Math.max(headCount, countAudioTracksInContainer(tailBytes) ?? 0);
  } catch {
    return null;
  }
}

/**
 * Does this clip have sound? Read from a throwaway element (metadata only), so the answer is
 * known before the coach starts an export. 'unknown' when the browser cannot say or the clip
 * does not load within a few seconds: the sound switch is then shown as normal.
 */
export function probeSourceAudio(src: string, timeoutMs = 4000): Promise<SourceAudio> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve('unknown'); return; }
    const v = document.createElement('video') as HTMLVideoElement & {
      audioTracks?: { length: number };
      mozHasAudio?: boolean;
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    let done = false;
    const finish = (r: SourceAudio) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { v.removeAttribute('src'); v.load(); } catch { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.onerror = () => finish('unknown');
    v.onloadedmetadata = () => {
      let captureStreamAudio: number | null = null;
      try {
        const s = v.captureStream?.() ?? v.mozCaptureStream?.();
        if (s) captureStreamAudio = s.getAudioTracks().length;
      } catch { /* noop */ }
      finish(sourceAudioFromProbe({
        audioTracks: v.audioTracks ? v.audioTracks.length : null,
        mozHasAudio: typeof v.mozHasAudio === 'boolean' ? v.mozHasAudio : null,
        captureStreamAudio,
      }));
    };
    v.src = src;
  });
}

/**
 * The source's audio as a real-time Web Audio track: it keeps producing samples
 * (silence) while the source element is paused. Null when Web Audio is missing
 * or cannot start (no user activation) — the caller then uses the source track.
 */
async function realTimeAudio(srcAudio: MediaStreamTrack[], signal?: AbortSignal): Promise<{ ctx: AudioContext; track: MediaStreamTrack } | null> {
  const AC = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AC();
    if (ctx.state !== 'running') {
      // resume() can wait forever without a user gesture: give it half a second.
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
    }
    const track = ctx.state === 'running' && !signal?.aborted ? (() => {
      const dest = ctx!.createMediaStreamDestination();
      ctx!.createMediaStreamSource(new MediaStream(srcAudio)).connect(dest);
      return dest.stream.getAudioTracks()[0] ?? null;
    })() : null;
    if (track) return { ctx, track };
  } catch { /* fall through */ }
  try { void ctx?.close(); } catch { /* noop */ }
  return null;
}

/**
 * Crop-only export. Unchanged signature and behaviour — kept so existing
 * callers (app/analysis/page.tsx) are untouched; it now delegates to the
 * crop+trim renderer rather than carrying its own copy of the pipeline.
 */
export async function exportCroppedVideo(
  srcBlob: Blob,
  region: ExportRegion,
  onProgress?: (msg: string) => void,
): Promise<EditExportResult> {
  return exportEditedVideo(srcBlob, { region, onProgress });
}
