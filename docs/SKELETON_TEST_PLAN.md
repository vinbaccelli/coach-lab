# Skeleton test plan (PR #153 preview, includes #152) — phone, step by step

Base link (PR #153, which contains everything from #152):
`https://anglemotion-v1-git-skeleton-stage2-40fc0e-vinbaccellis-projects.vercel.app/analysis`

## The three modes (each is just a link; the choice sticks until you open another link)
| Mode | Link | What runs |
|---|---|---|
| **A · Existing** | `…/analysis?debug=1&legacy=1` | previous behaviour everywhere (old AI Track bake, old live display, no look-ahead) |
| **B · Stage 2a** | `…/analysis?debug=1&legacy=0&lookahead=0` | new AI Track (crop, validation, frame gate) + new live display, **no** look-ahead |
| **C · Look-ahead** | `…/analysis?debug=1&legacy=0&lookahead=1` | everything new, including look-ahead live skeleton |
Reset to normal any time: `…/analysis?legacy=0&lookahead=1`.

After opening a link, the debug panel (bottom) shows the mode: `mode: LEGACY …` / `mode: NEW · look-ahead OFF|ON`. Take a screenshot right after load so it is visible. Use the same phone, same browser, same serve clip, same section, for every mode. Close other tabs first.

## Test 1 — live skeleton (AI Track OFF). Do it for A, B, C
1. Open the link, load the serve clip, wait until it is fully loaded.
2. Turn **Skeleton** on and confirm it (Yes ✓). Do **not** run AI Track.
3. Speed **0.25×** → play across the serve for ~10 s. While it plays, screenshot the panel. Judge: is the skeleton **behind / on / ahead** of the racket arm during the swing?
4. Repeat at **0.5×**, then **1×**.
5. Pause exactly on the contact frame: is the skeleton on the body? (the paused frame is unchanged by my work)
6. Stress (mode C especially): scrub while playing; change speed while playing; pause/resume 10 times. Any freeze, flicker, tab reload, slowdown?
7. Screenshot the panel at the end.
Panel lines I need while playing: `calls/s … sent/s … res/s`, `infer`, `rtt`; and in mode C the lines `look-ahead video started` / `released` / `failed (reason)`.

## Test 2 — AI Track (ON). Do it for A and B (look-ahead does not change AI Track; C = B)
Do it twice per mode: **(a) with the player locked**, **(b) not locked**.
1. Open the link, load the same clip, Skeleton on, confirm.
2. (a) lock the player the same way as before. (b) skip locking.
3. Select the same short range around the serve and start AI Track the same way as before (same speed tier every time). Wait until it finishes.
4. Screenshot the panel right away: I need the lines `bake: …` and, for locked runs, `locked crop: …`.
5. Play the tracked section at **0.25×** then **1×**. Judge: limbs correct (no legs-as-arms, no left/right flips)? same player all the time? arms present (not missing)? jitter ("drunk") yes/no? does the wrist keep up in the fastest part?
6. Data column: a hidden/occluded joint shows "–", not 0°.

## What to send back (per mode, per test)
- the panel screenshots listed above;
- one line each: **Live:** behind / on / ahead at 0.25× / 0.5× / 1×. **AI Track:** limbs ok? jitter? arms missing? 
- anything odd: freeze, reload, heat, `look-ahead failed (…)` line, device + browser + iOS/Android version.
Screen recordings of the swing at 0.25× and 1× in modes A and C are the best evidence if you can.
