# Background YouTube uploads

A video uploaded to YouTube from a player's timeline keeps uploading while the coach moves on.

- `lib/uploads/backgroundUploads.ts`: an app-wide queue (module level, one upload at a time). The timeline's "Upload video to YouTube" enqueues a job; when the video is on YouTube the job adds it to the player's timeline (`POST /api/players/<id>/timeline`) and tells an open timeline to refresh (`anglemotion:timeline-changed`).
- `components/UploadTray.tsx`: mounted in `app/layout.tsx`, so progress shows on every page. Finished uploads clear after 6 s, failed ones stay until dismissed. While one runs, closing the tab asks first.
- Tests: `tests/backgroundUploads.test.ts` (queue), `scripts/local-stack/e2e/background-upload.e2e.mjs` (leave the page mid-upload, YouTube mocked).

**Limit (by design, no new infrastructure):** the upload runs in the browser tab. Moving between pages, starting an analysis, or opening another player does not stop it (client-side navigation keeps the page's JavaScript alive). Closing the tab, reloading, or a phone suspending the page does. Making it survive that would need the file stored on a server and uploaded from there, which is storage and cost that has not been decided.

Not moved to the queue yet: the uploads started from inside the analysis app (Recording Hub, Generate workspace), which report back to their own screens.
