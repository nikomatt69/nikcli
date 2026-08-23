# Product Roadmap

Status: **Proposed** (2026-08-23).

This document orders user outcomes, not implementation projects. [ROADMAP.md](./ROADMAP.md) remains the canonical engineering plan and admits work only when the repository contains a verifiable structural leftover. A product priority promotes or creates engineering work only after discovery identifies the smallest evidenced change.

## Decision model

Every product item moves through three gates:

1. **Baseline** — Instrument the current journey without collecting prompt, source, credential, or other private content.
2. **Target** — Record the expected movement, affected cohort, observation window, and rollback threshold before implementation.
3. **Delivery** — Link the accepted engineering items and verify the outcome after release. Shipping code without measuring the stated outcome does not complete the item.

The roadmap uses horizons rather than dates. `Now` means establish the baseline and remove a proven blocker; `Next` means discovery may run while `Now` is measured; `Later` is a hypothesis, not a release promise.

## Outcome sequence

| Horizon   | Outcome                                                        | Measure                                                                                                           | Engineering relationship                                                                                                          |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Now**   | Releases users can trust                                       | Successful validation-to-publish chain, generated-client drift, deploy acceptance and post-deploy health          | C1 is the first guard; follow-up health verification requires evidence because Railway `--detach` only confirms upload acceptance |
| **Now**   | First useful result with less setup friction                   | Install-to-provider-ready completion, time to first successful session turn, failures grouped by actionable cause | Promote only failures observed in installer, auth, provider catalog, or first-turn paths                                          |
| **Next**  | Continue the same session across terminal, desktop, and mobile | Cross-surface continuation success, reconnect failures, state divergence, time to resume                          | Prefer existing HttpApi, event, pending-input, workspace, and SessionV2 seams; do not create a second transport or renderer       |
| **Next**  | Delegate repeatable work with confidence                       | Loop/mission/background-run completion, intervention rate, restart recovery, explicit failure causes              | S4r removes the remaining split conversation write before expanding automation claims                                             |
| **Later** | Share and distribute work safely                               | Share completion, recipient activation, revocation success, deployment/install channel reliability                | Discovery must define trust, ownership, and revocation before changing collaboration or hosted surfaces                           |
| **Later** | Validate sustainable paid value                                | Retention and willingness-to-pay by outcome cohort, support cost, provider-cost envelope                          | No billing architecture enters the engineering roadmap before a priced cohort and measurable entitlement boundary exist           |

## Current discovery briefs

### Release trust

- **User promise** — A published CLI, desktop artifact, or hosted service corresponds to validated source and does not report success when a required stage was skipped.
- **Current evidence** — C1 closes generated-client drift, direct-publish validation, blocking lint/format, and missing Railway credentials. Detached Railway builds still need a separate health signal before “deployed” can mean “running.”
- **Promotion rule** — Add post-deploy work to the engineering roadmap only after choosing a stable health endpoint and proving the workflow can associate it with the uploaded revision without flaky polling.

### First useful result

- **User promise** — A new user can install Nikcli, connect a provider, open a project, and complete one useful turn with failures that explain the next action.
- **Baseline events** — Installation completed, provider configured, session created, first turn started, first turn completed, and categorized failure. Events carry version, platform, elapsed time, and coarse failure code only.
- **Promotion rule** — Rank blockers by affected users and elapsed-time cost. Do not turn anecdotal setup preferences into architecture work.

### Cross-device continuity

- **User promise** — A session started on one supported surface resumes on another without transcript loss, duplicate execution, or hidden queued input.
- **Baseline scenarios** — TUI to desktop, TUI to mobile, reconnect after server restart, and workspace switch. Measure state convergence and explicit recovery, not visual parity.
- **Promotion rule** — Reuse generated HttpApi clients and the shared event/session models. Surface-specific presentation remains local; protocol divergence needs an explicit contract decision.

### Trusted automation

- **User promise** — Delegated work reports durable progress, survives supported restarts, and fails with enough context for a user to recover.
- **Baseline scenarios** — Loop, mission, background delegation, cancellation, graceful restart, and result handoff. Measure completion and intervention separately.
- **Promotion rule** — Complete S4r before adding new conversation writers. Clustered ownership and hard-crash replay remain non-goals until placement, fencing, provider ambiguity, and tool idempotency are designed together.

## Review cadence

Review product evidence at release boundaries. For each outcome, record the baseline window, target, observed result, and linked engineering IDs in the release decision. Archive an item when evidence rejects the user problem; do not keep it alive as unowned “Later” work.
