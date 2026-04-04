'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRecording } from '@/contexts/RecordingContext';

/**
 * PersistentWebcamOverlay
 *
 * Renders the webcam picture-in-picture above all other UI layers while recording.
 * Stays mounted during tab/panel navigation so recording is never interrupted.
 * Supports dragging and corner resize.
 */
export default function PersistentWebcamOverlay() {
  const { webcamStream, recState, registerWebcamVideo } = useRecording();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [size, setSize] = useState({ w: 240, h: 135 });

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Register the webcam video element with the context so recording can composite it
  useEffect(() => {
    registerWebcamVideo(videoRef.current);
    return () => registerWebcamVideo(null);
  }, [registerWebcamVideo]);

  // Connect stream to video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (webcamStream) {
      v.srcObject = webcamStream;
      v.play().catch(() => {});
    } else {
      v.srcObject = null;
    }
  }, [webcamStream]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [pos]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  }, [size]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPos({ x: Math.max(0, dragRef.current.origX + dx), y: Math.max(0, dragRef.current.origY + dy) });
      }
      if (resizeRef.current) {
        const dx = e.clientX - resizeRef.current.startX;
        const newW = Math.max(120, resizeRef.current.origW + dx);
        setSize({ w: newW, h: Math.round(newW * 9 / 16) });
      }
    };
    const onUp = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  // Only show when webcam stream is active
  if (!webcamStream) return null;

  const isRecording = recState === 'recording';
  const isPaused = recState === 'paused';

  return (
    <div
      className="fixed z-50 rounded-xl overflow-hidden shadow-2xl border-2 border-blue-400 select-none"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, cursor: 'grab' }}
      onPointerDown={onDragStart}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
      />
      {/* Recording status indicator */}
      <div className="absolute top-1.5 left-2 flex items-center gap-1.5 pointer-events-none">
        {isRecording && (
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        )}
        {isPaused && (
          <span className="w-2 h-2 bg-yellow-400 rounded-full" />
        )}
        <span className="text-[9px] text-white/90 font-bold tracking-wide bg-black/30 rounded px-1">
          CAM
        </span>
      </div>
      {/* Resize handle — bottom-right corner */}
      <div
        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize bg-blue-500/70 rounded-tl-md flex items-center justify-center"
        onPointerDown={onResizeStart}
        style={{ touchAction: 'none', minWidth: 44, minHeight: 44 }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
          <path d="M10 10L10 5L5 10Z" />
          <path d="M10 10L10 0L0 10Z" fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}
