# GOOGLE_VERIFICATION_DEMO.md — TEMPORARY FOR GOOGLE OAUTH VERIFICATION

Purpose: expose the Google Docs / Drive / YouTube features on a **separate
verification deployment** so the Google OAuth demo videos can be recorded,
**without changing anything** on anglemotion.com production.

---

## How it works (design)

The entire Google surface was already built and hidden behind two compile-time
flags in `lib/featureFlags.ts` (`ENABLE_GOOGLE_EXPORTS`, `ENABLE_YOUTUBE_UPLOAD`).
Those flags now read an env var:

```
NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO=1   →  both flags true (verification deployment ONLY)
env var absent                           →  both flags false (anglemotion.com — byte-identical to before)
```

Nothing else changed. **No OAuth implementation, scopes, authentication logic,
or backend API was modified.** The scopes requested when the flag is on are the
pre-existing `GOOGLE_EXPORT_SCOPES` constant (untouched):
`youtube.upload`, `documents`, `drive.file`.

## Files modified

| File | Change |
|---|---|
| `lib/featureFlags.ts` | The two flag constants now derive from `NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO === '1'` instead of hardcoded `false`. Marked with `// TEMPORARY FOR GOOGLE OAUTH VERIFICATION`. |
| `GOOGLE_VERIFICATION_DEMO.md` | This file. |

That is the complete list. The 9 files that *consume* the flags
(login/useAuth scope request, analysis page, GenerateWorkspace,
StroMotionPreviewModal, ManualMatchRecorder, AiMatchDecoderClient,
exportService) are **unmodified** — they light up automatically when the flags
are true, exactly as they were designed to after verification approval.

## Infrastructure (created for this)

- **Vercel project `anglemotionverification`** → `https://anglemotionverification.vercel.app`
  - Same GitHub repo, production branch: **`google-verification`**
  - Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
    `NEXT_PUBLIC_GOOGLE_VERIFICATION_DEMO=1`
  - Deployment protection disabled (the demo URL must be publicly reachable).
- **Git branch `google-verification`** — pinned snapshot the project deploys from.
- **Supabase Auth redirect allowlist** — added
  `https://anglemotionverification.vercel.app/auth/callback` so Google sign-in
  can return to the verification domain. (Google Cloud Console needs **no**
  change: the OAuth redirect URI is Supabase's callback, already authorized.)

## How to revert everything

1. `lib/featureFlags.ts`: replace the `GOOGLE_VERIFICATION_DEMO` block with the
   original two lines:
   ```ts
   export const ENABLE_GOOGLE_EXPORTS = false;
   export const ENABLE_YOUTUBE_UPLOAD = false;
   ```
2. Delete this file.
3. Delete the Vercel project `anglemotionverification` (Dashboard → project →
   Settings → Delete, or leave it paused — it costs nothing and can be reused
   for future re-verification).
4. Delete the `google-verification` branch: `git push origin :google-verification`.
5. Remove `https://anglemotionverification.vercel.app/auth/callback` from
   Supabase → Authentication → URL Configuration → Redirect URLs.

Note: production never needs a revert deploy — with the env var absent, the
flag change is inert (`false`), so anglemotion.com behavior is already
identical to pre-change.

> After Google approves the verification, the intended permanent change is
> simply `ENABLE_GOOGLE_EXPORTS = true` / `ENABLE_YOUTUBE_UPLOAD = true` in
> production (see the original comment in `lib/featureFlags.ts`).

## Prerequisites before recording

1. Use the verification URL: **https://anglemotionverification.vercel.app**
2. Sign in with a Google account that is a **test user** on the OAuth consent
   screen (while the app is unverified, only test users can grant the sensitive
   scopes). Expect the "Google hasn't verified this app" interstitial —
   click *Continue*; that is normal for verification recordings.
3. Sign in with `vinbaccelli@gmail.com` (admin) so the `/analysis` subscription
   gate does not interfere, **or** any test account with an active subscription
   (same Supabase DB as production).
4. **Sign out and back in once** on the verification domain — the sensitive
   scopes are requested at sign-in, so a session created before the flag was
   active has no Drive/YouTube token.
5. Have a short MP4 ready to upload for the analysis/recording steps.

## Demo script (maps to what AngleMotion actually does)

⚠️ **Honest scope note:** AngleMotion has **no Google Sheets feature** and no
generic Drive folder *browser*. The requested scopes are `documents`,
`drive.file`, and `youtube.upload` — and the demo must show exactly those.
"Read Sheets" is not part of the app or its scope request; do not promise it in
the recording. What the app demonstrably does:

1. **Sign in with Google** (`/login`) — consent screen shows the three scopes.
2. **Google Docs + Drive (`documents` + `drive.file`)** — in Video Analysis:
   create snapshots (AI Detect) → Metrics **Generate** → *Export Google Docs
   report*. The app creates a Google Doc, uploads snapshot images, and files
   everything into its own `AngleMotion/Reports` Drive folder (auto-created).
3. **Per-player Drive organization** — attach the report to a player (or open a
   player page): the app creates/updates the player's technical Google Doc
   inside `AngleMotion/Players/<name>/` and **saves changes back** (sessions are
   inserted at the top of the doc — this is the "write back to Drive" demo).
4. **YouTube (`youtube.upload`)** — in Generate: *Record replay video* → tick
   *Upload video* → export. The video uploads **Unlisted** to the signed-in
   channel and the report links to it. (Same flow exists in the StroMotion
   preview modal and the Match Report tool.)

## Status of this deployment

Created 2026-07-11. Deployment details (project id, branch head) are in the
Vercel dashboard under `anglemotionverification`.
