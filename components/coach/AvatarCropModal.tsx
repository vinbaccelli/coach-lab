'use client';

/**
 * Square-crop step for a coach's profile photo.
 *
 * This is the standard avatar flow for EVERY coach, not a per-profile feature:
 * `CoachProfileEditor` never uploads a raw file any more, so whatever a coach
 * picks is normalised here to a square JPEG of known dimensions before it
 * reaches storage. That is what makes the circular frame on the public profile
 * predictable at any size, and it is also the size guard — a 40 MP phone photo
 * leaves this step as a ~512px JPEG.
 *
 * Cropping uses `react-easy-crop` (6.2.3, ~300 kB on disk, one small dependency
 * `normalize-wheel`, no other runtime deps). It handles the gesture surface —
 * drag, wheel, and two-finger pinch — plus keyboard nudging and the round crop
 * shape. The canvas step below is ours: react-easy-crop reports the crop
 * rectangle in source-image pixels and deliberately does not rasterise, so the
 * single `drawImage` call here is what produces the actual file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { X, ZoomIn, Check as CheckIcon } from 'lucide-react';

/** Side of the exported square, in image pixels. */
const OUTPUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** JPEG quality — visually clean at avatar sizes, keeps the upload small. */
const QUALITY = 0.9;

/**
 * Cut `area` out of the source image and scale it to a square.
 * `area` arrives from react-easy-crop already expressed in source pixels.
 */
async function cropToSquareBlob(src: string, area: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT, OUTPUT);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      QUALITY,
    );
  });
}

export default function AvatarCropModal({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: Blob) => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!objectUrl || !areaPixels) return;
    setWorking(true);
    setError(null);
    try {
      const blob = await cropToSquareBlob(objectUrl, areaPixels);
      onConfirm(blob);
    } catch {
      setError('Could not prepare that image on this device. Try a different photo.');
    } finally {
      setWorking(false);
    }
  }, [objectUrl, areaPixels, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop your profile photo"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(0, 0, 0, 0.72)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          width: '100%', maxWidth: 360, background: 'var(--cl-bg-panel)',
          borderRadius: 16, padding: 20, boxShadow: '0 20px 48px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Crop your photo</h3>
          <button
            type="button" onClick={onCancel} aria-label="Cancel"
            style={{
              width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--cl-text-secondary)', padding: 0, margin: '-10px -10px -10px 0',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--cl-text-secondary)', lineHeight: 1.5 }}>
          Drag to reposition, pinch or scroll to zoom. What you see in the circle is what people see.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 12px', marginBottom: 12, borderRadius: 10,
              background: '#FFF7ED', border: '1px solid #FCA5A5', color: '#9A3412',
              fontSize: 12, lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {/* Crop stage. react-easy-crop fills its positioned parent, so the
            parent owns the size. */}
        <div
          style={{
            position: 'relative', width: '100%', aspectRatio: '1 / 1',
            borderRadius: 12, overflow: 'hidden',
            background: 'var(--cl-bg-secondary)', touchAction: 'none',
          }}
        >
          {objectUrl && (
            <Cropper
              image={objectUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <ZoomIn size={16} style={{ color: 'var(--cl-text-secondary)', flexShrink: 0 }} aria-hidden="true" />
          <input
            type="range"
            min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            style={{ flex: 1, accentColor: 'var(--cl-accent)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            type="button" onClick={onCancel}
            style={{
              flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer',
              border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)',
              color: 'var(--cl-text-primary)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={handleConfirm} disabled={!areaPixels || working}
            style={{
              flex: 1, minHeight: 44, borderRadius: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: 'none', background: 'var(--cl-action-primary)',
              color: 'var(--cl-text-on-fill)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: !areaPixels || working ? 'not-allowed' : 'pointer',
              opacity: !areaPixels || working ? 0.5 : 1,
            }}
          >
            <CheckIcon size={15} /> {working ? 'Preparing…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
