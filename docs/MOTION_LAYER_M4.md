# Motion Layer M4 — autosave and recovery of the editable draft

**Problem.** The Motion Layer draft (frame times, selection boxes, masks, labels, status) lived only in React state. A refresh, a
Safari page restart or navigating away destroyed all of the coach's work.

**Design (option A, approved).** Save the *editable draft* locally in the browser (IndexedDB `anglemotion-motion-layer`/`drafts`),
keyed by a fingerprint of the source video. The video is never copied or uploaded and nothing is stored remotely.

| Saved | Not saved (re-created from the re-picked video) |
|---|---|
| objectType, start/end/frame count/background, sample times, frame labels, statuses, selection boxes, ai/working/ready masks (run-length coded), batch scale reference | the video, `sourceFrame` bitmaps, background plate |

- `lib/stroMotionDraft/persist.ts` — pure: mask RLE, record, fingerprint match (size, resolution, duration, head+tail 64 KB hash; name/date may change).
- `lib/stroMotionDraft/persistStore.ts` — IndexedDB; every call returns a result, never throws. One put per video = one transaction, so an interrupted write keeps the previous record.
- `lib/stroMotionDraft/restoreDraft.ts` — rebuild a draft from a record + the video; a mask that fails to decode drops that frame to `pending`.
- `hooks/useMotionLayerPersistence.ts` — debounced autosave (1.5 s quiet), never overwrites saved work with an empty draft, offers Restore when the loaded video matches, requests persistent storage, turns quota/unavailable errors into a plain notice.
- `components/stroMotion/RestoreBanner.tsx` — Restore / Start fresh, "load the same video" hint, save-problem notice.
- Explicit **Clear** deletes the saved copy; loading another video does not.

**Interrupted Generate.** Generate never touches the saved record (it only reads the draft), and autosave is a separate write.

**Verified (desktop, headless Chromium, not iPhone).** Seeded record → banner appears for the matching video → Restore rebuilds 3 frames
(label, ready status, masks) → autosave re-writes the record. `tsc` 0 errors, `npm test` 473/473.
**Not verified:** real iPhone/Safari behaviour (eviction, storage limit), a full Generate cycle after restore, the user flow end to end.
