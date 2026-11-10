# Per-joint validation before smoothing — Skeleton Stage 2a, commit 2

`lib/skeletonValidate.ts` runs on every baked AI-Track segment **before** `smoothBakedTrack` (via `lib/skeletonRefine.ts`, called from `finishBakeCapture` in `components/Canvas.tsx`; both call sites).

| Check | Rule |
|---|---|
| L/R swap | a pair whose labels jumped to the other side's previous position is swapped back (vs previous *output* frame; persistent swaps stay repaired). Not applied when the sides are < 0.08 body-heights apart (crossing) or the step is tiny |
| Confidence | score < 0.2 ⇒ invalid |
| Temporal outlier | > 0.25 body-heights from the midpoint of its valid neighbours (velocity-independent) |
| Bone length | bone > 1.5× its local (±10 samples) median ⇒ blame the endpoint that is also off its neighbours by > 0.08 body-heights |

Invalid joints are **not deleted or invented**: score is capped to 0.05, so the overlay hides them, angles show "–" (commit 1), the smoother barely weights them, and playback lerp (min of scores) keeps them hidden. **No smoothing is added**; genuine swings pass untouched.

Rollback / comparison: `localStorage.setItem('anglemotion:skeleton-legacy','1')` (or `window.__skeletonLegacy = true`), then re-run AI Track ⇒ previous smoothing-only path. Temporary; remove once accepted.

## Measured (before = smoothing only, after = validate + smooth)

Synthetic, with ground truth (60 fps, 1.5 s):
- Truth tracks (forehand/serve/lateral, 60 and 30 fps): **0** swaps/invalidations (no false positives); wrist peak ratio unchanged.
- Confident-but-wrong outliers (vis 0.25, 220 px): visible max error 0.382 → 0.000 body-heights. *The existing smoother already repaired these on its own (mean error 0.00073 vs 0.00074): validation's gain there is marking them unknown, not accuracy.*
- L/R swaps (30 frames, all pairs): swaps vs truth **150 → 0**, mean error 0.0865 → 0.0028. The smoother cannot repair swaps.

Real MediaPipe-heavy detections on the Demo clip (desktop CPU; visible = score ≥ 0.2):
| Run | Frames | Flagged | Visible jumps raw → smooth only → validate+smooth |
|---|---|---|---|
| Large player (1080p, 90 f) | 90 | 0 | 0 → 0 → 0 |
| Large player (250 f scan) | 250 | 0 | 0 → 0 → 0 |
| Small player (½ scale, body ≈ 281 px; 69 of 90 frames detected) | 69 | 91 low-score, 198 outlier, 4 bone | 86 → 67 → **12** |

**Caveat (needs your eyes):** on the small-player run validation hides many more joint-frames (371 vs 169 of 828). There is no ground truth for real footage, so I cannot say how many hidden joints were actually correct. Whether it looks better is a visual judgement on real far-court clips. The thresholds (0.25 / 1.5 / 0.08 / 0.2) are my choices, not tuned on real data.

## Limitations
- First-frame L/R swap can't be detected (no previous frame). Player-lock matching still decides the initial player.
- Only applies to AI Track bakes (not live skeleton).
- Real-footage accuracy and iPhone/Android behaviour need physical-device testing.

## Manual test
1. Same clip, AI Track (e.g. a far-court player): compare with `localStorage['anglemotion:skeleton-legacy']='1'` (old) vs unset (new). Expect fewer wandering joints; some low-confidence joints now hidden instead of drifting.
2. A fast serve/forehand: the swing must keep its speed (no new lag/flattening) and the wrist must not vanish at peak speed. If it does, tell me the clip.
3. A clip where the player turns/crosses legs: no left/right flipping.
