import WorkspaceChrome from '@/components/WorkspaceChrome';
import MatchDecoderClient from '@/components/decoder/MatchDecoderClient';

/**
 * The match decoder.
 *
 * Now the deterministic OCR flow (lib/matchDecoder + lib/matchAnalysis) rather
 * than the Gemini one. `components/decoder/AiMatchDecoderClient` and
 * `app/api/gemini/decode-match` remain on disk but unreferenced — swapping the
 * import back is the whole revert.
 */
export default function DecoderPage() {
  return (
    <WorkspaceChrome pageLabel="Match decoder">
      <div style={{ padding: '20px 16px 40px' }}>
        <MatchDecoderClient />
      </div>
    </WorkspaceChrome>
  );
}
