import { create } from 'zustand';

export type Tool = 'select' | 'freedraw' | 'line' | 'angle' | 'circle' | 'rect' | 'text' | 'eraser';

export interface AnnotationSettings {
  strokeColor: string;
  fillColor: string;
  lineThickness: number;
  opacity: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface VideoState {
  file: File | null;
  file2: File | null;
  duration: number;
  currentTime: number;
  fps: number;
  isSideBySide: boolean;
}

interface AppStore {
  activeTool: Tool;
  settings: AnnotationSettings;
  setActiveTool: (tool: Tool) => void;
  setSettings: (s: Partial<AnnotationSettings>) => void;

  video: VideoState;
  setVideoFile: (file: File) => void;
  setVideoFile2: (file: File) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setFPS: (fps: number) => void;
  setSideBySide: (v: boolean) => void;

  frameAnnotations: Record<number, string>;
  saveFrameAnnotation: (frame: number, json: string) => void;
  getFrameAnnotation: (frame: number) => string | undefined;
  clearFrameAnnotation: (frame: number) => void;

  showSkeleton: boolean;
  toggleSkeleton: () => void;
}

export const useStore = create<AppStore>((set, get) => ({
  activeTool: 'select',
  settings: {
    strokeColor: '#FF3B30',
    fillColor: 'transparent',
    lineThickness: 3,
    opacity: 100,
    lineStyle: 'solid',
  },
  setActiveTool: (tool) => set({ activeTool: tool }),
  setSettings: (s) => set((state) => ({ settings: { ...state.settings, ...s } })),

  video: {
    file: null,
    file2: null,
    duration: 0,
    currentTime: 0,
    fps: 30,
    isSideBySide: false,
  },
  setVideoFile: (file) => set((state) => ({ video: { ...state.video, file } })),
  setVideoFile2: (file) => set((state) => ({ video: { ...state.video, file2: file } })),
  setCurrentTime: (t) => set((state) => ({ video: { ...state.video, currentTime: t } })),
  setDuration: (d) => set((state) => ({ video: { ...state.video, duration: d } })),
  setFPS: (fps) => set((state) => ({ video: { ...state.video, fps } })),
  setSideBySide: (isSideBySide) => set((state) => ({ video: { ...state.video, isSideBySide } })),

  frameAnnotations: {},
  saveFrameAnnotation: (frame, json) =>
    set((state) => ({ frameAnnotations: { ...state.frameAnnotations, [frame]: json } })),
  getFrameAnnotation: (frame) => get().frameAnnotations[frame],
  clearFrameAnnotation: (frame) =>
    set((state) => {
      const { [frame]: _, ...rest } = state.frameAnnotations;
      return { frameAnnotations: rest };
    }),

  showSkeleton: false,
  toggleSkeleton: () => set((state) => ({ showSkeleton: !state.showSkeleton })),
}));
