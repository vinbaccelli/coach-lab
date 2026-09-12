/**
 * Camera + controls surface for the Document Picture-in-Picture window.
 *
 * Owned by RecordingContext. Given an already-open Document PiP window it shows
 * the coach a Meet-style control overlay (Pause/Resume + Stop + a live elapsed
 * timer), and ticks the timer with the PiP window's OWN setInterval — which
 * (unlike the opener's timers) is NOT throttled while the opener tab is hidden,
 * so the readout keeps advancing while the coach is in another app.
 *
 * CAMERA IS OPTIONAL AND LIVE-SWAPPABLE.
 * The camera <video> is created ONLY while a stream is actually attached. With
 * no stream there is no video element at all and the window collapses to the
 * control bar — the old build always mounted a flex:1 black <video>, so
 * recording before switching the webcam on showed a large black camera panel
 * with nothing in it. `setCameraStream` attaches/detaches the camera on a
 * running surface (and grows/shrinks the window to match), so turning the
 * webcam on mid-recording updates this window immediately instead of leaving
 * it black until the recording ends.
 *
 * The recorded composite is a SEPARATE headless opener-owned canvas; this window
 * only DISPLAYS the camera, it does not feed the encode.
 *
 * Pure/imperative: no React, no context API. The caller passes the existing
 * pause/stop actions and a duration/state getter; nothing new is exported from
 * the recording context.
 */

export interface PipRecorderSurfaceCallbacks {
  /** Toggle pause/resume (existing pauseRecording). */
  onPause: () => void;
  /** Stop + save (existing stopRecording). */
  onStop: () => void;
  /** Active recording duration in ms (existing activeDurationMs). */
  getDurationMs: () => number;
  /** MediaRecorder state, e.g. 'recording' | 'paused' | 'inactive'. */
  getState: () => string;
}

export interface PipRecorderSurface {
  /**
   * Attach (or replace) the live camera view, or pass null to remove it. The
   * window resizes to match: camera size with a stream, control-bar size
   * without one. Safe to call repeatedly and after teardown (no-op).
   */
  setCameraStream: (stream: MediaStream | null) => void;
  /**
   * Display-only teardown: stops the timer and detaches listeners/stream. Does
   * NOT close the window and does NOT touch the recording.
   */
  teardown: () => void;
}

/** Window geometry — camera view vs. controls only. */
export const PIP_SIZE_WITH_CAMERA = { width: 480, height: 320 };
export const PIP_SIZE_CONTROLS_ONLY = { width: 360, height: 132 };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function styleButton(b: HTMLButtonElement, bg: string) {
  b.style.border = 'none';
  b.style.borderRadius = '6px';
  b.style.padding = '6px 14px';
  b.style.fontSize = '13px';
  b.style.fontWeight = '600';
  b.style.color = '#fff';
  b.style.background = bg;
  b.style.cursor = 'pointer';
}

/**
 * Builds the surface inside `pipWin`. `webcamStream` may be null — that is the
 * controls-only layout, not a black camera box.
 */
export function createPipRecorderSurface(
  pipWin: Window,
  webcamStream: MediaStream | null,
  cb: PipRecorderSurfaceCallbacks,
): PipRecorderSurface {
  const doc = pipWin.document;
  // Clear the startup placeholder (and anything else) before mounting real content.
  doc.body.replaceChildren();
  doc.body.style.margin = '0';
  doc.body.style.background = '#000';
  doc.body.style.position = 'relative';
  doc.body.style.display = 'flex';
  doc.body.style.flexDirection = 'column';
  // The startup placeholder centres its content; the surface must not inherit
  // that or the controls-only layout floats in the middle of the window.
  doc.body.style.alignItems = 'stretch';
  doc.body.style.justifyContent = 'flex-start';
  doc.body.style.height = '100vh';
  doc.body.style.overflow = 'hidden';
  doc.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Control bar — Meet-style overlay along the bottom when a camera is showing;
  // the whole (small) window when there is no camera.
  const bar = doc.createElement('div');
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.gap = '10px';
  bar.style.padding = '8px 12px';
  bar.style.background = 'rgba(0,0,0,0.9)';
  bar.style.color = '#fff';

  const dot = doc.createElement('span');
  dot.style.width = '10px';
  dot.style.height = '10px';
  dot.style.borderRadius = '50%';
  dot.style.background = '#FF3B30';
  dot.style.flex = '0 0 auto';

  const timer = doc.createElement('span');
  timer.style.fontSize = '14px';
  timer.style.fontWeight = '700';
  timer.style.fontVariantNumeric = 'tabular-nums';
  timer.style.minWidth = '44px';
  timer.textContent = '0:00';

  const spacer = doc.createElement('span');
  spacer.style.flex = '1 1 auto';

  const pauseBtn = doc.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.textContent = 'Pause';
  styleButton(pauseBtn, '#333');
  pauseBtn.addEventListener('click', cb.onPause);

  const stopBtn = doc.createElement('button');
  stopBtn.type = 'button';
  stopBtn.textContent = 'Stop';
  styleButton(stopBtn, '#FF3B30');
  stopBtn.addEventListener('click', cb.onStop);

  bar.appendChild(dot);
  bar.appendChild(timer);
  bar.appendChild(spacer);
  bar.appendChild(pauseBtn);
  bar.appendChild(stopBtn);
  doc.body.appendChild(bar);

  /** Live camera element — exists ONLY while a stream is attached. */
  let cam: HTMLVideoElement | null = null;
  let destroyed = false;

  const resizeWindow = (size: { width: number; height: number }) => {
    // Document PiP windows are script-resizable, but the browser may clamp or
    // refuse; a failed resize must never break the surface or the recording.
    try { pipWin.resizeTo(size.width, size.height); } catch { /* clamped or refused */ }
  };

  const applyLayout = () => {
    if (cam) {
      // Camera fills the window; the bar floats over its bottom edge.
      bar.style.position = 'absolute';
      bar.style.left = '0';
      bar.style.right = '0';
      bar.style.bottom = '0';
      bar.style.flex = '0 0 auto';
    } else {
      // No camera: the bar IS the window. No black video region.
      bar.style.position = 'static';
      bar.style.left = '';
      bar.style.right = '';
      bar.style.bottom = '';
      bar.style.flex = '1 1 auto';
    }
  };

  const setCameraStream = (stream: MediaStream | null) => {
    if (destroyed) return;
    if (!stream) {
      if (cam) {
        try { cam.srcObject = null; } catch { /* noop */ }
        try { cam.remove(); } catch { /* noop */ }
        cam = null;
        applyLayout();
        resizeWindow(PIP_SIZE_CONTROLS_ONLY);
      }
      return;
    }
    const hadCamera = cam != null;
    if (!cam) {
      cam = doc.createElement('video');
      cam.autoplay = true;
      // Display-only mute (unmuted autoplay is blocked in a Document PiP document,
      // same as anywhere else). It has no effect on the recording's audio, which
      // is assembled separately from the raw streams in RecordingContext.tsx.
      cam.muted = true;
      cam.playsInline = true;
      cam.style.flex = '1 1 auto';
      cam.style.minHeight = '0';
      cam.style.width = '100%';
      cam.style.objectFit = 'cover';
      cam.style.background = '#000';
      // Before the bar so the absolutely-positioned bar paints on top.
      doc.body.insertBefore(cam, bar);
      applyLayout();
    }
    cam.srcObject = stream;
    // play() must run AFTER the element is attached to the PiP document — calling
    // it pre-append is the known cause of a black-but-live display video in a
    // Document PiP window (srcObject attached, stream live, but nothing rendered).
    cam.play().catch((err) => console.warn('[pipRecorderSurface] camera play failed:', err));
    // Grow to the camera size only on the transition, so a coach who resized the
    // window by hand is not fought on every stream swap.
    if (!hadCamera) resizeWindow(PIP_SIZE_WITH_CAMERA);
  };

  applyLayout();
  setCameraStream(webcamStream);

  const tick = () => {
    timer.textContent = formatTime(Math.floor(cb.getDurationMs() / 1000));
    const paused = cb.getState() === 'paused';
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    dot.style.background = paused ? '#FFCC00' : '#FF3B30';
  };
  tick();
  // PiP window's own timer — survives the opener tab being hidden.
  const intervalId = pipWin.setInterval(tick, 500);

  return {
    setCameraStream,
    teardown: () => {
      destroyed = true;
      try { pipWin.clearInterval(intervalId); } catch { /* window may be closing */ }
      try { pauseBtn.removeEventListener('click', cb.onPause); } catch { /* noop */ }
      try { stopBtn.removeEventListener('click', cb.onStop); } catch { /* noop */ }
      try { if (cam) cam.srcObject = null; } catch { /* noop */ }
    },
  };
}
