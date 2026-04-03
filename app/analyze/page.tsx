'use client';

import { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '@/lib/store';
import Toolbar from '@/components/Toolbar';

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false });
const AnnotationCanvas = dynamic(() => import('@/components/AnnotationCanvas'), { ssr: false });
const PoseEstimation = dynamic(() => import('@/components/PoseEstimation'), { ssr: false });

export default function AnalyzePage() {
  const { video, showSkeleton, toggleSkeleton } = useStore();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });
  const [showToolbar, setShowToolbar] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    const updateSize = () => {
      if (!videoContainerRef.current) return;
      const w = videoContainerRef.current.clientWidth;
      const h = Math.round(w * 9 / 16);
      setCanvasSize({ width: w, height: h });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col">
      <header className="frosted-glass sticky top-0 z-20 flex items-center justify-between px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <a href="/" className="text-[#007AFF] font-medium text-sm">← Home</a>
        </div>
        <h1 className="text-base font-semibold text-gray-900">Coach Lab</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSkeleton}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              showSkeleton ? 'bg-[#007AFF] text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}
          >
            🏃 Pose
          </button>
          <button
            onClick={() => setShowToolbar(!showToolbar)}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600"
          >
            ✏️ Tools
          </button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 p-4 overflow-auto">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <VideoPlayer onFrameChange={setCurrentFrame} />
          </div>

          {video.file && (
            <div
              ref={videoContainerRef}
              className="relative bg-black rounded-2xl overflow-hidden shadow-sm"
              style={{ height: canvasSize.height }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
                Draw annotations on video frames
              </div>
              <AnnotationCanvas width={canvasSize.width} height={canvasSize.height} />
              <PoseEstimation
                videoElement={videoElRef.current}
                width={canvasSize.width}
                height={canvasSize.height}
              />
              <div className="absolute bottom-2 left-2 frosted-glass px-2 py-1 rounded-lg text-xs font-mono">
                Frame {currentFrame}
              </div>
            </div>
          )}

          {!video.file && (
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
              <p className="text-4xl mb-3">📹</p>
              <p className="font-medium">Upload a video above to start analysis</p>
              <p className="text-sm mt-1">Draw annotations, estimate pose, and analyze frame by frame</p>
            </div>
          )}
        </div>

        {showToolbar && (
          <aside className="flex-shrink-0">
            <Toolbar />
          </aside>
        )}
      </div>
    </div>
  );
}
