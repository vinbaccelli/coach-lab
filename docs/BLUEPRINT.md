# Blueprint (the eBook's stroke definitions) and the technical-sheet checks

Source: the AngleMotion eBook "Tennis Mechanics" (Google Doc `1-Kt54wM5…`), read 2026-11-19. Transcribed into
`lib/players/blueprint.ts`: the Part 1 Fundamentals Check and Part 2 Personal Variants Blueprint for groundstrokes,
"Fundamentals Check — Serve" + "Your Serve Variants Blueprint", "Fundamentals Check — Volleys" + "Your Volley Blueprint".
**Read so far: those sections and the intro; the chapter bodies, error tables and strategy parts are not yet read or used.**

The connection (architect, 2026-11-19):
1. Blueprint = the definition: per stroke, the checkpoints of each step and the variants (the player's choices).
2. Blueprint tab = this player's chosen option per variant (or "Other" in the coach's words).
3. Technical tab = the Fundamentals check: every book checkpoint marked (the book's own answer sets; faults are the
   answers the book marks "(error)" / "(problem)"), plus one "executing the chosen variant correctly?" check per choice.

Storage: `players.blueprint` (jsonb, additive migration `20261119100000_player_blueprint.sql`), cleaned by
`sanitizeBlueprint` on every save (`PATCH /api/players/[id]`). An execution mark keeps the option it was made against.
Plans: Light and Pro (architect's decision) — same `players` gate as the rest of the player database.

Assumptions to confirm (not stated by the book): variant-to-step mapping follows the book's chapters (e.g. racket drop
style -> G4, lag setup -> G5); the serve checkpoints are statements without answers, so the app's OK / Needs work / Not seen
is used; the three groundstrokes share one checklist (the book lists it once).

Not built yet: the client's share link does not show the Blueprint tab; Part V (video analysis) and the error tables are
not used; no scoring.
