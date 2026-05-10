import {
  FIRST_BATCH_SUFFIX,
  MATCH_DECODER_SYSTEM_PROMPT,
  SECOND_BATCH_SUFFIX,
} from '@/lib/gemini/matchDecoderPrompt';

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callGemini(model: string, parts: GeminiPart[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return text.trim();
}

function imageParts(bufs: Buffer[], types: string[]): GeminiPart[] {
  return bufs.map((b, i) => ({
    inline_data: {
      mime_type: types[i] || 'image/png',
      data: b.toString('base64'),
    },
  }));
}

/**
 * Up to 16 images; >10 triggers two Gemini calls then merges via context on the second call.
 */
export async function decodeMatchScreenshots(imageBuffers: Buffer[], mimeTypes: string[]): Promise<string> {
  if (imageBuffers.length === 0) throw new Error('No images provided.');
  if (imageBuffers.length > 16) throw new Error('Maximum 16 screenshots.');

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

  if (imageBuffers.length <= 10) {
    const parts: GeminiPart[] = [{ text: MATCH_DECODER_SYSTEM_PROMPT }, ...imageParts(imageBuffers, mimeTypes)];
    return callGemini(model, parts);
  }

  const first = imageBuffers.slice(0, 10);
  const firstTypes = mimeTypes.slice(0, 10);
  const rest = imageBuffers.slice(10);
  const restTypes = mimeTypes.slice(10);

  const parts1: GeminiPart[] = [
    { text: MATCH_DECODER_SYSTEM_PROMPT },
    ...imageParts(first, firstTypes),
    { text: FIRST_BATCH_SUFFIX },
  ];
  const firstResponse = await callGemini(model, parts1);

  const parts2: GeminiPart[] = [
    { text: MATCH_DECODER_SYSTEM_PROMPT },
    {
      text: `Context from the first batch of screenshots (model notes — use with the additional screenshots below):\n\n${firstResponse}`,
    },
    ...imageParts(rest, restTypes),
    { text: SECOND_BATCH_SUFFIX },
  ];
  return callGemini(model, parts2);
}
