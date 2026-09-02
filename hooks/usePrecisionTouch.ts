'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * usePrecisionTouch — the precision-touch interaction, as a reusable hook.
 *
 * WHAT PRECISION TOUCH IS
 * A coach working one-handed on a phone cannot place a point accurately, because
 * the finger covers the target. Precision mode fixes that: hold one finger and a
 * crosshair appears OFFSET ABOVE it, the anchor finger steers the crosshair, and
 * a tap with a second finger commits at the crosshair rather than under the
 * finger.
 *
 * WHY A HOOK
 * `components/Canvas.tsx` already implements all of this, but woven through its
 * own pointer pipeline and drawing model — its commit path encodes per-tool
 * semantics (pen dabs, two-step drag tools, multi-step state machines) that mean
 * nothing to another canvas. This hook owns the parts that are genuinely generic
 * — the anchor state machine, the crosshair geometry, the hold-to-activate
 * timer, and the browser-gesture prevention — and leaves the commit to the
 * caller via `onCommit`.
 *
 * COORDINATE SPACES
 * The hook works in CLIENT pixels internally and hands the caller points in
 * whatever space `clientToLocal` maps to, so it adapts to a consumer's own zoom
 * and pan without knowing anything about them.
 *
 * NOTE ON Canvas.tsx
 * Canvas.tsx deliberately does NOT use this hook yet. Its implementation is
 * proven in the field and this repo has no test runner and no way to exercise
 * the auth-gated analysis route, so a refactor of it could not be verified.
 * Migrating it is a follow-up, once there is a way to prove the swap is
 * behaviour-preserving. Until then, keep the two in step: the constants below
 * are the shared source of truth for the tuned values.
 */

/** Crosshair offset above the finger, as a fraction of canvas height. */
export const PRECISION_CURSOR_OFFSET_RATIO = 0.12;
/** Still-hold duration (ms) that activates precision mode without a toolbar tap. */
export const PRECISION_HOLD_MS = 2000;
/** Finger travel (px) that cancels a pending hold — past this it is a drag. */
export const PRECISION_HOLD_SLOP_PX = 10;
/** How long the crosshair lingers after the anchor finger lifts. */
export const PRECISION_CURSOR_FADE_MS = 220;

export type PrecisionPoint = { x: number; y: number };

export type UsePrecisionTouchOptions<P extends PrecisionPoint> = {
  /**
   * Master switch. When false the hook is inert: no listeners, no timers, and
   * every handler returns false so the caller's own pipeline is untouched. This
   * is the seam a feature flag turns off.
   */
  enabled: boolean;
  /** Precision mode is currently ACTIVE (crosshair live). Distinct from `enabled`. */
  active: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Map a client point into the consumer's own space (zoom/pan applied there). */
  clientToLocal: (clientX: number, clientY: number) => P;
  /** May a still hold arm precision right now? Usually a tool-eligibility check. */
  isHoldEligible?: () => boolean;
  /** Hold completed on a still finger — caller should switch precision mode on. */
  onActivate?: () => void;
  /** Second finger tapped — commit at this point, in the caller's space. */
  onCommit?: (point: P) => void;
  /** Called whenever the crosshair moves, so an imperative renderer can repaint. */
  onChange?: () => void;
};

export type PrecisionTouchApi<P extends PrecisionPoint> = {
  /** Live crosshair position in the caller's space, or null when not showing. */
  crosshairRef: React.MutableRefObject<P | null>;
  /** True while an anchor finger owns the gesture. */
  anchorActiveRef: React.MutableRefObject<boolean>;
  /**
   * Merge these into the consumer's own handlers. Each returns TRUE when the
   * hook consumed the event and the caller must not run its own logic for it.
   */
  onPointerDown: (e: React.PointerEvent) => boolean;
  onPointerMove: (e: React.PointerEvent) => boolean;
  onPointerUp: (e: React.PointerEvent) => boolean;
  onPointerCancel: (e: React.PointerEvent) => boolean;
  /** Offset in CSS px currently applied above the finger. */
  cursorOffsetY: () => number;
};

export function usePrecisionTouch<P extends PrecisionPoint>(
  opts: UsePrecisionTouchOptions<P>,
): PrecisionTouchApi<P> {
  const {
    enabled, active, canvasRef, clientToLocal,
    isHoldEligible, onActivate, onCommit, onChange,
  } = opts;

  // Live refs so timers and native listeners never close over stale props.
  const activeRef = useRef(active);
  const enabledRef = useRef(enabled);
  const cbRef = useRef({ clientToLocal, isHoldEligible, onActivate, onCommit, onChange });
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => {
    cbRef.current = { clientToLocal, isHoldEligible, onActivate, onCommit, onChange };
  });

  const anchorPointerIdRef = useRef<number | null>(null);
  const anchorActiveRef = useRef(false);
  const crosshairRef = useRef<P | null>(null);
  const holdRef = useRef<
    { timer: ReturnType<typeof setTimeout>; pointerId: number; clientX: number; clientY: number } | null
  >(null);

  const cursorOffsetY = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return 0;
    const h = c.getBoundingClientRect().height;
    return h * PRECISION_CURSOR_OFFSET_RATIO;
  }, [canvasRef]);

  const cancelHold = useCallback(() => {
    const h = holdRef.current;
    if (!h) return;
    clearTimeout(h.timer);
    holdRef.current = null;
  }, []);

  const setCrosshairFromClient = useCallback((clientX: number, clientY: number) => {
    crosshairRef.current = cbRef.current.clientToLocal(clientX, clientY - cursorOffsetY());
    cbRef.current.onChange?.();
  }, [cursorOffsetY]);

  const clearAnchor = useCallback(() => {
    anchorPointerIdRef.current = null;
    anchorActiveRef.current = false;
    crosshairRef.current = null;
    cbRef.current.onChange?.();
  }, []);

  // Precision switched off entirely → drop every bit of in-flight state.
  useEffect(() => {
    if (enabled && active) return;
    cancelHold();
    if (anchorPointerIdRef.current !== null || crosshairRef.current) clearAnchor();
  }, [enabled, active, cancelHold, clearAnchor]);

  useEffect(() => () => cancelHold(), [cancelHold]);

  /**
   * Stop the browser taking the second finger.
   *
   * `touch-action: none` does NOT prevent iOS Safari's page pinch-zoom — that is
   * a user-agent gesture which ignores it, and React's touch listeners are
   * passive so `preventDefault()` in a React handler cannot stop it either. Only
   * WebKit's proprietary `gesture*` events, or a NON-PASSIVE `touchmove`, can.
   * Registered only while precision is enabled AND active, so ordinary scrolling
   * and zooming everywhere else are untouched.
   */
  useEffect(() => {
    if (!enabled || !active || typeof document === 'undefined') return;
    const canvas = canvasRef.current;
    const stopGesture = (ev: Event) => {
      if (enabledRef.current && activeRef.current && ev.cancelable) ev.preventDefault();
    };
    const stopMultiTouch = (ev: TouchEvent) => {
      if (enabledRef.current && activeRef.current && ev.touches.length > 1 && ev.cancelable) {
        ev.preventDefault();
      }
    };
    const GESTURES = ['gesturestart', 'gesturechange', 'gestureend'];
    GESTURES.forEach((t) => document.addEventListener(t, stopGesture, { passive: false }));
    canvas?.addEventListener('touchmove', stopMultiTouch, { passive: false });
    return () => {
      GESTURES.forEach((t) => document.removeEventListener(t, stopGesture));
      canvas?.removeEventListener('touchmove', stopMultiTouch);
    };
  }, [enabled, active, canvasRef]);

  const onPointerDown = useCallback((e: React.PointerEvent): boolean => {
    if (!enabled) return false;

    // Gesture lock: while an anchor is held, ANY other finger is a discrete
    // commit tap — never a new consumer, never a pinch.
    if (anchorPointerIdRef.current !== null && e.pointerId !== anchorPointerIdRef.current) {
      const p = crosshairRef.current;
      if (p) cbRef.current.onCommit?.(p);
      return true;
    }

    // Precision already on → this finger becomes the anchor.
    if (active && e.pointerType === 'touch' && anchorPointerIdRef.current === null) {
      anchorPointerIdRef.current = e.pointerId;
      anchorActiveRef.current = true;
      setCrosshairFromClient(e.clientX, e.clientY);
      return true;
    }

    // Precision off → arm the still-hold that turns it on. NOT consumed: the
    // caller's own gesture (brush stroke, selection drag) starts normally and is
    // only superseded if the finger genuinely stays put.
    if (
      !active &&
      e.pointerType === 'touch' &&
      cbRef.current.onActivate &&
      (cbRef.current.isHoldEligible?.() ?? true)
    ) {
      cancelHold();
      const clientX = e.clientX;
      const clientY = e.clientY;
      const pointerId = e.pointerId;
      holdRef.current = {
        pointerId, clientX, clientY,
        timer: setTimeout(() => {
          holdRef.current = null;
          anchorPointerIdRef.current = pointerId;
          anchorActiveRef.current = true;
          setCrosshairFromClient(clientX, clientY);
          try { navigator?.vibrate?.(12); } catch { /* unsupported */ }
          cbRef.current.onActivate?.();
        }, PRECISION_HOLD_MS),
      };
    }
    return false;
  }, [enabled, active, cancelHold, setCrosshairFromClient]);

  const onPointerMove = useCallback((e: React.PointerEvent): boolean => {
    if (!enabled) return false;

    const hold = holdRef.current;
    if (
      hold && hold.pointerId === e.pointerId &&
      Math.hypot(e.clientX - hold.clientX, e.clientY - hold.clientY) > PRECISION_HOLD_SLOP_PX
    ) {
      cancelHold();
    }

    if (anchorPointerIdRef.current === e.pointerId) {
      setCrosshairFromClient(e.clientX, e.clientY);
      return true;
    }
    return false;
  }, [enabled, cancelHold, setCrosshairFromClient]);

  const onPointerUp = useCallback((e: React.PointerEvent): boolean => {
    if (!enabled) return false;
    if (holdRef.current?.pointerId === e.pointerId) cancelHold();
    if (anchorPointerIdRef.current === e.pointerId) {
      clearAnchor();
      return true;
    }
    return false;
  }, [enabled, cancelHold, clearAnchor]);

  const onPointerCancel = useCallback((e: React.PointerEvent): boolean => {
    if (!enabled) return false;
    if (holdRef.current?.pointerId === e.pointerId) cancelHold();
    if (anchorPointerIdRef.current === e.pointerId) {
      clearAnchor();
      return true;
    }
    return false;
  }, [enabled, cancelHold, clearAnchor]);

  return {
    crosshairRef, anchorActiveRef,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    cursorOffsetY,
  };
}
