# Product Roadmap

Status: **Proposed** (2026-08-23).

This document orders user outcomes, not implementation projects. [ROADMAP.md](./ROADMAP.md) remains the canonical engineering plan and admits work only when the repository contains a verifiable structural leftover. A product priority promotes or creates engineering work only after discovery identifies the smallest evidenced change.

## Decision model

Every product item moves through three gates:

1. **Baseline** — Instrument the current journey without collecting prompt, source, credential, or other private content.
2. **Target** — Record the expected movement, affected cohort, observation window, and rollback threshold before implementation.
3. **Delivery** — Link the accepted engineering items and verify the outcome after release. Shipping code without measuring the stated outcome does not complete the item.

The roadmap uses horizons rather than dates. `Now` means establish the baseline and remove a proven blocker; `Next` means discovery may run while `Now` is measured; `Later` is a hypothesis, not a release promise.

## Integrated operating plan

This section sequences the evidence-gated discovery activities against the engineering roadmap. It coordinates — it does not duplicate — the engineering backlog: each phase names the engineering IDs it depends on and the cohort/event/window decisions it owns. Detailed acceptance criteria stay in [ROADMAP.md](./ROADMAP.md); promotion into engineering requires an item there with a runnable gate.

A phase only moves to the next when both legs hold: the engineering acceptance gate passes and the product-side measurement window closes without observing the blocked failure mode. Product discovery may audit, define cohorts/events/privacy fields/windows/rollback thresholds, and measure existing behavior; any production instrumentation or behavior change must first be admitted to ROADMAP with an ID and runnable acceptance gate. The order below is dependency-driven, not date-driven.

### Phase 0 — Recover release integrity and stop the E5 regression

- **Engineering** — C1 already gates every publish. The E5 block on discovery is **lifted (2026-08-24)**: E5.1–E5.4 landed, the missing-session revert/diff 500 is gone, and the session/server scopes are green, so H8.1 may start. P2.1 may be developed in a separate lane and measured, but its result does not unblock H8.
- **Product** — Run the **release-trust** discovery against the new world: prove a revision-bearing `GET /global/health` identity can be tied to the detached Railway upload without flaky polling, and establish the post-deploy health baseline window the engineering promotion rule will guard. In parallel, instrument the **first-use** baseline already named in the existing outcome table — install completed, provider configured, session created, first turn completed, categorized failure — only on top of stable E5 behavior so the cohort is not poisoned by the 500 path.
- **Phase exit** — Both `bun run typecheck` and the session/server test scope are green (**met 2026-08-24**); release-trust evidence shows the health identity round-trip succeeds for two consecutive Railway uploads; first-use baseline data exists for at least one release boundary. The two remaining legs are product-side and still open, so the phase is not closed — but the engineering leg no longer holds it.

### Phase 1 — Land measured P2 work and finish P2 discovery

- **Engineering** — Land P2.1 (session list filters / ordering / limit pushed into SQL) and use its measurement to decide whether the JSON-bound work in P2.2 (parsed-URL carry-through, slow/failure logging for `/event` and `/session/status`, request-path benches) is worth scheduling. Do not pre-commit to P2.2.
- **Product** — Run the **first-use** baseline window against the SQL-backed list path: re-evaluate install-to-provider-ready completion and first-turn elapsed time on the new endpoint shape. If hot-poll cost was a dominant failure cause, document the new `/event` and `/session/status` behavior in the first-use failure taxonomy; otherwise the logging change becomes an engineering follow-up rather than a product bet.
- **Phase exit** — P2.1 is on a loose CI budget, the same seeded request records a lower materialization count and elapsed time than before, and first-use baseline numbers are recorded for the release boundary the slice lands in.

### Phase 2 — Carry the parsed URL, then attach auth to the contract

- **Engineering** — Where P2.2 is in scope, land the router → public/bridge/fallback/mobile parsed-URL carry-through and the slow/failure logging policy before H8.1, because both touch the same bridge and router files. Then start H8.1: define the `HttpApiSecurity` / `HttpApiMiddleware` vocabulary, attach it to protected encoded groups, preserve open-mode and Tailscale behavior, and ensure direct bridge callers still authenticate once. Generated-client drift is committed with the slice.
- **Product** — Update the **first-use** outcome measure to record which hot-poll paths became silent under the new logging policy, so any "less visible" failure mode is counted, not hidden. No new continuity or automation work yet — the existing release-trust and first-use cohorts are still under measurement.
- **Phase exit** — `/event` and `/session/status` are sampled or duration-gated without dropping real failures; OpenAPI shows security on protected operations and its absence on public ones; `bun run check:routes` and `bun run generate:httpapi-clients` are clean; first-use baseline reflects the new logging policy.

### Phase 3 — Run continuity and automation discovery against existing seams

- **Engineering** — No new engineering items admitted yet. H8 is the current engineering priority and any continuity/automation code lands only after its evidence is in ROADMAP with an ID.
- **Product** — Run the **cross-device continuity** discovery against the generated HttpApi clients and the existing event/session/pending-input/workspace seams defined in [v2/](./v2/README.md); reuse the current transport instead of building a second. In parallel, run the **trusted-automation** discovery against the existing Loop, Mission, background-run, and graceful-restart seams (S2 / D2a / D2b) using their already-collected completion and intervention metrics.
- **Phase exit** — Each discovery brief records the smallest evidenced reliability gap with a proposed engineering ID (or an explicit rejection with a reason), and the existing user-promise / baseline-events / promotion-rule table for that horizon is updated.

### Phase 4 — Promote or archive

- **Engineering** — Each proposed engineering ID from Phase 3 is admitted to ROADMAP with a runnable acceptance gate; no acceptance gate, no admission. Earlier items that no longer have a measurable cohort return to Phase 0 for re-evaluation.
- **Product** — Review the now-closed baselines: confirm a movement on each `Now` measure, decide whether to promote the discovered continuity or automation item, or archive the hypothesis and remove the row from the outcome sequence.
- **Phase exit** — Each horizon in the outcome sequence either has a measured movement toward its user promise or has been archived with a written reason; engineering IDs that are not on the path are taken off the active plan.

## Outcome sequence

| Horizon   | Outcome                                                        | Measure                                                                                                           | Engineering relationship                                                                                                           |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Now**   | Releases users can trust                                       | Successful validation-to-publish chain, generated-client drift, deploy acceptance and post-deploy health          | C1 is the first guard; follow-up must prove a revision-bearing health identity can be tied reliably to the detached Railway upload |
| **Now**   | First useful result with less setup friction                   | Install-to-provider-ready completion, time to first successful session turn, failures grouped by actionable cause | Promote only failures observed in installer, auth, provider catalog, or first-turn paths                                           |
| **Next**  | Continue the same session across terminal, desktop, and mobile | Cross-surface continuation success, reconnect failures, state divergence, time to resume                          | Prefer existing HttpApi, event, pending-input, workspace, and SessionV2 seams; do not create a second transport or renderer        |
| **Next**  | Delegate repeatable work with confidence                       | Loop/mission/background-run completion, intervention rate, restart recovery, explicit failure causes              | S4r is landed; discovery now maps reliability gaps across existing Loop, Mission, background-run, and restart seams                |
| **Later** | Share and distribute work safely                               | Share completion, recipient activation, revocation success, deployment/install channel reliability                | Discovery must define trust, ownership, and revocation before changing collaboration or hosted surfaces                            |
| **Later** | Validate sustainable paid value                                | Retention and willingness-to-pay by outcome cohort, support cost, provider-cost envelope                          | No billing architecture enters the engineering roadmap before a priced cohort and measurable entitlement boundary exist            |

## Current discovery briefs

### Release trust

- **User promise** — A published CLI, desktop artifact, or hosted service corresponds to validated source and does not report success when a required stage was skipped.
- **Current evidence** — C1 closes generated-client drift, direct-publish validation, blocking lint/format, and missing Railway credentials. `GET /global/health` reports health and version, but not a revision identity tied to the detached Railway upload.
- **Promotion rule** — Add post-deploy work only after choosing and proving a revision-bearing health identity and a reliable way to associate it with the detached upload without flaky polling.

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
- **Promotion rule** — Use the existing Loop, Mission, background-run, and graceful-restart seams to discover the smallest evidenced reliability gap and plan the next engineering item. Clustered ownership and hard-crash replay remain non-goals until placement, fencing, provider ambiguity, and tool idempotency are designed together.

## Review cadence

Review product evidence at release boundaries. For each outcome, record the baseline window, target, observed result, and linked engineering IDs in the release decision. Archive an item when evidence rejects the user problem; do not keep it alive as unowned “Later” work.
