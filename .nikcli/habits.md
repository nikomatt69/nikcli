# User habits

Maintained automatically by nikcli's Brain pass from past sessions in this project.
Every session's agents read this file. Edit or delete anything that is wrong —
or turn the whole thing off with `/profile`.

## Communication

- Read prompts in Italian or English interchangeably; reply in English prose (code and identifiers stay as-is).
- Explain the rationale behind non-obvious decisions, but keep the reasoning tight.

## Audit / inventory questions

- Deliver per-item tables with classification (active/dormant/reference-only, must/should/nice, etc.), summary, and recommendations.
- Rank recommendations by tiers (Tier 1 / 2 / 3 / 4) when comparing options across time horizons.

## Workflow

- Delegate read-only exploration to subagents (explore / researcher) instead of inlining it; let the Brain pass synthesize after.
- Read the relevant specs or repo state first, then ask for ranked work — not the reverse.
- Plan-mode prompts expect a written deliverable on disk, not just a chat reply.

## Verification

- After a meaningful change, run the narrowest targeted test plus typecheck before declaring done; show pass/fail counts and exit codes in the same reply as the change.
- A change is not done until the matching test file is green; never paraphrase "tests pass" — quote the count.
- When a build times out or fails partway, do not re-run blindly — narrow scope, fix the underlying error, then retry.
- Default verification commands: `bun test <file>`, `bun run typecheck`, `bun run build`. Use `monitor` for all three.
- CI gating is non-negotiable: `ci-pipeline` going red is never acceptable, never "someone else's problem", and never fixed by skipping or quarantining a test.

## Code review

- Findings come with severity (Critical / High / Medium / Low) and a one-line "fix or leave" recommendation.
- Look for correctness regressions, error-propagation leaks, and false positives before flagging style.
- Severity findings reference the exact file and line; generic guidance without a path is not a finding.
- Solid component lifecycles are reviewed for cleanup (`onCleanup`, polling abort, signal teardown) — unmount-doesn't-cancel is the recurring bug class.
- Effect service boundaries must validate inputs at the boundary; handlers that silently pass through untyped data are flagged.

## Domain focus

- Authentication and onboarding flows are the recurring review surface: PKCE S256, device-code, OAuth callback redirects, passwordless email, account creation cannot be skipped.
- TUI dialog lifecycle (e.g. `DialogAccountLogin`) is reviewed for cleanup on unmount — cancellation, polling, post-unmount state must be torn down deterministically.
- `Account.Service` and friends are the canonical Effect service layers; tests target the Effect boundary, not the React/Solid adapter.
- Work often crosses both `packages/nikcli` (CLI + TUI + server) and `packages/identity` (browser identity + DB + contracts) in the same change — keep the seam clean in both directions.
- The HttpApi contract in `packages/nikcli/src/server/httpapi/` is the source of truth: edit the group, then run `bun run generate:httpapi-clients`, commit the generated output.

## Working style

- Italian session text is fine for narration; English stays the default for prose replies.
- Trust the standing `<user_profile>` over re-asking; ask only when the choice materially changes the outcome.
- For git and DB operations, ask permission first — even when the task seems obvious.
