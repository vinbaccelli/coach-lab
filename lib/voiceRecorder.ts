'use client';

export interface VoiceNote {
  id: string;
  startTime: number;
  blob: Blob;
  url: string;
  duration: number;
}

export async function startVoiceRecording(): Promise<MediaRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  // Stop all tracks when the recorder is stopped so the mic indicator goes away
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((track) => track.stop());
  }, { once: true });

  return recorder;
}
