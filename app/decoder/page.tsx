import WorkspaceChrome from '@/components/WorkspaceChrome';
import AiMatchDecoderClient from '@/components/decoder/AiMatchDecoderClient';

export default function DecoderPage() {
  return (
    <WorkspaceChrome pageLabel="AI match decoder">
      <div style={{ padding: '20px 16px 40px' }}>
        <AiMatchDecoderClient />
      </div>
    </WorkspaceChrome>
  );
}
