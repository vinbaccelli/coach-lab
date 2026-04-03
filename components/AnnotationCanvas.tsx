'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/store';

interface HistoryEntry {
  json: string;
}

interface Props {
  width: number;
  height: number;
}

export default function AnnotationCanvas({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const { activeTool, settings, video, saveFrameAnnotation, getFrameAnnotation, clearFrameAnnotation } = useStore();
  const historyRef = useRef<Record<number, HistoryEntry[]>>({});
  const redoRef = useRef<Record<number, HistoryEntry[]>>({});
  const currentFrameRef = useRef<number>(0);
  const isLoadingRef = useRef(false);
  const lineRef = useRef<any>(null);
  const anglePointsRef = useRef<any[]>([]);
  const isDrawingRef = useRef(false);
  const activeToolRef = useRef(activeTool);
  const settingsRef = useRef(settings);

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const getStrokeDashArray = useCallback((s: typeof settings) => {
    const t = s.lineThickness;
    if (s.lineStyle === 'dashed') return [t * 3, t * 2];
    if (s.lineStyle === 'dotted') return [t, t * 2];
    return [];
  }, []);

  const saveState = useCallback((frameIndex: number) => {
    const canvas = fabricRef.current;
    if (!canvas || isLoadingRef.current) return;
    const json = JSON.stringify(canvas.toJSON());
    saveFrameAnnotation(frameIndex, json);
    if (!historyRef.current[frameIndex]) historyRef.current[frameIndex] = [];
    historyRef.current[frameIndex].push({ json });
    if (historyRef.current[frameIndex].length > 50) {
      historyRef.current[frameIndex].shift();
    }
    redoRef.current[frameIndex] = [];
  }, [saveFrameAnnotation]);

  const undo = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const frameIndex = currentFrameRef.current;
    const stack = historyRef.current[frameIndex] || [];
    if (stack.length <= 1) return;
    stack.pop();
    const prev = stack[stack.length - 1];
    isLoadingRef.current = true;
    canvas.loadFromJSON(JSON.parse(prev.json)).then(() => {
      canvas.renderAll();
      isLoadingRef.current = false;
    });
  }, []);

  const redo = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const frameIndex = currentFrameRef.current;
    const stack = redoRef.current[frameIndex] || [];
    if (stack.length === 0) return;
    const next = stack.pop()!;
    if (!historyRef.current[frameIndex]) historyRef.current[frameIndex] = [];
    historyRef.current[frameIndex].push(next);
    isLoadingRef.current = true;
    canvas.loadFromJSON(JSON.parse(next.json)).then(() => {
      canvas.renderAll();
      isLoadingRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    let mounted = true;

    const initFabric = async () => {
      const { Canvas, PencilBrush } = await import('fabric');
      if (!mounted || !canvasRef.current) return;

      const canvas = new Canvas(canvasRef.current, {
        width,
        height,
        selection: true,
      });

      canvas.freeDrawingBrush = new PencilBrush(canvas);
      fabricRef.current = canvas;

      canvas.on('object:added', () => {
        if (!isLoadingRef.current) saveState(currentFrameRef.current);
      });
      canvas.on('object:modified', () => {
        if (!isLoadingRef.current) saveState(currentFrameRef.current);
      });
      canvas.on('object:removed', () => {
        if (!isLoadingRef.current) saveState(currentFrameRef.current);
      });

      canvas.on('mouse:down', async (opt: any) => {
        if (isLoadingRef.current) return;
        const tool = activeToolRef.current;
        const s = settingsRef.current;
        const pointer = canvas.getPointer(opt.e);

        if (tool === 'line') {
          isDrawingRef.current = true;
          const { Line } = await import('fabric');
          const line = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: s.strokeColor,
            strokeWidth: s.lineThickness,
            opacity: s.opacity / 100,
            strokeDashArray: getStrokeDashArray(s),
            selectable: false,
          });
          canvas.add(line);
          lineRef.current = line;
        }

        if (tool === 'angle') {
          anglePointsRef.current.push({ x: pointer.x, y: pointer.y });
          if (anglePointsRef.current.length === 3) {
            const pts = [...anglePointsRef.current];
            anglePointsRef.current = [];
            const { Line: FabricLine, IText } = await import('fabric');
            const [A, B, C] = pts;
            const line1 = new FabricLine([B.x, B.y, A.x, A.y], {
              stroke: s.strokeColor, strokeWidth: s.lineThickness, selectable: false,
            });
            const line2 = new FabricLine([B.x, B.y, C.x, C.y], {
              stroke: s.strokeColor, strokeWidth: s.lineThickness, selectable: false,
            });
            canvas.add(line1);
            canvas.add(line2);

            const angle1 = Math.atan2(A.y - B.y, A.x - B.x);
            const angle2 = Math.atan2(C.y - B.y, C.x - B.x);
            let angleDeg = Math.abs((angle2 - angle1) * 180 / Math.PI);
            if (angleDeg > 180) angleDeg = 360 - angleDeg;

            const label = new IText(`${angleDeg.toFixed(1)}°`, {
              left: B.x + 15,
              top: B.y - 25,
              fontSize: 16,
              fill: s.strokeColor,
              fontWeight: 'bold',
            });
            canvas.add(label);
            canvas.renderAll();
          }
        }

        if (tool === 'eraser') {
          const target = canvas.findTarget(opt.e);
          if (target) {
            canvas.remove(target);
          }
        }
      });

      canvas.on('mouse:move', (opt: any) => {
        if (!isDrawingRef.current || activeToolRef.current !== 'line' || !lineRef.current) return;
        const pointer = canvas.getPointer(opt.e);
        lineRef.current.set({ x2: pointer.x, y2: pointer.y });
        canvas.renderAll();
      });

      canvas.on('mouse:up', () => {
        if (activeToolRef.current === 'line') {
          isDrawingRef.current = false;
          lineRef.current = null;
        }
      });
    };

    initFabric();

    return () => {
      mounted = false;
      fabricRef.current?.dispose();
      fabricRef.current = null;
    };
  }, [width, height, saveState, getStrokeDashArray]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = activeTool === 'freedraw';
    canvas.selection = activeTool === 'select';
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = settings.strokeColor;
      canvas.freeDrawingBrush.width = settings.lineThickness;
    }
  }, [activeTool, settings]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (activeTool === 'circle' || activeTool === 'rect' || activeTool === 'text') {
      const addShape = async () => {
        const { Circle, Rect, IText } = await import('fabric');
        const common = {
          left: width / 2 - 50,
          top: height / 2 - 50,
          stroke: settings.strokeColor,
          strokeWidth: settings.lineThickness,
          fill: settings.fillColor === 'transparent' ? 'transparent' : settings.fillColor,
          opacity: settings.opacity / 100,
          strokeDashArray: getStrokeDashArray(settings),
        };
        if (activeTool === 'circle') {
          canvas.add(new Circle({ ...common, radius: 50 }));
        } else if (activeTool === 'rect') {
          canvas.add(new Rect({ ...common, width: 100, height: 70 }));
        } else if (activeTool === 'text') {
          const t = new IText('Add text', {
            left: width / 2 - 40,
            top: height / 2,
            fontSize: 20,
            fill: settings.strokeColor,
            opacity: settings.opacity / 100,
          });
          canvas.add(t);
          canvas.setActiveObject(t);
          t.enterEditing();
        }
        canvas.renderAll();
      };
      addShape();
    }
  }, [activeTool]);

  const loadFrame = useCallback(async (frameIndex: number) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    currentFrameRef.current = frameIndex;
    const saved = getFrameAnnotation(frameIndex);
    isLoadingRef.current = true;
    if (saved) {
      canvas.loadFromJSON(JSON.parse(saved)).then(() => {
        canvas.renderAll();
        isLoadingRef.current = false;
      });
    } else {
      canvas.clear();
      canvas.renderAll();
      isLoadingRef.current = false;
    }
  }, [getFrameAnnotation]);

  useEffect(() => {
    const frameIndex = Math.round(video.currentTime * video.fps);
    loadFrame(frameIndex);
  }, [video.currentTime, video.fps]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        undo();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

  const handleClearFrame = () => {
    if (!confirm('Clear all annotations on this frame?')) return;
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.clear();
    canvas.renderAll();
    clearFrameAnnotation(currentFrameRef.current);
    historyRef.current[currentFrameRef.current] = [];
    redoRef.current[currentFrameRef.current] = [];
  };

  return (
    <div className="relative" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          touchAction: 'none',
          cursor: activeTool === 'eraser' ? 'crosshair' : 'default',
        }}
      />
      <div className="absolute top-2 right-2 flex gap-1 z-10">
        <button onClick={undo} className="frosted-glass px-2 py-1 rounded-lg text-xs" title="Undo (Ctrl+Z)">↩</button>
        <button onClick={redo} className="frosted-glass px-2 py-1 rounded-lg text-xs" title="Redo (Ctrl+Shift+Z)">↪</button>
        <button onClick={handleClearFrame} className="frosted-glass px-2 py-1 rounded-lg text-xs text-red-500" title="Clear frame">🗑</button>
      </div>
    </div>
  );
}
