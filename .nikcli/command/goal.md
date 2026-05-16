---
description: Continue nikcli Effect-migration — execute next incomplete epoch step
agent: build
---

Read `packages/nikcli/specs/integration-master-plan.md` in full.

Run `git log --oneline -25` to understand which epoch steps were recently committed (commit messages follow the pattern `feat(nikcli): E<N>-<X> ...`).

Then:

1. **Identify the next incomplete step** by cross-referencing:
   - The epoch ordering in the plan (Epochs 1 → 9 in dependency order)
   - The validation gates for each step (must pass before proceeding to next)
   - The git log to see what was last completed
   - Any ✅ markers already in the plan

2. **Implement that step** — one step at a time, not the entire epoch:
   - Follow ALL cross-cutting rules (§ "Non-negotiable rules"):
     - `@effect/platform-bun` for all I/O
     - `Effect.fn` tracing on every new service method
     - Effect Schema is the single source of truth
     - No partial conversions — all-or-nothing per file
     - Use `InstanceState.context` / `.directory`, not `Instance.current`
   - After every file edit, run: `bun run typecheck`
   - Fix any type errors before touching the next file

3. **Validate per the epoch's gate**:
   - Run `bun run typecheck` — must be zero errors
   - Run `bun test packages/nikcli/test/` — no regressions
   - If the step requires SDK byte-identity verification, run the SDK build script

4. **Update the plan** — mark the completed step with ✅ in
   `packages/nikcli/specs/integration-master-plan.md`
   and add the completing commit sha as a note.

5. **Report** at the end (3 sentences max):
   - Which step was completed and which files changed
   - Whether typecheck and tests passed
   - What the next step is
