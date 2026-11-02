# Phone test sheet — one session, about 30 minutes

For Vin, phone in hand. Each PR is tested on **its own Vercel preview** (the "Preview" link in the Vercel
comment on that PR). Order as requested: #117, #116, #118, #119, #123, #121, #125, #122; #127 is added at
the end (it is in the merge list but was not in your order; skip it if time runs out).

**Not on this sheet (no phone test needed):** #120 (Stripe webhook, server only), #124 (dependency
triage, doc only), #126 (CI smoke job), #128 (share-link plan, doc only).

**Time budget:** #117 5 · #116 4 · #118 5 · #119 4 · #123 2 · #121 3 · #125 4 · #122 1 · #127 2 = 30 min.

## Before you start (2 min, once)

- iPhone, Safari (and Chrome once if you can). Be signed in with the Google account that has Drive.
- Have two clips ready: the **slow** one (720×1280) and a **fast** one (720×404). Any clip works where a
  step says "a clip".
- Have one **existing player** and be ready to make one **brand-new player**.

## What to send me on any failure (same for every step)

1. PR number and step number (for example "#118 step 3").
2. One sentence: what you did and what happened instead.
3. A screenshot or screen recording of the moment it went wrong.
4. Phone model, iOS version, Safari or Chrome, portrait or landscape.
5. If the step involves analysis or export: open the page with `?vdebug=1` and screenshot the debug panel.
   (On previews without #121, sign in first, then add `?vdebug=1` to the address; sign-in drops it.)

---

## 1. PR #117 — AI Track on slow clips + export analysis (5 min)

1. Open the #117 preview, sign in, go to `/analysis`, then add `?vdebug=1` to the address.
2. Load the **slow** clip. Run AI Track.
   **Pass:** it finishes, a note "This video seeks slowly: analysis may take about X s…" shows for a moment,
   the skeleton follows the player (not frozen), and the debug panel lists seek times.
3. Load the **fast** clip. Run AI Track.
   **Pass:** no "seeks slowly" note, and it takes about as long as it always did.
4. On the slow clip, start AI Track and press Cancel.
   **Pass:** it stops within about 4 seconds and the toolbar goes back to idle.
5. Metrics → export with the skeleton on, on a normal clip.
   **Pass:** the exported video looks the same as before, with the skeleton on the player.

(A seek that truly stalls cannot be forced. If you ever see a closable message about it, screenshot it.)

## 2. PR #116 — section handles, plain section export, Generate on a phone (4 min)

1. Open the #116 preview, load a clip, open **Metrics** (take no snapshot).
   **Pass:** the green section handles appear on the timeline straight away.
2. Open **Motion Layer**. **Pass:** the handles appear as soon as it opens.
3. Leave Metrics with the toolbar **Back** button. **Pass:** the green handles disappear again.
4. Generate a section with every Include switch **off**, speed 0.5×, sound on.
   **Pass:** you get an MP4 about twice as long, with sound, and only the watermark drawn on it.
5. Look at the Generate panel in portrait and landscape.
   **Pass:** one full-screen sheet, the Export button always on screen, no sideways scrolling.

## 3. PR #118 — drawing tools on a phone (5 min)

1. Open the #118 preview, load a clip, turn **precision on**, draw a line, switch to **Select**, tap the
   line and drag it. **Pass:** the line is selected and moves with your finger.
2. Add a measurement so the **data column** shows. Press its header.
   **Pass:** drag dots and a round knob appear, and dragging moves it but keeps it inside the video.
3. Drag the round knob at the bottom-right corner. **Pass:** the column resizes.
4. Choose the **Text** tool, tap the video, type a word with the keyboard.
   **Pass:** the box stays open while you type, and the text is drawn when you finish.
5. Open the Draw list. **Pass:** Text is right after Style, and Style's first option is Text size.

## 4. PR #119 — timeline tabs and expanded toolbar (4 min)

1. Open the #119 preview, load a clip, make a selection on the timeline.
   Put your thumb on the **right tab**, aiming slightly low on purpose.
   **Pass:** the tab moves; the ball does not.
2. Put the playhead ball directly under the **left tab** and grab the tab.
   **Pass:** the tab moves; the ball does not.
3. Portrait: expand the toolbar.
   **Pass:** it floats over the video (the video does not shrink), the play controls stay visible, the
   tool list scrolls, and one tap on the close button closes it.
4. Rotate to landscape and expand again.
   **Pass:** the tools are reachable by scrolling and the close button is reachable.

## 5. PR #123 — faster first screenshot save for a player (2 min)

1. Open the #123 preview and save a screenshot to a **brand-new player**.
   **Pass:** it saves and the report or link appears. Count the seconds and tell me.
2. Save a second screenshot to an **existing player**.
   **Pass:** it saves, and noticeably faster than the first. In Drive, the player's folder holds both images
   and there is **only one** "Screenshots" folder.

## 6. PR #121 — sign-in keeps the query; private standalone Docs (3 min)

1. Sign out. Open the #121 preview at `/analysis?vdebug=1` and sign in with Google.
   **Pass:** you land on `/analysis` and the debug panel is there.
2. In the decoder, use the button that exports to a new Google Doc, then open that Doc in a private tab
   where you are not signed in. **Pass:** Google asks you to sign in or says you have no access.
   (Docs made before this PR stay link-editable; only new ones are private.)
3. The YouTube "daily upload limit" message cannot be provoked on purpose. If an upload fails, send me the
   exact message text.

## 7. PR #125 — dependency updates (4 min)

1. Open the #125 preview, sign in with Google. **Pass:** you land back where you started.
2. `/analysis`: load a clip, step, play. **Pass:** nothing odd.
3. Run Generate and export a short clip. **Pass:** the MP4 downloads and plays.
4. Open a player's reports and one entry. **Pass:** the report shows.
5. Import a video from a YouTube link. **Pass:** the clip loads (this is the only place `undici` runs).
6. Download a match report PDF. **Pass:** the PDF opens with text and images.
7. Tap "Report a problem" if you see it. **Pass:** it opens and sends.

## 8. PR #122 — wording and privacy policy (1 min, reading only)

1. Open the #122 preview home page and read the sections about reports.
   **Pass:** reports are described as kept in AngleMotion, screenshots in your own Drive; no claim that
   reports are a Google Doc.
2. Open `/privacy`. **Pass:** you can see **8 yellow `[VIN TO CONFIRM]` tags**.
   These are decisions for you, not bugs. They must be resolved before this PR is merged.

## 9. PR #127 — player profile layout (2 min, optional)

1. Open the #127 preview, open a **real player**.
   **Pass:** header card with name, age/nationality/hand, a "reports" jump link, then grouped sections.
2. Tap a suggestion such as "+ UTR", type "7.5". **Pass:** a "UTR 7.5" chip appears in the header and a save
   bar appears.
3. Tap Save. **Pass:** "Saved ✓". Then turn on airplane mode, change a value, Save.
   **Pass:** an error and "Your changes are still here", with Try again; the text you typed is untouched.
4. Rotate to landscape. **Pass:** nothing cut off or overlapping; reports tabs and search still work.

---

## After "merge all": 3 quick re-checks (not in the 30 minutes)

These are the places where two PRs touch the same code, so test them once on the merged result:

1. **Data column on the video (#116 + #118):** select the column — drag dots and the round knob show; deselect —
   they hide. Generate a video with the data column on: it still looks like the screen.
2. **Metrics Back and the expanded toolbar (#116 + #119):** open Metrics, expand the toolbar (it overlays the
   video), close it, leave Metrics with Back — the green handles go away.
3. **Screenshot save (#121 + #123):** save a screenshot to an existing player; it saves and the image opens
   from the report.

---

## Appendix — integration dry run (what "merge all" will do)

Done on a throwaway local branch `test/integration-dryrun` from `main` (`9db01dd9`), never pushed, never a PR.
The PRs were merged in this order; each merge was followed by `npx tsc --noEmit`, `npm test` and `npm run build`.

| # | PR | Conflict | tsc | npm test | build |
|---|----|----------|-----|----------|-------|
| 1 | #117 | no | 0 errors | 441/441 | pass |
| 2 | #116 | no | 0 errors | 456/456 | pass |
| 3 | #119 | **yes** — `app/analysis/page.tsx` (one import line, lines 61–66), `docs/KNOWN_ISSUES.md` (both append at the end) | 0 errors | 459/459 | pass |
| 4 | #118 | **yes** — `components/Canvas.tsx` (lines 7240–7316, the on-screen data column drawing), `docs/KNOWN_ISSUES.md` | 0 errors | **1 failed**, then 465/465 after a one-line test update (see below) | pass |
| 5 | #120 | **yes** — `docs/KNOWN_ISSUES.md` | 0 errors | 474/474 | pass |
| 6 | #121 | **yes** — `docs/KNOWN_ISSUES.md` | 0 errors | 487/487 | pass |
| 7 | #123 | **yes** — `docs/LESSONS_LEARNED.md` | 0 errors | **1 failed**, then 505/505 after a one-line test update (see below) | pass |
| 8 | #125 | no (needed `npm ci`: dependencies changed) | 0 errors | 505/505 | pass |
| 9 | #127 | no | 0 errors | 525/525 | pass |

**Result: all nine merge, and the final tree is green** (tsc 0 errors, 525/525 tests, build passes), with
the conflicts below resolved by hand. Pairwise, the only conflicts between any two of the nine are:
#116+#118 (`Canvas.tsx`), #116+#119 (`page.tsx`), and doc files (`KNOWN_ISSUES.md`: #117, #118, #119, #120,
#121 all append at the same place; `LESSONS_LEARNED.md`: #117 and #123).

### Conflict list and the smallest resolution

- **#116 + #119, `app/analysis/page.tsx`, one import line (lines 61–66).** #116 widened the
  `@/lib/aiTrackScope` import (`displayedSection, metricsSectionShown, motionSectionShown, selectedSection`);
  #119 added `import { overlayBottomInset } from '@/lib/timelineView'`. Resolution: keep #116's widened line and
  add #119's new line. **`components/ToolPalette.tsx` does not conflict** (git merges it cleanly; both the
  `onNavigateBack` change and the overlay toolbar survive; tsc and tests pass).
- **#116 + #118, `components/Canvas.tsx` (7240–7316).** The only real code conflict. #116 replaced the inline
  data-column drawing with a shared `drawDataColumnBox(…, handles)` (used by the screen and by the generated
  video). #118 edited the old inline drawing (handles and the round knob only while the column is selected).
  Resolution: keep #116's call, pass `mcSelectedRef.current` as `handles`, and move #118's knob drawing into
  `drawDataColumnBox`'s `if (handles)` block (≈ 15 lines). The generated video still passes `false`, so it is
  unchanged.
- **Test follow-ups (not code):** two tests pin source text that moved.
  - `tests/exportDataColumn.test.ts` expects the call to end `…, s, true)`; after the resolution it is
    `…, s, mcSelectedRef.current)`. One regex edited. The test still checks that the screen and the video
    share one drawing function.
  - `tests/standaloneDocPrivate.test.ts` (from #121) expects the `anyone` permission in
    `app/api/google/upload-image/route.ts`; #123 moved it, unchanged, into `lib/google/drive.ts`. The test
    now reads that file.
  Both were edited on the throwaway branch only so the run could continue. Under CLAUDE.md §5 these edits
  follow moved code, not weakened assertions, but they need your approval on the real PRs.
- **Docs, every "yes" row above except #116/#118:** two PRs append a new entry at the end of
  `docs/KNOWN_ISSUES.md` (or `LESSONS_LEARNED.md`). Resolution: keep both. The merged file has no duplicate
  entry numbers (#117 adds 066 and 067, #118 076, #119 077, #120 078, #121 079–081), though 077 sits before 076.

### How to merge in the real repository

Merging the nine into `main` one by one means: after each merge, the next PR branch is behind `main` and has
the conflicts above. The cheapest path is, per PR in your order, to merge `main` into that PR's branch,
resolve as described, push, wait for `checks`, then you press merge. I will not touch any PR branch until you
say "merge" (and for which group), and I will tell you which test lines I edit.

Nothing on `main` or on any real PR branch was changed by this dry run.
