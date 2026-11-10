# Player profile sharing: what was asked, and the build order (for approval)

Status: PLAN ONLY. No code, no migration. Nothing here is built until approved.
Detailed security and cost design already exists in `docs/REPORT_SHARE_PLAN.md` and
`docs/REPORT_SHARE_REVIEW.md` (branch `docs/report-share-plan`, PR #128). This page only records
the architect's latest wording and how it changes that plan.

## What was asked (2026-11-10/11)
1. The player must have access to their profile. The coach decides, per player, whether the
   player can **only view** or can **also add/edit**.
2. Comments and pictures can be added directly from the profile (built: timeline PR).
3. Videos go to YouTube as unlisted and the embed lands on the timeline (built: timeline PR).
4. On **Light**, the user can share their one profile with anyone they want.
5. No paid Vercel/Supabase tier (existing cost goal).

## Differences from the earlier share plan
| Earlier plan | Now |
|---|---|
| Link holders anonymous; contributions in phases A/B/C, off by default | One per-profile switch: view only / can add (comments, pictures, videos). Same default: view only. |
| Edits to profile fields as "suggested changes" the coach approves | Still the recommendation: a person with a link must not overwrite the coach's data. Needs an architect decision (see Q1). |
| Share only for paid plans | Light included, one profile (already true: Light has one player). |

## Build order (each step its own PR, phone test with each)
| Step | Adds | Needs migration |
|---|---|---|
| S1 | Share card on the profile: create / copy / revoke / replace a link; per-field "hide from shared page" switches. Token stored hashed (+ encrypted copy for re-copy). | yes: `player_shares` |
| S2 | `/share/<token>` read-only page: profile fields, timeline, progress graphs. Server-side allow-list; no coach ids, no other players. | no |
| S3 | "Can add" switch: link holders add comments and pictures (rate-limited, size-capped, never edit or delete the coach's items; coach can hide/delete theirs). | yes |
| S4 | Videos from link holders (YouTube link paste only; no uploads to our storage). | no |
| S5 | "Opened N times, last opened" without a write per view (batched). | maybe |

## Non-negotiable safety rules (from the review; unchanged)
- Access is by an unguessable token checked on the server; the browser never gets a database key
  that can read other rows. Every query on the share path is scoped to the one player.
- Revoke kills the old link in one step, including cached copies.
- Anonymous writes (S3/S4) have rate limits, size caps, and a coach kill switch. Junior players'
  data is visible by default only if the coach chose to share it (first-time warning).
- Link holders can never change profile fields (unless Q1 is answered differently, via approval).

## Questions for the architect
- **Q1.** Should the player be able to change profile fields, or only add comments/pictures/videos?
  Recommendation: add-only; field changes as "suggested changes" the coach approves.
- **Q2.** Is the "player" a link-holder (no account) or must they sign in? Recommendation for V1:
  link only, no player accounts (an account system is a separate, larger project).
- **Q3.** Approve S1-S5 as the order above, one PR each, starting only after the timeline and
  metrics PRs are merged and their migrations applied.
