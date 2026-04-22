'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Camera, Film, X, Download, Loader2 } from 'lucide-react';
import { downloadDataURL } from '@/lib/drawingTools';
import { downloadBlob, createBlobURL, getSupportedMimeType } from '@/lib/recordingUtils';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getCompositeCanvas: () => HTMLCanvasElement | null;
  getCropRegion?: () => { x: number; y: number; w: number; h: number } | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  defaultAspectRatio?: AspectRatioMode;
}

type ExportTab = 'screenshot' | 'clip';
type AspectRatioMode = 'youtube' | 'instagram';

const ASPECT_CONFIGS: Record<AspectRatioMode, { label: string; w: number; h: number }> = {
  youtube:   { label: 'YouTube 16:9 (1920×1080)', w: 1920, h: 1080 },
  instagram: { label: 'Reels 9:16 (1080×1920)',  w: 1080, h: 1920 },
};

const FFMPEG_CORE_VERSION = '0.12.6';

export default function ExportModal({
  isOpen,
  onClose,
  getCompositeCanvas,
  getCropRegion,
  videoRef,
  defaultAspectRatio,
}: ExportModalProps) {
  const [tab, setTab] = useState<ExportTab>('screenshot');
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  // Clip options
  const [clipDuration, setClipDuration] = useState(3);
  const [clipSpeed, setClipSpeed] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>(defaultAspectRatio ?? 'youtube');
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipBlob, setClipBlob] = useState<Blob | null>(null);
  const [mp4Progress, setMp4Progress] = useState<string | null>(null);

  const stopClipRef = useRef<(() => void) | null>(null);

  // Keep export aspect in sync with the app's current layout mode.
  React.useEffect(() => {
    if (!isOpen) return;
    if (defaultAspectRatio) setAspectRatio(defaultAspectRatio);
  }, [defaultAspectRatio, isOpen]);

  const captureScreenshot = useCallback(() => {
    setIsCapturing(true);
    try {
      const canvas = getCompositeCanvas();
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      setScreenshotUrl(dataUrl);
    } finally {
      setIsCapturing(false);
    }
  }, [getCompositeCanvas]);

  const downloadScreenshot = useCallback(() => {
    if (!screenshotUrl) return;
    downloadDataURL(screenshotUrl, `coach-lab-screenshot-${Date.now()}.png`);
  }, [screenshotUrl]);

  const recordClip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = getCompositeCanvas();
    if (!canvas) return;

    setIsRecordingClip(true);
    setClipUrl(null);
    setClipBlob(null);
    setMp4Progress(null);

    const originalSpeed = video.playbackRate;
    video.playbackRate = clipSpeed;

    const cfg = ASPECT_CONFIGS[aspectRatio];
    const w = cfg.w;
    const h = cfg.h;

    const recCanvas = document.createElement('canvas');
    recCanvas.width = w;
    recCanvas.height = h;
    const ctx = recCanvas.getContext('2d')!;

    const paintInterval = setInterval(() => {
      const src = getCompositeCanvas();
      if (!src) return;
      const crop = getCropRegion?.();
      const sx0 = crop ? crop.x * src.width : 0;
      const sy0 = crop ? crop.y * src.height : 0;
      const sw0 = crop ? crop.w * src.width : src.width;
      const sh0 = crop ? crop.h * src.height : src.height;
      // Letterbox/pillarbox to maintain aspect ratio
      const srcAR = sw0 / sh0;
      const dstAR = w / h;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      let sx = 0, sy = 0, sw = w, sh = h;
      if (srcAR > dstAR) {
        sh = w / srcAR;
        sy = (h - sh) / 2;
      } else {
        sw = h * srcAR;
        sx = (w - sw) / 2;
      }
      ctx.drawImage(src, sx0, sy0, sw0, sh0, sx, sy, sw, sh);
    }, 1000 / 30);

    const stream: MediaStream = (recCanvas as any).captureStream(30);
    const mimeType = getSupportedMimeType();
    const mr = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 5_000_000,
    });
    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    mr.onstop = async () => {
      clearInterval(paintInterval);
      video.playbackRate = originalSpeed;
      setIsRecordingClip(false);

      const webmBlob = new Blob(chunks, { type: mimeType || 'video/webm' });

      // Attempt MP4 conversion via FFmpeg.wasm
      try {
        setMp4Progress('Loading FFmpeg…');
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { toBlobURL, fetchFile } = await import('@ffmpeg/util');
        const ffmpeg = new FFmpeg();
        ffmpeg.on('log', ({ message }) => setMp4Progress(message.slice(0, 80)));
        const baseURL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
        await ffmpeg.load({
          coreURL:   await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
          wasmURL:   await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setMp4Progress('Converting to MP4…');
        await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));
        await ffmpeg.exec([
          '-i', 'input.webm',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-movflags', '+faststart',
          'output.mp4',
        ]);
        const mp4Data = await ffmpeg.readFile('output.mp4');
        const mp4Blob = new Blob([(mp4Data as Uint8Array).buffer as ArrayBuffer], { type: 'video/mp4' });
        setMp4Progress(null);
        setClipBlob(mp4Blob);
        setClipUrl(createBlobURL(mp4Blob));
      } catch (err: any) {
        console.warn('[ExportModal] FFmpeg MP4 conversion failed, falling back to WebM:', err);
        setMp4Progress(null);
        setClipBlob(webmBlob);
        setClipUrl(createBlobURL(webmBlob));
      }
    };

    mr.start(100);
    stopClipRef.current = () => { if (mr.state !== 'inactive') mr.stop(); };

    const realDuration = (clipDuration / clipSpeed) * 1000;
    video.play();
    setTimeout(() => {
      video.pause();
      stopClipRef.current?.();
    }, realDuration);
  }, [getCompositeCanvas, getCropRegion, videoRef, clipDuration, clipSpeed, aspectRatio]);

  const downloadClip = useCallback(() => {
    if (clipBlob) {
      const ext = clipBlob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(clipBlob, `coach-lab-clip-${Date.now()}.${ext}`);
    }
  }, [clipBlob]);

  const handleClose = () => {
    setScreenshotUrl(null);
    setClipUrl(null);
    setClipBlob(null);
    setMp4Progress(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-w-[95vw] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Export</h2>
          <button onClick={handleClose} className="btn-ghost rounded-lg p-1.5">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(['screenshot', 'clip'] as ExportTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'screenshot' ? <Camera size={15} /> : <Film size={15} />}
              {t === 'screenshot' ? 'Screenshot' : 'Video Clip'}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Screenshot Tab */}
          {tab === 'screenshot' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-500">Capture the current frame with all drawings as a PNG image.</p>
              {screenshotUrl ? (
                <div className="flex flex-col gap-3">
                  <img src={screenshotUrl} alt="Screenshot preview"
                    className="w-full rounded-lg border border-gray-200 object-contain max-h-56" />
                  <div className="flex gap-2">
                    <button onClick={downloadScreenshot} className="btn-primary flex-1 gap-1.5">
                      <Download size={14} /> Download PNG
                    </button>
                    <button onClick={() => setScreenshotUrl(null)} className="btn-outline flex-1 gap-1.5">
                      Retake
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={captureScreenshot} disabled={isCapturing} className="btn-primary gap-2 py-2.5">
                  {isCapturing ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                  Capture Screenshot
                </button>
              )}
            </div>
          )}

          {/* Clip Tab */}
          {tab === 'clip' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-500">
                Record a short video clip. Output will be converted to MP4 when possible.
              </p>

              <div className="flex flex-col gap-3">
                {/* Aspect ratio */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Format:</label>
                  <div className="flex gap-2">
                    {(Object.entries(ASPECT_CONFIGS) as [AspectRatioMode, typeof ASPECT_CONFIGS[AspectRatioMode]][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => setAspectRatio(key)}
                        disabled={isRecordingClip}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-colors border ${
                          aspectRatio === key
                            ? 'bg-blue-100 text-blue-700 font-semibold border-blue-300'
                            : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                        }`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  {(() => {
                    const dur = videoRef.current?.duration;
                    const maxDur = Number.isFinite(dur) && (dur as number) > 0 ? Math.ceil(dur as number) : 600;
                    return (
                      <>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Duration (seconds)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={maxDur}
                            step={1}
                            value={clipDuration}
                            onChange={(e) => setClipDuration(Math.max(1, Number(e.target.value) || 1))}
                            disabled={isRecordingClip}
                            className="w-24 rounded-md border border-gray-200 px-2 py-1 text-sm"
                          />
                          <input
                            type="range"
                            min={1}
                            max={maxDur}
                            step={1}
                            value={Math.min(clipDuration, maxDur)}
                            onChange={(e) => setClipDuration(Number(e.target.value))}
                            disabled={isRecordingClip}
                            className="w-full"
                          />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Max: {maxDur}s {Number.isFinite(dur) ? '(video duration)' : '(cap)'}
                        </p>
                      </>
                    );
                  })()}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Speed:</label>
                  <div className="flex gap-1.5">
                    {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                      <button
                        key={s}
                        onClick={() => setClipSpeed(s)}
                        disabled={isRecordingClip}
                        className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                          clipSpeed === s
                            ? 'bg-blue-100 text-blue-700 font-semibold'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {mp4Progress && (
                <div className="text-xs text-blue-600 bg-blue-50 rounded-md p-2 font-mono truncate">
                  {mp4Progress}
                </div>
              )}

              {clipUrl ? (
                <div className="flex flex-col gap-3">
                  <video src={clipUrl} controls className="w-full rounded-lg border border-gray-200" style={{ maxHeight: 200 }} />
                  <div className="flex gap-2">
                    <button onClick={downloadClip} className="btn-primary flex-1 gap-1.5">
                      <Download size={14} /> Download {clipBlob?.type.includes('mp4') ? 'MP4' : 'WebM'}
                    </button>
                    <button onClick={() => { setClipUrl(null); setClipBlob(null); }} className="btn-outline flex-1">
                      Discard
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={recordClip} disabled={isRecordingClip || !!mp4Progress} className="btn-primary gap-2 py-2.5">
                  {isRecordingClip ? (
                    <><Loader2 size={15} className="animate-spin" />Recording {clipDuration}s…</>
                  ) : mp4Progress ? (
                    <><Loader2 size={15} className="animate-spin" />Converting…</>
                  ) : (
                    <><Film size={15} />Record {clipDuration}s Clip</>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
