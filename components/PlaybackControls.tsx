'use client';

import { useEffect, useRef, useState } from 'react';
import { SkipBack, SkipForward, Play, Pause, Square } from 'lucide-react';

const PLAYBACK_SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2] as const;
const FRAME_MODES = [60, 120, 240, 960] as const;
type FrameMode = typeof FRAME_MODES[number];

function formatSpeed(s: number): string {
  if (s === 0.05) return '1/20×';
  if (s === 0.1) return '1/10×';
  return `${s}×`;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoRefB?: React.RefObject<HTMLVideoElement | null>;
}

export default function PlaybackControls({ videoRef, videoRefB }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTimeB, setCurrentTimeB] = useState(0);
  const [durationB, setDurationB] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [frameMode, setFrameMode] = useState<FrameMode>(60);
  const isSynced = !!videoRefB;

  const frameModeRef = useRef<FrameMode>(60);
  useEffect(() => { frameModeRef.current = frameMode; }, [frameMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      const video = videoRef.current;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          if (video.paused) {
            video.play();
            if (isSynced) videoRefB?.current?.play();
          } else {
            video.pause();
            if (isSynced) videoRefB?.current?.pause();
          }
          break;
        case 'j':
          e.preventDefault();
          if (videoRef.current) videoRef.current.playbackRate = 0.5;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 0.5;
          setPlaybackRate(0.5);
          break;
        case 'k':
          e.preventDefault();
          if (videoRef.current) videoRef.current.playbackRate = 1.0;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 1.0;
          setPlaybackRate(1.0);
          break;
        case 'l':
          e.preventDefault();
          if (videoRef.current) videoRef.current.playbackRate = 2.0;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 2.0;
          setPlaybackRate(2.0);
          break;
        case 'arrowleft':
          e.preventDefault();
          {
            const frameSize = 1 / frameModeRef.current;
            video.currentTime = Math.max(0, video.currentTime - frameSize);
            if (isSynced && videoRefB?.current) videoRefB.current.currentTime = video.currentTime;
          }
          break;
        case 'arrowright':
          e.preventDefault();
          {
            const frameSize = 1 / frameModeRef.current;
            video.currentTime = Math.min(video.duration, video.currentTime + frameSize);
            if (isSynced && videoRefB?.current) videoRefB.current.currentTime = video.currentTime;
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoRef, videoRefB, isSynced]);

  // Sync video state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef]);

  // Track Video B time independently
  useEffect(() => {
    const videoB = videoRefB?.current;
    if (!videoB) return;

    const handleTimeUpdate = () => setCurrentTimeB(videoB.currentTime);
    const handleLoadedMetadata = () => setDurationB(videoB.duration);

    videoB.addEventListener('timeupdate', handleTimeUpdate);
    videoB.addEventListener('loadedmetadata', handleLoadedMetadata);

    if (videoB.duration) setDurationB(videoB.duration);

    return () => {
      videoB.removeEventListener('timeupdate', handleTimeUpdate);
      videoB.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoRefB]);

  // Sync seeking
  const isSeeking = useRef(false);
  useEffect(() => {
    const videoA = videoRef.current;
    const videoB = videoRefB?.current;
    if (!videoA || !videoB) return;

    const onSeekA = () => {
      if (!isSeeking.current) {
        isSeeking.current = true;
        videoB.currentTime = videoA.currentTime;
        setTimeout(() => { isSeeking.current = false; }, 100);
      }
    };

    videoA.addEventListener('seeking', onSeekA);
    return () => videoA.removeEventListener('seeking', onSeekA);
  }, [videoRef, videoRefB]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleBoth = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vA) return;
    if (vA.paused) { vA.play(); vB?.play(); }
    else { vA.pause(); vB?.pause(); }
  };

  const toggleA = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vA) return;
    if (vA.paused) { vA.play(); vB?.pause(); }
    else { vA.pause(); }
  };

  const toggleB = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vB) return;
    if (vB.paused) { vB.play(); vA?.pause(); }
    else { vB.pause(); }
  };

  const stopA = () => {
    const vA = videoRef.current;
    if (!vA) return;
    vA.pause();
    vA.currentTime = 0;
    setIsPlaying(false);
  };

  const stopB = () => {
    const vB = videoRefB?.current;
    if (!vB) return;
    vB.pause();
    vB.currentTime = 0;
    setCurrentTimeB(0);
  };

  const btnBase: React.CSSProperties = {
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    border: '1px solid #E8E8ED',
    background: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#1D1D1F',
  };

  const textBtnBase: React.CSSProperties = {
    height: '28px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid #E8E8ED',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    color: '#1D1D1F',
    whiteSpace: 'nowrap',
  };

  const frameSizeMs = Math.round((1000 / frameMode) * 10) / 10;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '4px',
      padding: '6px 16px',
      borderTop: '1px solid #E8E8ED',
      background: '#F8F8F8',
      flexShrink: 0,
    }}>
      {/* Dual video controls */}
      {isSynced && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#6b7280', marginRight: '2px' }}>Sync:</span>
          <button style={{ ...textBtnBase, background: '#35679A', color: '#fff', border: 'none' }} onClick={toggleBoth}>
            ▶ Both
          </button>
          <button style={textBtnBase} onClick={toggleA}>▶ A</button>
          <button style={textBtnBase} onClick={toggleB}>▶ B</button>
          <button
            onClick={stopB}
            title="Stop Video B"
            style={{ ...btnBase, width: '28px', height: '28px', color: '#EF4444' }}
          >
            <Square size={13} fill="#EF4444" />
          </button>
        </div>
      )}

      {/* Main controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Playback buttons */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {[
            { icon: SkipBack, label: 'Start', onClick: () => { if (videoRef.current) { videoRef.current.currentTime = 0; if (isSynced && videoRefB?.current) videoRefB.current.currentTime = 0; } } },
            { icon: SkipBack, label: '-1s', onClick: () => { if (videoRef.current) { videoRef.current.currentTime -= 1; if (isSynced && videoRefB?.current) videoRefB.current.currentTime -= 1; } } },
            {
              icon: isPlaying ? Pause : Play,
              label: isPlaying ? 'Pause' : 'Play',
              onClick: () => {
                if (!videoRef.current) return;
                if (videoRef.current.paused) {
                  videoRef.current.play();
                  if (isSynced) videoRefB?.current?.play();
                } else {
                  videoRef.current.pause();
                  if (isSynced) videoRefB?.current?.pause();
                }
              },
            },
            { icon: SkipForward, label: '+1s', onClick: () => { if (videoRef.current) { videoRef.current.currentTime += 1; if (isSynced && videoRefB?.current) videoRefB.current.currentTime += 1; } } },
            { icon: SkipForward, label: 'End', onClick: () => { if (videoRef.current) { videoRef.current.currentTime = videoRef.current.duration; if (isSynced && videoRefB?.current) videoRefB.current.currentTime = videoRefB.current.duration; } } },
          ].map((btn, i) => (
            <button key={i} onClick={btn.onClick} aria-label={btn.label} style={btnBase}>
              <btn.icon size={16} strokeWidth={1.5} />
            </button>
          ))}
          {/* Stop button for Video A */}
          <button
            onClick={stopA}
            aria-label="Stop Video A"
            title="Stop (pause + rewind to start)"
            style={{ ...btnBase, color: '#EF4444' }}
          >
            <Square size={14} fill="#EF4444" />
          </button>
        </div>

        {/* Video A scrubber */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          {isSynced && (
            <span style={{ fontSize: '9px', color: '#9ca3af', fontWeight: 600, lineHeight: 1 }}>A</span>
          )}
          <input
            type="range"
            aria-label="Video A scrubber"
            min="0"
            max={duration || 0}
            step={1 / frameMode}
            value={currentTime}
            onChange={(e) => {
              if (videoRef.current) {
                videoRef.current.currentTime = parseFloat(e.target.value);
              }
            }}
            style={{ width: '100%', height: '4px', borderRadius: '2px', cursor: 'pointer' }}
          />
        </div>

        {/* Video B scrubber (independent) */}
        {isSynced && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '9px', color: '#9ca3af', fontWeight: 600, lineHeight: 1 }}>B</span>
            </div>
            <input
              type="range"
              aria-label="Video B scrubber"
              min="0"
              max={durationB || 0}
              step={1 / frameMode}
              value={currentTimeB}
              onChange={(e) => {
                if (videoRefB?.current) {
                  videoRefB.current.currentTime = parseFloat(e.target.value);
                }
              }}
              style={{ width: '100%', height: '4px', borderRadius: '2px', cursor: 'pointer' }}
            />
          </div>
        )}

        {/* Time display */}
        <div style={{ fontSize: '12px', color: '#6b7280', minWidth: isSynced ? '120px' : '80px', textAlign: 'right' }}>
          {isSynced ? (
            <>
              <span>A: {formatTime(currentTime)}</span>
              <br />
              <span>B: {formatTime(currentTimeB)}</span>
            </>
          ) : (
            <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
          )}
        </div>
      </div>

      {/* Speed buttons + Frame precision */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', marginRight: '2px' }}>Speed:</span>
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => {
              if (videoRef.current) videoRef.current.playbackRate = s;
              if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = s;
              setPlaybackRate(s);
            }}
            style={{
              height: '22px',
              padding: '0 7px',
              borderRadius: '5px',
              fontSize: '10px',
              fontWeight: 600,
              border: '1px solid',
              borderColor: playbackRate === s ? '#35679A' : '#E8E8ED',
              background: playbackRate === s ? '#35679A' : '#fff',
              color: playbackRate === s ? '#fff' : '#1D1D1F',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {formatSpeed(s)}
          </button>
        ))}

        <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '8px' }}>
          Frame:
        </span>
        {FRAME_MODES.map((fm) => (
          <button
            key={fm}
            onClick={() => setFrameMode(fm)}
            title={`Step by ${(1000 / fm).toFixed(2)}ms per frame`}
            style={{
              height: '22px',
              padding: '0 7px',
              borderRadius: '5px',
              fontSize: '10px',
              fontWeight: 600,
              border: '1px solid',
              borderColor: frameMode === fm ? '#7C3AED' : '#E8E8ED',
              background: frameMode === fm ? '#7C3AED' : '#fff',
              color: frameMode === fm ? '#fff' : '#1D1D1F',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {fm}
          </button>
        ))}
        <span style={{ fontSize: '10px', color: '#7C3AED', fontWeight: 600 }}>
          {frameSizeMs}ms/frame
        </span>
      </div>
    </div>
  );
}
