# Phone video shrink (V1)

**What:** on a phone, a video larger than the phone's tier is re-encoded (WebCodecs H.264 -> MP4 with a seek index, via `mediabunny`) before it opens, so the skeleton / Motion Layer work on fewer pixels. Desktop is unchanged (`loadVideoFileIntoSlot` in `app/analysis/page.tsx` opens the file synchronously off a phone).

**Tiers** (`lib/phoneShrink/tier.ts`, long edge): 1080p = 1920 (default on a phone), 720p = 1280, 540p = 960.
- iOS hides device memory, so the tier is learned: when the last Auto-detect was killed by the phone (the existing marker in `phoneBudget.ts`), the stored tier (`localStorage anglemotion:shrinkTier`) drops one step.
- Force a tier: `/analysis?shrink=720` (remembered on a phone; on a desktop it only shrinks for that visit, for testing).
- A clip already within the tier is not touched; clips longer than 5 minutes open as they are (the result is held in memory).
- The coach can tap **Skip** while it runs; any failure opens the original file.

**Known limits:** the shrunk copy is what the page analyses and what Export uses on that phone (so exports are at most the tier's size on that phone). The original file is not modified.

Measured on an iPhone (Chrome, 4K portrait, 14 s, 79 MB): 1080p H.264 encode runs at about real time (0.88x), no crash.
