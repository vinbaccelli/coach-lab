'use client';

/**
 * Global screen-recording engine. Mounted once in app/layout.tsx (survives ALL
 * route navigations) so a recording started in the Recording Hub keeps running
 * while the coach moves to the control panel, players, or any other page —
 * with the floating Play/Pause/Stop + timer widget (FloatingRecordingIndicator)
 * following everywhere.
 *
 * This replaces both (a) the dormant canvas-composite engine that previously
 * lived here (its registerCompositeCanvas had zero callers) and (b) the
 * page-owned <ScreenRecorder mode="display"> instance on /analysis whose
 * unmount killed the capture on navigation.
 *
 * Sources (webcam/mic getters) are registered by the analysis page; the engine
 * snapshots the actual tracks at start() time, so the getters going stale after
 * a route change is harmless. Finished recordings land in `completedRecording`
 * — the analysis page consumes it (crop/save modal) whenever it is (re)mounted.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';
import { stopAllTracks } from '@/lib/tabCaptureRecording';
import { createPipRecorderSurface } from '@/lib/pipRecorderSurface';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecordingSources {
  getWebcamStream: () => MediaStream | null;
  getMicStream: () => MediaStream | null;
  /**
   * Fired when the coach closes the floating PiP window mid-recording, which
   * turns Source B off. Lets the page flip its own webcamActive/UI state so the
   * Hub toggle stops claiming "Webcam on". Optional — existing callers that
   * omit it are unaffected.
   */
  onWebcamClosedByPip?: () => void;
}

export interface CompletedRecording {
  blob: Blob;
  ext: string;
}

interface RecordingContextValue {
  recState: RecordingState;
  elapsed: number;
  error: string | null;
  progress: string | null;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  stopRecording: () => Promise<void>;
  /** Analysis page registers its webcam/mic getters here (null to unregister). */
  registerRecordingSources: (sources: RecordingSources | null) => void;
  /** Finished recording awaiting a consumer (analysis page crop/save modal). */
  completedRecording: CompletedRecording | null;
  clearCompletedRecording: () => void;
  // ── Legacy surface kept for PersistentWebcamOverlay ──────────────────────
  webcamStream: MediaStream | null;
  registerWebcamVideo: (el: HTMLVideoElement | null) => void;
  /** Pushes a fresh webcam stream into an already-active recording's Source B region (null to stop drawing it). */
  updateWebcamStream: (stream: MediaStream | null) => void;
  /** True while a Document PiP window is open for the active recording. */
  isPipOpen: () => boolean;
  /**
   * Re-opens a Document PiP window for an ALREADY-RUNNING recording whose PiP
   * was closed. MUST be called from a fresh user gesture. Resolves true if a
   * window opened, false if it was unnecessary or requestWindow rejected —
   * never throws, and never disturbs the recording either way.
   */
  reopenPipWindow: () => Promise<boolean>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

function getBestMimeType(): string {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
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

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [completedRecording, setCompletedRecording] = useState<CompletedRecording | null>(null);

  const sourcesRef = useRef<RecordingSources | null>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoElRef = useRef<HTMLVideoElement | null>(null);
  const docPipWindowRef = useRef<Window | null>(null);
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef('video/webm');
  const rafPaintRef = useRef<number | null>(null);
  const paintBackupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFinishedRef = useRef(false);
  // Pause-aware duration accounting: activeMs = now - start - pausedTotal.
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  // Document PiP recorder surface (Candidate C). pipRafRef lives in the PiP
  // window's OWN rAF id-space — never cancel it with the opener's
  // cancelAnimationFrame (and vice versa).
  const pipRafRef = useRef<number | null>(null);
  const pipSurfaceTeardownRef = useRef<null | (() => void)>(null);
  // Latest pause/stop actions for the PiP controls — kept in refs so
  // startRecording (declared above pauseRecording/stopRecording) can wire them
  // without a TDZ in its dependency array.
  const pauseRecordingRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  // Set by startRecording to the CURRENT session's PiP-attach closure (painter +
  // surface + pagehide wiring, all bound to that session's paintOnce). The
  // reopen path calls this so it reuses the proven attach logic verbatim rather
  // than duplicating it. Cleared by cleanupAux when the session ends.
  const attachPipWindowRef = useRef<null | ((pw: Window, stream: MediaStream | null) => void)>(null);

  const registerRecordingSources = useCallback((sources: RecordingSources | null) => {
    sourcesRef.current = sources;
  }, []);

  const clearCompletedRecording = useCallback(() => setCompletedRecording(null), []);

  /** Legacy no-op kept so PersistentWebcamOverlay compiles/behaves (it hides itself when webcamStream is null). */
  const registerWebcamVideo = useCallback((_el: HTMLVideoElement | null) => {}, []);

  /**
   * Pushes a fresh webcam stream into an already-running recording's Source B
   * region (null to stop drawing it) — e.g. the Hub's webcam toggle re-enabling
   * the camera after a PiP-close turned it off. paintOnce reads
   * webcamVideoElRef.current live, so the very next frame picks this up.
   * Does not touch captureStream / MediaRecorder / the display stream.
   */
  const updateWebcamStream = useCallback((stream: MediaStream | null) => {
    const prev = webcamVideoElRef.current;
    if (prev) { try { prev.srcObject = null; } catch { /* noop */ } }
    if (!stream) { webcamVideoElRef.current = null; return; }
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    webcamVideoElRef.current = v;
    v.play().catch((err) => console.warn('[RecordingProvider] updateWebcamStream play failed:', err));
  }, []);

  const isPipOpen = useCallback(() => docPipWindowRef.current != null, []);

  /**
   * Re-opens the floating PiP for a recording that is still running but whose
   * window the coach closed. No-op (returns false) when there is no active
   * recording, when a window is already open, or when Document PiP is
   * unsupported. requestWindow needs transient user activation, so the caller
   * must invoke this directly from a click handler.
   */
  const reopenPipWindow = useCallback(async (): Promise<boolean> => {
    const attach = attachPipWindowRef.current;
    if (!attach) return false;                                   // no active session
    if (docPipWindowRef.current) return false;                   // already open — leave it alone
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return false;
    const docPip = (window as Window & { documentPictureInPicture?: { requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window> } }).documentPictureInPicture;
    if (!docPip?.requestWindow) return false;
    let pw: Window;
    try {
      pw = await docPip.requestWindow({ width: 480, height: 320 });
    } catch (err) {
      // Most likely cause is lost transient activation (see reopen notes in the
      // Hub toggle). Surface it, but never disturb the running recording.
      console.warn('[RecordingProvider] reopenPipWindow: requestWindow rejected:', err);
      return false;
    }
    attach(pw, sourcesRef.current?.getWebcamStream() ?? null);
    return true;
  }, []);

  const activeDurationMs = useCallback(() => {
    const pausedExtra = pausedAtRef.current != null ? Date.now() - pausedAtRef.current : 0;
    return Math.max(0, Date.now() - startTimeRef.current - pausedTotalRef.current - pausedExtra);
  }, []);

  const cleanupAux = useCallback(() => {
    attachPipWindowRef.current = null; // session over — no reopening into a dead paintOnce
    // PiP paint loop lives in the PiP window's rAF id-space — cancel it there.
    if (pipRafRef.current != null) {
      try { docPipWindowRef.current?.cancelAnimationFrame(pipRafRef.current); } catch { /* window may be gone */ }
      pipRafRef.current = null;
    }
    try { pipSurfaceTeardownRef.current?.(); } catch { /* noop */ }
    pipSurfaceTeardownRef.current = null;
    if (rafPaintRef.current != null) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }
    if (paintBackupRef.current) { clearInterval(paintBackupRef.current); paintBackupRef.current = null; }
    if (displayVideoRef.current) { displayVideoRef.current.srcObject = null; displayVideoRef.current = null; }
    if (webcamVideoElRef.current) { webcamVideoElRef.current.srcObject = null; webcamVideoElRef.current = null; }
    stopAllTracks(displayStreamRef.current);
    displayStreamRef.current = null;
    try { docPipWindowRef.current?.close(); } catch { /* noop */ }
    docPipWindowRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    streamRef.current = null;
    recCanvasRef.current = null;
  }, []);

  const deliverRecording = useCallback(async (rawBlob: Blob, durationMs: number) => {
    if (rawBlob.size === 0) {
      setError('Recording produced an empty file. Try again.');
      cleanupAux();
      setRecState('idle');
      saveFinishedRef.current = true;
      return;
    }

    let fixedBlob: Blob = rawBlob;
    try {
      fixedBlob = await webmFixDuration(rawBlob, durationMs, mimeTypeRef.current || 'video/webm');
    } catch (fixErr) {
      console.warn('[RecordingProvider] webmFixDuration skipped:', fixErr);
    }

    let outBlob: Blob = fixedBlob;
    let outExt = 'mp4';
    const looksMp4 = outBlob.type.includes('mp4') || /mp4/i.test(mimeTypeRef.current);
    if (!looksMp4) {
      try {
        setProgress('Converting to MP4…');
        const conv = await convertWebmToMp4ForScreenRecord(fixedBlob);
        setProgress(null);
        if (conv.ok) {
          outBlob = conv.blob;
        } else {
          // Deliver the WebM rather than losing the capture.
          outExt = 'webm';
        }
      } catch {
        setProgress(null);
        outExt = 'webm';
      }
    }

    // Hand off to the analysis page (crop/save modal). If the coach stopped
    // while on another page, this waits in state until /analysis remounts.
    setCompletedRecording({ blob: outBlob, ext: outExt });

    cleanupAux();
    setRecState('idle');
    setElapsed(0);
    saveFinishedRef.current = true;
  }, [cleanupAux]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return; // already running
    setError(null);
    setProgress(null);
    setElapsed(0);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen recording is not supported in this browser.');
      return;
    }

    // Open the Document PiP window FIRST, on this same user gesture, BEFORE the
    // getDisplayMedia await (proven: requestWindow() then getDisplayMedia() both
    // succeed on one gesture). The visible PiP window is what keeps the recording
    // painting un-throttled while the coach is in another app. If unsupported or
    // it throws, pipWin stays null → the opener-timer fallback path.
    const docPip = (window as Window & { documentPictureInPicture?: { requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window> } }).documentPictureInPicture;
    let pipWin: Window | null = null;
    if (docPip?.requestWindow) {
      try {
        pipWin = await docPip.requestWindow({ width: 480, height: 320 });
        docPipWindowRef.current = pipWin;
        // Lightweight placeholder during the user-paced getDisplayMedia picker gap,
        // so the window is not blank. Removed by createPipRecorderSurface's
        // doc.body.replaceChildren() once real content mounts. On share-cancel the
        // window is closed below, taking this with it (no orphan).
        const pdoc = pipWin.document;
        pdoc.body.style.margin = '0';
        pdoc.body.style.height = '100vh';
        pdoc.body.style.display = 'flex';
        pdoc.body.style.alignItems = 'center';
        pdoc.body.style.justifyContent = 'center';
        pdoc.body.style.background = '#000';
        pdoc.body.style.color = 'rgba(255,255,255,0.85)';
        pdoc.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        pdoc.body.style.fontSize = '14px';
        const ph = pdoc.createElement('div');
        ph.textContent = 'Starting recording…';
        pdoc.body.appendChild(ph);
      } catch { pipWin = null; }
    }

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } } as MediaTrackConstraints,
        audio: false,
      });
    } catch (e) {
      // No orphan window: close any PiP we opened for this cancelled attempt.
      try { pipWin?.close(); } catch { /* noop */ }
      docPipWindowRef.current = null;
      if (e instanceof DOMException && e.name === 'NotAllowedError') return; // user cancelled
      setError('Could not start screen capture.');
      return;
    }
    displayStreamRef.current = displayStream;

    // Entire-screen ('monitor') share already contains the floating PiP window (the
    // coach's camera), so stamping Source B too would double it. Skip the stamp in
    // that mode only. undefined => false (keep stamp) — monitor is the special case.
    const displaySettings = displayStream.getVideoTracks()[0]?.getSettings() as
      | (MediaTrackSettings & { displaySurface?: string })
      | undefined;
    const isMonitor = displaySettings?.displaySurface === 'monitor';

    const displayVideo = document.createElement('video');
    displayVideo.muted = true;
    displayVideo.playsInline = true;
    displayVideo.srcObject = displayStream;
    displayVideoRef.current = displayVideo;
    await displayVideo.play().catch(() => {});

    // Snapshot webcam/mic tracks NOW — getters may go stale after navigation.
    // The webcam is drawn into the recorded composite as a region (Source B). The
    // PiP window separately shows the coach a clean camera view (see
    // createPipRecorderSurface) — that display is NOT this encode composite.
    const webcamStream = sourcesRef.current?.getWebcamStream() ?? null;
    // webcamVideoElRef (not a local var) is what paintOnce reads and what
    // updateWebcamStream writes — a stale value from a prior session/call must
    // not leak into this one.
    webcamVideoElRef.current = null;
    if (webcamStream) {
      const webcamVideo = document.createElement('video');
      webcamVideo.muted = true;
      webcamVideo.playsInline = true;
      webcamVideo.srcObject = webcamStream;
      webcamVideoElRef.current = webcamVideo;
      await webcamVideo.play().catch(() => {});
    }

    const rawW = Math.max(640, displayVideo.videoWidth || 1920);
    const rawH = Math.max(360, displayVideo.videoHeight || 1080);
    const downscale = Math.min(1, 1280 / Math.max(rawW, rawH));
    const outW = Math.round(rawW * downscale);
    const outH = Math.round(rawH * downscale);
    // Origin document = OPENER (verified empirically): the capture track's
    // lifetime follows its origin doc, so an opener-origin canvas survives the
    // PiP window closing. recCanvas stays opener-owned and DETACHED (never appended
    // anywhere); the PiP window's own rAF still paints it un-throttled while the
    // opener is hidden — the PiP now displays a separate camera view, not recCanvas.
    const recCanvas = document.createElement('canvas');
    recCanvas.width = outW;
    recCanvas.height = outH;
    recCanvasRef.current = recCanvas;
    const ctx = recCanvas.getContext('2d')!;

    const paintOnce = () => {
      // Read live each frame — updateWebcamStream (Hub toggle re-enable) and the
      // PiP pagehide handler both write this ref, so the very next paint call
      // reflects whichever stream is currently assigned.
      const webcamVideo = webcamVideoElRef.current;
      // The whole body is guarded: an exception escaping paintOnce stops the rAF
      // path from ever rescheduling (loop() only re-arms AFTER paintOnce
      // returns), which would freeze the recording permanently. No draw here is
      // worth killing the painter over — skip the bad frame and keep going.
      try {
        if (displayVideo.readyState >= 2 && displayVideo.videoWidth > 0 && displayVideo.videoHeight > 0) {
          ctx.drawImage(displayVideo, 0, 0, outW, outH);
        }
        // Source B stamp — skipped in monitor mode (the screen grab already shows the
        // floating camera window there; stamping again would double the webcam).
        // readyState AND non-zero dimensions: a freshly created <video> (e.g. from
        // updateWebcamStream) can be briefly undecodable, and drawImage on a
        // zero-dimension source throws InvalidStateError.
        if (
          !isMonitor &&
          webcamVideo &&
          webcamVideo.readyState >= 2 &&
          webcamVideo.videoWidth > 0 &&
          webcamVideo.videoHeight > 0
        ) {
          const pipW = Math.round(outW * 0.22);
          const pipH = Math.round(pipW * (9 / 16));
          const margin = Math.round(outW * 0.02);
          const px = outW - pipW - margin;
          const py = outH - pipH - margin;
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(px - 4, py - 4, pipW + 8, pipH + 8);
          ctx.drawImage(webcamVideo, px, py, pipW, pipH);
        }
      } catch { /* bad frame — skip it, keep the painter alive */ }
    };
    paintOnce();
    // captureStream is called on the opener-origin recCanvas. recCanvas is never
    // adopted into the PiP window (the PiP shows a separate camera view), so its
    // origin document stays the opener and the track survives the window closing.
    streamRef.current = (recCanvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    // Attaches a PiP window to THIS session: painter + surface + pagehide wiring.
    // Used both for the window opened at recording start and for any window the
    // Hub's webcam toggle re-opens later (reopenPipWindow), so both are identical
    // by construction — including the close contract.
    const attachPipWindow = (pw: Window, camStream: MediaStream | null) => {
      docPipWindowRef.current = pw;
      // Exactly ONE painter: the opener fallback timer (started on a previous
      // pagehide) must stop before the PiP rAF takes over, or both would paint.
      if (paintBackupRef.current) { clearInterval(paintBackupRef.current); paintBackupRef.current = null; }
      // PiP path: the PiP window's OWN rAF drives paintOnce. It runs ~60fps even
      // while the opener tab is hidden (empirically verified), so the recording
      // never throttles as long as the window is open.
      const loop = () => { paintOnce(); pipRafRef.current = pw.requestAnimationFrame(loop); };
      pipRafRef.current = pw.requestAnimationFrame(loop);
      // Camera + controls + live timer inside the PiP window, wired to the existing API.
      try { pipSurfaceTeardownRef.current?.(); } catch { /* noop */ }
      pipSurfaceTeardownRef.current = createPipRecorderSurface(pw, camStream, {
        onPause: () => pauseRecordingRef.current(),
        onStop: () => { void stopRecordingRef.current(); },
        getDurationMs: () => activeDurationMs(),
        getState: () => recorderRef.current?.state ?? 'inactive',
      });
      // CORE RULE: closing the PiP window turns the webcam region OFF ONLY — it
      // MUST NOT stop the recording. recCanvas stays opener-owned throughout (it is
      // never adopted into the PiP now), so its captureStream survives the window
      // teardown inherently; fall back to the opener-driven painter (which throttles
      // to ~1fps while hidden and recovers when the AM tab is foregrounded — accepted
      // degradation).
      pw.addEventListener('pagehide', () => {
        webcamVideoElRef.current = null; // stop drawing Source B — camera off
        pipRafRef.current = null; // PiP rAF is dead with the window
        if (!paintBackupRef.current) paintBackupRef.current = setInterval(paintOnce, 33);
        try { pipSurfaceTeardownRef.current?.(); } catch { /* noop */ }
        pipSurfaceTeardownRef.current = null;
        docPipWindowRef.current = null;
        // Tell the page the camera went off so the Hub toggle stops showing
        // "Webcam on". Display-state only — recording is untouched.
        try { sourcesRef.current?.onWebcamClosedByPip?.(); } catch { /* noop */ }
        // Deliberately does NOT call stopRecording / stop the MediaRecorder /
        // tear down the display stream — recording continues.
      }, { once: true });
    };
    attachPipWindowRef.current = attachPipWindow;

    // Exactly ONE painter per path.
    if (pipWin) {
      attachPipWindow(pipWin, webcamStream);
    } else {
      // Fallback path (no Document PiP): off-DOM opener canvas + the Fix B timer.
      // rAF is intentionally not used — it throttles to ~0 fps in hidden tabs;
      // the timer keeps frames flowing (byte-for-byte today's behavior).
      paintBackupRef.current = setInterval(paintOnce, 33);
    }

    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];
    const micStream = sourcesRef.current?.getMicStream() ?? null;
    if (micStream) {
      micStream.getAudioTracks().forEach((t) => { if (t.enabled) tracks.push(t); });
    } else if (webcamStream) {
      webcamStream.getAudioTracks().forEach((t) => { if (t.enabled) tracks.push(t); });
    }

    const combined = new MediaStream(tracks);
    const mimeType = getBestMimeType();
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combined, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 5_000_000,
      });
    } catch {
      cleanupAux();
      setError('MediaRecorder not supported in this browser.');
      return;
    }

    // User ended capture from the browser chrome → stop + save through our path.
    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try { rec.requestData(); } catch { /* noop */ }
        rec.stop();
        setRecState('stopped');
      }
    });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      try {
        if (stopFailsafeRef.current) { clearTimeout(stopFailsafeRef.current); stopFailsafeRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        saveFinishedRef.current = false;
        const duration = activeDurationMs();
        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
        await deliverRecording(rawBlob, duration);
      } catch (fatal: unknown) {
        console.error('[RecordingProvider] onstop failed:', fatal);
        cleanupAux();
        setRecState('idle');
        saveFinishedRef.current = true;
      }
    };

    recorder.start(250);
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    pausedAtRef.current = null;
    pausedTotalRef.current = 0;
    setRecState('recording');
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor(activeDurationMs() / 1000));
    }, 500);
  }, [activeDurationMs, cleanupAux, deliverRecording]);

  const pauseRecording = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') {
      try { mr.pause(); } catch { return; }
      pausedAtRef.current = Date.now();
      setRecState('paused');
    } else if (mr.state === 'paused') {
      try { mr.resume(); } catch { return; }
      if (pausedAtRef.current != null) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      setRecState('recording');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    // Resume first so the final chunk flushes correctly from a paused state.
    if (recorder.state === 'paused') {
      try { recorder.resume(); } catch { /* noop */ }
      if (pausedAtRef.current != null) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
    }
    try { recorder.requestData(); } catch { /* noop */ }
    recorder.stop();
    setRecState('stopped');

    // Failsafe if onstop never completes.
    if (stopFailsafeRef.current) clearTimeout(stopFailsafeRef.current);
    stopFailsafeRef.current = setTimeout(() => {
      stopFailsafeRef.current = null;
      if (saveFinishedRef.current) return;
      const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
      if (rawBlob.size === 0) { setRecState('idle'); return; }
      void deliverRecording(rawBlob, activeDurationMs());
    }, 55_000);
  }, [activeDurationMs, deliverRecording]);

  // Keep the PiP controls pointing at the latest pause/stop actions without
  // putting them in startRecording's dependency array (they are declared after it).
  useEffect(() => {
    pauseRecordingRef.current = pauseRecording;
    stopRecordingRef.current = stopRecording;
  }, [pauseRecording, stopRecording]);

  // Full page unload only (the provider never unmounts on route changes).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopFailsafeRef.current) clearTimeout(stopFailsafeRef.current);
      cleanupAux();
    };
  }, [cleanupAux]);

  return (
    <RecordingContext.Provider
      value={{
        recState,
        elapsed,
        error,
        progress,
        startRecording,
        pauseRecording,
        stopRecording,
        registerRecordingSources,
        completedRecording,
        clearCompletedRecording,
        webcamStream: null,
        registerWebcamVideo,
        updateWebcamStream,
        isPipOpen,
        reopenPipWindow,
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error('useRecording must be used within RecordingProvider');
  return ctx;
}
