'use client';

import { useState, useRef } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { VoiceNote, startVoiceRecording } from '@/lib/voiceRecorder';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  voiceNotes: VoiceNote[];
  onVoiceNote: (note: VoiceNote) => void;
  onDeleteVoiceNote: (id: string) => void;
}

export default function VoiceOverTool({
  videoRef,
  voiceNotes,
  onVoiceNote,
  onDeleteVoiceNote,
}: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);

  const handleStartRecording = async () => {
    try {
      const recorder = await startVoiceRecording();
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      startTimeRef.current = videoRef.current?.currentTime || 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `voice-${Date.now()}`;
        audio.onloadedmetadata = () => {
          onVoiceNote({
            id,
            startTime: startTimeRef.current,
            blob,
            url,
            duration: audio.duration,
          });
        };
        audio.onerror = () => {
          onVoiceNote({
            id,
            startTime: startTimeRef.current,
            blob,
            url,
            duration: 0,
          });
        };
      };

      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start voice recording:', error);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <button
        onClick={isRecording ? handleStopRecording : handleStartRecording}
        style={{
          height: '36px',
          paddingLeft: '12px',
          paddingRight: '12px',
          borderRadius: 'var(--radius-sm)',
          background: isRecording ? '#FF3B30' : 'var(--bg-tertiary)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontSize: '13px',
          fontWeight: 500,
          color: isRecording ? 'white' : 'var(--text-primary)',
          transition: 'var(--transition)',
        }}
      >
        {isRecording ? <Square size={16} /> : <Mic size={16} />}
        {isRecording ? 'Stop' : 'Record Voice'}
      </button>

      {voiceNotes.length > 0 && (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {voiceNotes.map(note => (
            <div
              key={note.id}
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = note.startTime;
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                marginBottom: '4px',
              }}
            >
              <Mic size={14} style={{ color: 'var(--accent)' }} />
              <div style={{ flex: 1, fontSize: '12px' }}>
                <div style={{ color: 'var(--text-primary)' }}>{Math.floor(note.startTime)}s</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                  {note.duration.toFixed(1)}s
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteVoiceNote(note.id);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: 'var(--danger)',
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
