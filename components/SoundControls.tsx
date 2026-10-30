'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import {
  DEFAULT_SOUND,
  applySound,
  ensureGain,
  isSilent,
  routeFor,
  soundStore,
  toggleMuteState,
  volumeChangeState,
  type SoundState,
  type VolumeRoute,
} from '@/lib/videoSound';

/**
 * The coach's sound (mute + volume) for one <video>, from the ONE shared store: the same state
 * drives the timeline's controls and the Generate panel's, survives tool/clip changes and
 * recordings, and is applied to the element whenever it changes or the clip reloads.
 * Nothing here ever disables the controls or forces the video muted.
 */
export function useSharedSound(videoRef: RefObject<HTMLVideoElement | null> | null, reattachKey?: string | null) {
  const state = useSyncExternalStore(soundStore.subscribe, soundStore.get, () => DEFAULT_SOUND);
  const [route, setRoute] = useState<VolumeRoute>('none');
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onMeta = () => {
      const r = routeFor(v);
      routeRef.current = r;
      setRoute(r);
      applySound(v, soundStore.get(), r);
    };
    onMeta();
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [videoRef, reattachKey]);

  // Any change of the shared state (this control, the other control, a refused play) reaches the element.
  useEffect(() => {
    const v = videoRef?.current;
    if (v) applySound(v, state, routeRef.current);
  }, [videoRef, reattachKey, state, route]);

  const toggleMute = useCallback(() => {
    const v = videoRef?.current;
    const next = soundStore.set(toggleMuteState(soundStore.get()));
    if (v) applySound(v, next, routeRef.current);
  }, [videoRef]);

  const changeVolume = useCallback((vol: number) => {
    const v = videoRef?.current;
    // iPhone: the gain route is built on the first move below full volume, inside this gesture.
    if (v && routeRef.current === 'webaudio' && vol < 1) ensureGain(v);
    const next = soundStore.set(volumeChangeState(vol));
    if (v) applySound(v, next, routeRef.current);
  }, [videoRef]);

  return { state, route, silent: isSilent(state), toggleMute, changeVolume };
}

/** Mute button + volume slider, same behavior everywhere. */
export function SoundControls({
  sound,
  testIdPrefix,
  accent = '#00c4cc',
  sliderWidth = 96,
  buttonStyle,
}: {
  sound: ReturnType<typeof useSharedSound>;
  testIdPrefix: string;
  accent?: string;
  sliderWidth?: number;
  buttonStyle?: React.CSSProperties;
}) {
  const { state, route, silent, toggleMute, changeVolume } = sound;
  const Icon = silent ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button
        type="button"
        data-testid={`${testIdPrefix}-mute`}
        onClick={toggleMute}
        aria-pressed={silent}
        aria-label={silent ? 'Unmute' : 'Mute'}
        title={silent ? 'Unmute' : 'Mute'}
        style={buttonStyle}
      >
        <Icon size={18} aria-hidden />
      </button>
      {route !== 'none' ? (
        <input
          type="range"
          data-testid={`${testIdPrefix}-volume`}
          min={0}
          max={1}
          step={0.05}
          value={silent ? 0 : state.volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Volume"
          title="Volume"
          style={{ width: sliderWidth, accentColor: accent, cursor: 'pointer' }}
        />
      ) : null}
    </div>
  );
}

export type { SoundState };
