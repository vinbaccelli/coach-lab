'use client';

import { useRef, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';

const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
];

const REGION_COLORS: Record<number, string> = {
  11: '#007AFF', 12: '#007AFF', 13: '#007AFF', 14: '#007AFF', 15: '#007AFF', 16: '#007AFF',
  23: '#FF6B6B', 24: '#FF6B6B', 25: '#FF6B6B', 26: '#FF6B6B', 27: '#FF6B6B', 28: '#FF6B6B',
  0: '#8E8E93', 1: '#8E8E93', 2: '#8E8E93', 3: '#8E8E93', 4: '#8E8E93',
  5: '#8E8E93', 6: '#8E8E93', 7: '#8E8E93', 8: '#8E8E93', 9: '#8E8E93', 10: '#8E8E93',
};

interface Props {
  videoElement: HTMLVideoElement | null;
  width: number;
  height: number;
}

export default function PoseEstimation({ videoElement, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<any>(null);
  const { showSkeleton } = useStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [selectedJoints, setSelectedJoints] = useState<number[]>([]);
  const [angleInfo, setAngleInfo] = useState<{angle: number; joint: number} | null>(null);
  const lastLandmarksRef = useRef<any[]>([]);

  useEffect(() => {
    if (!showSkeleton || isReady) return;
    setIsLoading(true);

    const loadPose = async () => {
      try {
        const script1 = document.createElement('script');
        script1.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js';
        script1.crossOrigin = 'anonymous';
        document.head.appendChild(script1);

        script1.onload = () => {
          const PoseClass = (window as any).Pose;
          if (!PoseClass) {
            setIsLoading(false);
            return;
          }

          const pose = new PoseClass({
            locateFile: (file: string) =>
              `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
          });

          pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

          pose.onResults((results: any) => {
            drawSkeleton(results.poseLandmarks);
          });

          poseRef.current = pose;
          setIsReady(true);
          setIsLoading(false);
        };

        script1.onerror = () => setIsLoading(false);
      } catch (err) {
        console.error('Failed to load pose estimation:', err);
        setIsLoading(false);
      }
    };

    loadPose();
  }, [showSkeleton]);

  const drawSkeleton = (landmarks: any[]) => {
    const canvas = canvasRef.current;
    if (!canvas || !landmarks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    lastLandmarksRef.current = landmarks;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    POSE_CONNECTIONS.forEach(([a, b]) => {
      const lA = landmarks[a];
      const lB = landmarks[b];
      if (!lA || !lB || lA.visibility < 0.5 || lB.visibility < 0.5) return;

      const color = REGION_COLORS[a] || '#8E8E93';
      ctx.beginPath();
      ctx.moveTo(lA.x * canvas.width, lA.y * canvas.height);
      ctx.lineTo(lB.x * canvas.width, lB.y * canvas.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    landmarks.forEach((lm, i) => {
      if (lm.visibility < 0.5) return;
      const x = lm.x * canvas.width;
      const y = lm.y * canvas.height;
      const color = REGION_COLORS[i] || '#8E8E93';

      ctx.beginPath();
      ctx.arc(x, y, selectedJoints.includes(i) ? 8 : 5, 0, 2 * Math.PI);
      ctx.fillStyle = selectedJoints.includes(i) ? '#FFD60A' : color;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (angleInfo) {
      const lm = landmarks[angleInfo.joint];
      if (lm) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        const x = lm.x * canvas.width + 10;
        const y = lm.y * canvas.height - 10;
        ctx.fillRect(x - 5, y - 20, 80, 28);
        ctx.fillStyle = '#FFD60A';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.fillText(`${angleInfo.angle.toFixed(1)}°`, x, y);
      }
    }
  };

  const runPoseOnFrame = async () => {
    if (!poseRef.current || !videoElement || !showSkeleton) return;
    try {
      await poseRef.current.send({ image: videoElement });
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (!showSkeleton || !isReady) return;
    const interval = setInterval(runPoseOnFrame, 100);
    return () => clearInterval(interval);
  }, [showSkeleton, isReady, videoElement]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!showSkeleton || lastLandmarksRef.current.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    let nearest = -1;
    let minDist = 0.05;
    lastLandmarksRef.current.forEach((lm, i) => {
      if (lm.visibility < 0.5) return;
      const dist = Math.sqrt((lm.x - x) ** 2 + (lm.y - y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    });

    if (nearest === -1) {
      setSelectedJoints([]);
      setAngleInfo(null);
      return;
    }

    const newSelected = [...selectedJoints, nearest].slice(-2);
    setSelectedJoints(newSelected);

    if (newSelected.length === 2) {
      const lmA = lastLandmarksRef.current[newSelected[0]];
      const lmB = lastLandmarksRef.current[newSelected[1]];
      if (lmA && lmB) {
        const dx = lmB.x - lmA.x;
        const dy = lmB.y - lmA.y;
        const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
        setAngleInfo({ angle, joint: newSelected[1] });
      }
    } else {
      setAngleInfo(null);
    }
  };

  if (!showSkeleton) return null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width, height, pointerEvents: 'auto' }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl">
          <div className="bg-white rounded-xl px-4 py-2 text-sm font-medium">Loading pose model...</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleCanvasClick}
        style={{ position: 'absolute', top: 0, left: 0, cursor: 'crosshair' }}
      />
    </div>
  );
}
