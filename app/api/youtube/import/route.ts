export const runtime = 'nodejs';

export async function POST(req: Request) {
  // URL imports no longer use server-side downloads / YouTube uploads.
  // This endpoint is kept as a stub so old clients don't crash if still calling it.
  await req.json().catch(() => null);
  return Response.json(
    { ok: false, error: 'URL import no longer uses server-side YouTube uploads.' },
    { status: 410 },
  );
}

