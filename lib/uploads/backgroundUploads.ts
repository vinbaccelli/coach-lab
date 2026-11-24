/**
 * Background uploads: a video going to YouTube keeps uploading while the coach moves on (another page, another
 * analysis). The queue lives at module level, i.e. as long as the browser tab does (client-side navigation
 * never ends it), and the tray in the app shell (components/UploadTray.tsx) shows it wherever the coach is.
 *
 * What it cannot do: it cannot outlive the tab. Closing the tab, reloading, or the phone suspending the page
 * ends the upload (the file is in this page's memory); the tray asks before the tab is closed while one runs.
 *
 * One upload at a time (YouTube's quota and a phone's bandwidth). No React here, so it is unit-tested.
 */

export type UploadStatus = 'queued' | 'uploading' | 'saving' | 'done' | 'error';

export interface UploadJob {
  id: string;
  label: string;
  status: UploadStatus;
  /** 0..1 while uploading. */
  progress: number;
  error?: string;
  /** The YouTube link, once the upload finished (kept on an error after it so the coach can paste it). */
  url?: string;
}

export type UploadResult = { ok: boolean; url?: string; error?: string; needsConnect?: boolean };
export type UploadRunner = (file: Blob, title: string, onProgress: (fraction: number) => void) => Promise<UploadResult>;

export interface EnqueueInput {
  file: Blob;
  title: string;
  /** Shown in the tray, e.g. "Video for Alex". */
  label: string;
  /** Runs once the video is on YouTube (e.g. adds it to the player's timeline). May throw: the job then says so. */
  afterUpload?: (url: string) => Promise<void>;
}

export function createUploadQueue(run: UploadRunner) {
  let jobs: UploadJob[] = [];
  const inputs = new Map<string, EnqueueInput>();
  const listeners = new Set<() => void>();
  let running = false;
  let seq = 0;

  const emit = () => { jobs = [...jobs]; listeners.forEach((l) => l()); };
  const patch = (id: string, p: Partial<UploadJob>) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
    listeners.forEach((l) => l());
  };

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = jobs.find((j) => j.status === 'queued');
        if (!next) break;
        const input = inputs.get(next.id)!;
        patch(next.id, { status: 'uploading', progress: 0 });
        let result: UploadResult;
        try {
          result = await run(input.file, input.title, (f) => patch(next.id, { progress: Math.max(0, Math.min(1, f)) }));
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : 'YouTube upload failed.' };
        }
        if (!result.ok || !result.url) {
          const msg = result.needsConnect
            ? 'Connect YouTube first (in the analysis app export menu), then upload again.'
            : result.error ?? 'YouTube upload failed.';
          patch(next.id, { status: 'error', error: msg });
          inputs.delete(next.id);
          continue;
        }
        patch(next.id, { url: result.url, progress: 1 });
        if (input.afterUpload) {
          patch(next.id, { status: 'saving' });
          try {
            await input.afterUpload(result.url);
          } catch (e) {
            patch(next.id, { status: 'error', error: `It is on YouTube (${result.url}) but could not be added: ${e instanceof Error ? e.message : 'failed'}` });
            inputs.delete(next.id);
            continue;
          }
        }
        patch(next.id, { status: 'done' });
        inputs.delete(next.id);
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue(input: EnqueueInput): string {
      const id = `upload-${Date.now().toString(36)}-${++seq}`;
      inputs.set(id, input);
      jobs = [...jobs, { id, label: input.label, status: 'queued', progress: 0 }];
      emit();
      void pump();
      return id;
    },
    /** Remove a finished or failed job from the tray. A running one cannot be dismissed. */
    dismiss(id: string): void {
      const j = jobs.find((x) => x.id === id);
      if (!j || j.status === 'queued' || j.status === 'uploading' || j.status === 'saving') return;
      jobs = jobs.filter((x) => x.id !== id);
      emit();
    },
    subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot(): UploadJob[] { return jobs; },
    /** True while something is queued or on its way (the tab must not be closed). */
    hasActive(): boolean { return jobs.some((j) => j.status === 'queued' || j.status === 'uploading' || j.status === 'saving'); },
  };
}

/** The app-wide queue. The runner is imported lazily so this file stays light and testable. */
export const uploadQueue = createUploadQueue(async (file, title, onProgress) => {
  const m = await import('@/lib/export/exportService');
  return m.uploadVideoToYouTube(file, title, onProgress);
});
