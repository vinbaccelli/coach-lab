## CoachLab YouTube Resolver (Cloudflare Worker)

This Worker resolves a **YouTube URL** to a **direct stream URL** (signed URL) using pure JS:
- `@ybd-project/ytdl-core/serverless`

The CoachLab app then loads that URL through its same-origin proxy (`/api/video/stream`) so canvas/ML tools can work.

### Why this exists
- Cloudflare Workers free tier is fine for **small JSON responses**
- Cloudflare **does not allow** using Workers as a free video CDN/proxy for large media bytes
- So we only resolve YouTube to a direct URL, and the app fetches bytes itself

### Known limitations (prefer the Next.js resolver on Vercel)
The hosted app defaults to **`/api/youtube/resolve`** (Node.js), which can run YouTube’s decipher logic reliably.

On Workers, **runtime `eval` / signature deciphering is unreliable**, PoToken/jsdom often fails under Workers (`whatwg-url` / `generatedInterface.install` warnings), and InnerTube may return **zero formats** from datacenter IPs. Treat this Worker as **optional** unless you invest in a dedicated strategy that fits the Workers runtime.

### Deploy

1) Install Wrangler + deps:

```bash
cd workers/youtube-resolver
npm install
```

2) Login and deploy:

```bash
npx wrangler login
npm run deploy
```

3) Copy the deployment URL and set it in Vercel (Project → Env Vars):
- `NEXT_PUBLIC_YT_RESOLVER_URL=https://<your-worker>.workers.dev`

### Endpoints
- `GET /health`
- `GET /resolve?url=<youtube-url>` → `{ ok, directUrl, title, chosen }`

