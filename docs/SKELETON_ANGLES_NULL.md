# Missing joint angles are `null` (shown as a dash), never 0° — Skeleton Stage 2a, commit 1

## Root cause
`flushAnglesToColumn` (`app/analysis/page.tsx`) built the four live rows with `angleMap.get(label) ?? 0`, and `Canvas` only emitted angles whose three joints scored ≥ 0.2. A joint that dropped out (occluded, low confidence) therefore appeared as **0°** — also a real, fully-folded value.

## Consumer audit (everything that reads live angle rows)
| Consumer | Where | Result |
|---|---|---|
| Computation + emit | `Canvas.tsx` (was inline) | moved to pure `lib/skeletonAngles.ts#computeSkeletonAngles`; always emits 4 labels, `deg: number \| null` |
| Column rows (state) | `page.tsx` `flushAnglesToColumn` | `value: number \| null`; unknown → `null` |
| Column drawing | `Canvas.tsx` data-column draw loop | `formatAngleValue` → "–" for null (screenshots and video export draw this same canvas) |
| "Skeleton detected" confirm dialog | `handleSkeletonAnglesUpdate` | was `angles.length > 0` (would now always fire) → `hasAnyAngle(angles)` |
| Snapshots / stored analysis / Metrics export | `page.tsx` (4 sites) | live `skeleton-angle` rows were already stripped before persisting; now done by `persistableRows`, which also narrows `value` to `number` and drops null rows, so **stored data types and formats are unchanged** |
| AI Detect measurements | `page.tsx` | already skipped null (`!= null`); item type narrowed to numeric |
| Biomechanics `JointAngles` | `lib/biomechanics` | already `number \| null`; untouched |
| `SnapshotMeasurement.value`, `Snapshot.jointAngles` | `lib/snapshots.ts` | **unchanged** (`number`) |

## Manual test (needs a phone/desktop with the skeleton on)
1. Open a clip, turn Skeleton + Data column on, pause on a frame with a clearly visible player: four angles show degrees.
2. Seek to a frame where an arm/leg is hidden (or cover it): that row shows **–**, not 0°.
3. Take a Snapshot while a row shows –: the snapshot column contains no skeleton-angle rows (same as before).
4. Export a screenshot with the column visible: dash is drawn.
