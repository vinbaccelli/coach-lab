/**
 * Camera + controls surface for the Document Picture-in-Picture window.
 *
 * Owned by RecordingContext. Given an already-open Document PiP window and the
 * live webcam stream, this shows the coach a cleanly framed camera view with a
 * Meet-style control overlay (Pause/Resume + Stop + a live elapsed timer), and
 * ticks the timer with the PiP window's OWN setInterval — which (unlike the
 * opener's timers) is NOT throttled while the opener tab is hidden, so the
 * readout keeps advancing while the coach is in another app.
 *
 * The recorded composite is a SEPARATE headless opener-owned canvas; this window
 * only DISPLAYS the camera, it does not feed the encode. webcamStream === null
 * (screen-only) shows a dark camera region with the identical control layout.
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
 * Builds the surface inside `pipWin`. Returns a teardown that clears the PiP
 * timer and detaches the control listeners. Does NOT close the window and does
 * NOT touch the recording — teardown is display-only.
 */
export function createPipRecorderSurface(
  pipWin: Window,
  webcamStream: MediaStream | null,
  cb: PipRecorderSurfaceCallbacks,
): () => void {
  const doc = pipWin.document;
  // Clear the startup placeholder (and anything else) before mounting real content.
  doc.body.replaceChildren();
  doc.body.style.margin = '0';
  doc.body.style.background = '#000';
  doc.body.style.position = 'relative';
  doc.body.style.display = 'flex';
  doc.body.style.flexDirection = 'column';
  doc.body.style.height = '100vh';
  doc.body.style.overflow = 'hidden';
  doc.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Framed live camera — what the coach sees. This is NOT the recorded composite
  // (that is a headless opener-owned canvas). Screen-only recordings (no webcam)
  // leave this region a plain dark background; the control layout is identical.
  // muted here is display-only (unmuted autoplay is blocked in a Document PiP
  // document, same as anywhere else) — it has no effect on the recording's audio,
  // which is assembled separately from the raw streams in RecordingContext.tsx.
  const cam = doc.createElement('video');
  cam.autoplay = true;
  cam.muted = true;
  cam.playsInline = true;
  cam.style.flex = '1 1 auto';
  cam.style.minHeight = '0';
  cam.style.width = '100%';
  cam.style.objectFit = 'cover';
  cam.style.background = '#000';
  if (webcamStream) cam.srcObject = webcamStream;
  doc.body.appendChild(cam);
  // play() must run AFTER the element is attached to the PiP document — calling it
  // pre-append is the known cause of a black-but-live display video in a Document
  // PiP window (srcObject attached, stream live, but nothing ever rendered).
  if (webcamStream) {
    cam.play().catch((err) => console.warn('[pipRecorderSurface] camera play failed:', err));
  }

  // Control bar — Meet-style semi-transparent overlay along the bottom of the video.
  const bar = doc.createElement('div');
  bar.style.position = 'absolute';
  bar.style.left = '0';
  bar.style.right = '0';
  bar.style.bottom = '0';
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

  const tick = () => {
    timer.textContent = formatTime(Math.floor(cb.getDurationMs() / 1000));
    const paused = cb.getState() === 'paused';
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    dot.style.background = paused ? '#FFCC00' : '#FF3B30';
  };
  tick();
  // PiP window's own timer — survives the opener tab being hidden.
  const intervalId = pipWin.setInterval(tick, 500);

  return () => {
    try { pipWin.clearInterval(intervalId); } catch { /* window may be closing */ }
    try { pauseBtn.removeEventListener('click', cb.onPause); } catch { /* noop */ }
    try { stopBtn.removeEventListener('click', cb.onStop); } catch { /* noop */ }
    try { cam.srcObject = null; } catch { /* noop */ }
  };
}
