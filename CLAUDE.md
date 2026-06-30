# CLAUDE.md — CoachLab / AngleMotion

## Project reality (read this first — it binds the process below)
- Next.js app (App Router) in this directory. The analysis surface is two ~7k-line
  files: `app/analysis/page.tsx` and `components/Canvas.tsx`. Treat both as hot,
  high-risk files — change surgically.
- **No automated test runner is configured** (scripts: `dev`, `build`, `start`,
  `lint`). Until one exists, "tests" in the protocols below are **dormant**, and
  the verification step means: `npx tsc --noEmit -p tsconfig.json` (0 errors) +
  the dev server recompiles the route clean + **manual runtime check** at
  http://localhost:3000 (the app is Supabase-auth-gated → the assistant cannot
  reach `/analysis`; runtime behavior is verified by the user).
- **No documented CI / production-deploy / versioning pipeline.** §8 stays
  dormant until one is documented; do not invent deploy/version steps.
- Architecture contract in force (Steps 1–3 landed): ONE analysis mode owns the
  canvas/column at a time (`live` | `snapshot` | `frame`); pose display writes are
  provenance-gated; no cross-mode column merging. Do not violate these.

---

# AI-Assisted Development — Working Agreement & Process
Tech-agnostic rules. Where a rule names tests/CI/deploy, apply "Project reality" above.

## 1. Code is the source of truth (read before you answer)
- Every factual claim about how the code works must be backed by code you *just
  read* — cite `file:line`. No answering from memory, names, comments, docs, or
  prior conversation.
- Applies to *every* question ("why", "what does X do", "is Y wired up"), not just
  change tasks. Decompose broad questions ("what's different?", "what's missing?")
  and read each item — that's exactly where guessing happens.
- Docs are derived FROM code, never the reverse. If a doc disagrees with code,
  fix the doc — never bend code to a doc.
- Reading first is cheap; a confidently-wrong answer is expensive.

## 2. Response style
- Concise. Terse explanations/conclusions; minimize reading load.
- When planning a change, give every point a stable ID (1a, 1b, 2a…). In later
  messages reference those IDs and account for *every* one (done / deferred /
  dropped-with-reason). Never silently drop a point.
- When you have enough info to act, act. Don't re-litigate settled decisions or
  list options you won't pursue — give a recommendation, not a survey.

## 3. Git policy (critical)
- NEVER auto-commit, push, merge, or switch branches. Run git write commands ONLY
  when explicitly told ("commit this", "push", "deploy"). After finishing code,
  STOP and wait for review.
- Never `git stash` — save WIP with `git commit -m "wip: ..."` (squash later).
- Before working a long-running feature branch, sync with main first (fetch,
  check ahead/behind, merge if behind). Don't start on a stale branch.

## 4. Bug report protocol (don't fix immediately)
1. Investigate & diagnose — MEASURE, don't guess. Reproduce, find the *root cause*
   with evidence. For "slow/broken/regressed", read/measure the real path BEFORE
   changing a line. Never change code speculatively "to see if it helps".
2. Present the diagnosis: root cause, proposed fix + files, what it does NOT touch,
   whether the same pattern exists elsewhere. WAIT for approval.
3. Apply the minimal fix — no scope creep, no "while I'm here" changes.
4. Add a regression test that fails before / passes after — **when a test runner
   exists** (see Project reality). Until then, define the exact manual repro that
   demonstrates the fix.
5. Verify: type-check + build (+ test suite when present) — 0 failures; then the
   user confirms runtime.
6. Document it (lessons-learned + known-issues; user manual if user-visible).

## 5. Test failure protocol (absolute — active once tests exist)
- A failing test signals a code bug. Find the root cause and fix the CODE.
- NEVER change a test to make it pass — no weakened assertions, no skip/xfail or
  exception-suppressors without explicit permission.
- Tests reflect the current API only — no backward-compat dual-path assertions;
  delete tests for removed behavior.
- Never kill a running suite before its summary line prints.

## 6. Protected behaviors & change approval
- Caches and anything that issues a live query / network round-trip are
  performance contracts. Never modify, relax, re-route, or change *when* they fire
  without describing the change and getting approval first (incl. "harmless"
  changes that flip a cache-hit into a live call).
- Project-specific protected invariants (do not touch without per-change approval):
  the analysis-mode ownership model, pose-provenance gating, and the data-column
  mode isolation (Steps 1–3). Pin working behavior before changing nearby code.
- Long-running operations must be cancelable.

## 7. Measure performance before AND after — locally
- Any change that could affect performance must be timed before and after, locally,
  with the comparison in the change summary. Catch regressions on your machine.
- Frontend: endpoint timing is NOT enough — reason about the render path (state
  lifted into parents of heavy components, prop churn, fetch waterfalls, high-freq
  re-renders). A slow UI with a fast backend is a UI problem; fix it there.
  (Temporary instrumentation like `lib/poseProfiler.ts` is acceptable — tag probes
  for easy removal and remove them once the question is answered.)

## 8. Deploy / release process (DORMANT — no pipeline configured yet)
When a CI/deploy pipeline is documented, drive everything off the release diff
(`git diff origin/main..HEAD`): regression-audit the diff, all checks green, docs
reconciled, version bumped in every location, push → monitor CI → verify prod live,
then a dated deploy report with rollback command. Until then, do not perform or
fabricate deploy/version steps.

## 9. Docs stay in sync with verified behavior
- Whenever you read code to answer something, check whether the relevant docs / user
  manual still match. If stale, say so and ask to update — don't leave docs drifting.

## 10. Keep a lessons-learned + known-issues log
- Lessons-learned: symptom → verified root cause → fix → the *class* of mistake.
- Known-issues: any defect found while working on something else gets recorded
  (symptom, root cause, fault assessment, proposed fix, severity) — even if
  pre-existing. Undocumented ≠ doesn't exist.
