'use client';

/**
 * "Tap the video to show it": shown over the analysis video area only while the first-frame code is in its S5
 * state (lib/firstFrame.ts: the strategies ran, iOS still shows no frame, a tap on the video is awaited).
 *
 * It does not start anything itself. The tap is handled by S5's own listener on the video panel, which sits on
 * this element's parent (capture phase), so a tap on this pill reaches it exactly as a tap on the video does.
 *
 * Layout: a small centred pill, never a full-screen layer. The wrapper ignores pointer events and starts after
 * the toolbar rail (`insetLeft`), so the toolbar, the data column buttons and the timeline are never covered;
 * the pill is the only part that takes touches and is at least 44 x 44 px.
 */
export default function FirstFrameTapHint({ insetLeft = 0 }: { insetLeft?: number }) {
  return (
    <div
      data-first-frame-hint
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: insetLeft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12, zIndex: 120, pointerEvents: 'none',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          pointerEvents: 'auto', touchAction: 'manipulation',
          minHeight: 44, minWidth: 44, maxWidth: 'min(100%, 300px)', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 14,
          background: 'rgba(20,20,24,0.86)', color: '#fff', textAlign: 'center',
          fontSize: 16, fontWeight: 700, lineHeight: 1.25,
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        }}
      >
        <span aria-hidden>👆</span> Tap the video to show it
      </div>
    </div>
  );
}
