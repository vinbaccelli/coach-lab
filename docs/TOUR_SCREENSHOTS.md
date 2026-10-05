# Guided-tour step pictures

Every tour step can show a small real screenshot (`TourStep.image`). They are
cut from the founder's captures in `marketing-originals/` (on
`claude/landing-screenshots`) and saved as WebP, 480 px wide, at most 60 KB,
under `public/tours/<tour-id>/`. Nothing is mocked: a step with no suitable
capture shows no picture.

To add one: capture the screen (full browser window, 2880 px wide on a Retina
Mac is what the existing originals are), add it to `marketing-originals/`,
cut a crop around the control (about 900 × 560 px of the original for a
panel, about 1300 × 810 for the canvas), and add `image: shot(...)` to the
step in `components/tours/<tour>Tour.ts`.

## Steps that need a capture (Vin)

All on /analysis, desktop browser, with a clip loaded (Demo (Tutorial) is fine).

### Draw and angles

| Step | What to capture |
|---|---|
| `style-open` — Style | Metrics → Draw → **Style** pressed: the style panel open (colours, thickness, dash, opacity). |
| `style-pick-mark` — Pick a mark | Style mode on, with one finished mark on the frame **selected** (its selection handles showing). |
| `style-colour` — Give it a colour | Same as above, just after picking **blue**: the selected mark now blue, the blue swatch highlighted. |
| `select-tool` — Back to Select | The toolbar with **Select** active (highlighted) and a few marks on the frame. |
| `move-mark` — Move a mark | With Select active, a mark being dragged (mid-drag, or the mark in its new place with the old spot visible). |
| `done` — That's the Draw toolkit | Optional: one frame showing angle arrows, the angle-differential column, a pen mark and a restyled mark together. |

### Getting started

| Step | What to capture |
|---|---|
| `done` — You're set up | Optional: the frame after AI Detect Angles, with the data column filled. |
| `skeleton-check` (has a picture, could be better) | The **“Is the skeleton over the player?”** prompt with its Yes / No buttons, right after switching the skeleton on. |

### Player database

| Step | What to capture |
|---|---|
| `screenshot` — Save a screenshot to a player | Video analysis after pressing **Screenshot**: the **Save Screenshot** sheet with the frame preview and the list of players to save to. |
| `where` — Where your files live (optional) | A player's **Drive folder** open in Google Drive (AngleMotion / Players / <name>) showing the Technical and Match Analysis Docs. |

### App overview

| Step | What to capture |
|---|---|
| `academy` — AngleMotion Academy | The **/academy** library with its Guides, eBooks and Drills & Exercises sections. |
| `billing` — Account & billing | **/billing** with an active plan (Plan, Status, Manage billing). |
