# Product roadmap

Prioritize user outcomes through measured evidence gates.

Status: **Proposed** (reconciled 2026-09-09).

This document orders user outcomes, not implementation projects. [ROADMAP.md](./ROADMAP.md) admits engineering work only after discovery identifies the smallest verifiable change.

---

## Apply evidence gates

Every product item moves through three gates:

1. **Baseline** — Instrument the current journey without collecting prompt, source, credential, or other private content.
2. **Target** — Record the expected movement, affected cohort, observation window, and rollback threshold before implementation.
3. **Delivery** — Link the accepted engineering items and verify the outcome after release. Shipping code without measuring the stated outcome does not complete the item.

The roadmap uses horizons rather than dates. `Now` means establish the baseline and remove a proven blocker; `Next` means discovery may run while `Now` is measured; `Later` is a hypothesis, not a release promise.

---

## Follow the sequence

This section sequences the evidence-gated discovery activities against the engineering roadmap. Each phase names engineering dependencies and measurement decisions; detailed acceptance criteria stay in [ROADMAP.md](./ROADMAP.md).

A phase only moves to the next when both legs hold: the engineering acceptance gate passes and the product-side measurement window closes without observing the blocked failure mode. Product discovery may audit, define cohorts/events/privacy fields/windows/rollback thresholds, and measure existing behavior; any production instrumentation or behavior change must first be admitted to ROADMAP with an ID and runnable acceptance gate.

---

### Verify release integrity

- **Engineering** - C1 gates every publish; E5, H8, and P2 landed on 2026-08-24. On 2026-09-09, Bun 1.4.2, Effect `4.0.0-rc.112`, frozen install, typecheck, and the Docker/C2 guards are confirmed locally. Hosted release validation remains outstanding.
- **Local evidence** - See [the evidence record](./ROADMAP.md#verify-before-proceeding). Frozen install exited 0 with no lockfile changes (2574 installs / 2929 packages).
- **Limits** - Full CI/release validation, desktop/mobile builds, and production deployment were not run.
- **Product** - Release-identity association and failure criteria are recorded below. First-use events named in this document are not implemented in source; do not invent production collection.
- **Phase exit** - Hosted B1/C2 validation still required. Two consecutive approved uploads must match the expected identity, and first-use evidence must cover one release boundary; neither observation gate is closed.

---

### Measure the landed cuts

- **Engineering** - P2 closed on 2026-08-24: SQL list work reduced materialization from 2000 to 20 rows and elapsed time from 7.84 ms to 0.73 ms on the seeded request. Hot-poll logging landed; parsed-URL carry-through measured 0.03% of a request and was rejected, with benches not scheduled.
- **Product** - Measure first-use outcomes against the landed SQL and logging behavior. Count actionable failures even when successful hot-poll requests are intentionally quiet.
- **Phase exit** — P2.1 is on a loose CI budget, the same seeded request records a lower materialization count and elapsed time than before, and first-use baseline numbers are recorded for the release boundary the slice lands in.

---

### Preserve declared authentication

- **Engineering** - H8 landed on 2026-08-24; do not restart its implementation. Preserve contract-declared security, public endpoint exceptions, open-mode and Tailscale behavior, and authentication exactly once for direct bridge callers.
- **Product** — Update the **first-use** outcome measure to record which hot-poll paths became silent under the new logging policy, so any "less visible" failure mode is counted, not hidden. No new continuity or automation work yet — the existing release-trust and first-use cohorts are still under measurement.
- **Phase exit** — `/event` and `/session/status` are duration-gated without dropping real failures (**met 2026-08-24**); OpenAPI shows security on protected operations and its absence on public ones; `bun run check:routes` and `bun run generate:httpapi-clients` are clean; first-use baseline reflects the new logging policy.

---

### Explore existing boundaries

- **Engineering** - The 2026-08-26 refill, E8, and E9 are closed. Continuity and automation implementation waits for an evidenced ROADMAP item with an ID and runnable acceptance gate.
- **Product** — Run the **cross-device continuity** discovery against the generated HttpApi clients and the existing event/session/pending-input/workspace seams defined in [v2/](./v2/README.md); reuse the current transport instead of building a second. In parallel, run the **trusted-automation** discovery against the existing Loop, Mission, background-run, and graceful-restart seams (S2 / D2a / D2b) using their already-collected completion and intervention metrics.
- **Phase exit** — Each discovery brief records the smallest evidenced reliability gap with a proposed engineering ID (or an explicit rejection with a reason), and the existing user-promise / baseline-events / promotion-rule table for that horizon is updated.

---

### Promote or archive

- **Engineering** - Admit discoveries only with repository evidence and a runnable acceptance gate. Re-evaluate earlier items when their measurable cohort disappears.
- **Product** — Review the now-closed baselines: confirm a movement on each `Now` measure, decide whether to promote the discovered continuity or automation item, or archive the hypothesis and remove the row from the outcome sequence.
- **Phase exit** — Each horizon in the outcome sequence either has a measured movement toward its user promise or has been archived with a written reason; engineering IDs that are not on the path are taken off the active plan.

---

## Prioritize outcomes

| Horizon   | Outcome                                                        | Measure                                                                                                           | Engineering relationship                                                                                                           |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Now**   | Releases users can trust                                       | Successful validation-to-publish chain, generated-client drift, deploy acceptance and post-deploy health          | C1 is the first guard; follow-up must prove a revision-bearing health identity can be tied reliably to the detached Railway upload |
| **Now**   | First useful result with less setup friction                   | Install-to-provider-ready completion, time to first successful session turn, failures grouped by actionable cause | Promote only failures observed in installer, auth, provider catalog, or first-turn paths                                           |
| **Next**  | Continue the same session across terminal, desktop, and mobile | Cross-surface continuation success, reconnect failures, state divergence, time to resume                          | Prefer existing HttpApi, event, pending-input, workspace, and SessionV2 seams; do not create a second transport or renderer        |
| **Next**  | Delegate repeatable work with confidence                       | Loop/mission/background-run completion, intervention rate, restart recovery, explicit failure causes              | S4r is landed; discovery now maps reliability gaps across existing Loop, Mission, background-run, and restart seams                |
| **Later** | Share and distribute work safely                               | Share completion, recipient activation, revocation success, deployment/install channel reliability                | Discovery must define trust, ownership, and revocation before changing collaboration or hosted surfaces                            |
| **Later** | Validate sustainable paid value                                | Retention and willingness-to-pay by outcome cohort, support cost, provider-cost envelope                          | No billing architecture enters the engineering roadmap before a priced cohort and measurable entitlement boundary exist            |

---

## Scope discovery

---

### Prove release identity

- **User promise** — A published CLI, desktop artifact, or hosted service corresponds to validated source and does not report success when a required stage was skipped.
- **Current evidence (source, 2026-09-09)** — C1 protects validation and required deployment gates; C2 locally removes the obsolete Effect install from the image. `GET /global/health` is public (`Auth.isPublicPath`) and returns only `{ healthy: true, version }` from `Installation.VERSION` (`packages/nikcli/src/server/httpapi/global.ts`). That version is the compile-time `NIKCLI_VERSION` define (`packages/util/src/version.ts`, `packages/nikcli/script/build.ts`), falling back to `"local"`. No git SHA, image digest, or build time is baked or served. Generated `GlobalHealth` is `{ healthy: true; version: string }` (`packages/sdk/js/src/httpapi/generated/types.ts`). `script/railway-deploy.sh --detach` exits 0 when `railway up` accepts the upload; `.github/workflows/ci-pipeline.yml` records the service name and does not capture a deployment id. Package version therefore cannot distinguish two uploads of the same release from a healthy older instance.
- **Association model** — Expected identity is the git SHA of the commit that passed validate+publish. Build identity is that same SHA baked into the image at compile, not the semver. Observed identity is whatever a later health probe returns after the upload. The link that must exist before code is admitted: SHA → immutable image → Railway service and environment → the detached upload. Today the last three hops are missing from CI output, and the first hop is missing from the binary.
- **Observation window** — One bounded wait for observed identity to equal expected identity. Do not poll forever and do not treat `--detach` success as health. Timeout without a matching probe is a failed release decision, the same class of lie as a detached upload that never built.
- **Mismatch and timeout** — Reject a healthy probe whose revision (once it exists) or version disagrees with the expected SHA/release. Reject an unhealthy probe. Reject timeout. A version match alone is not enough: two uploads of `1.330.0` would both look healthy.
- **Rollback** — This brief does not authorize automatic production rollback. A failed observation fails the release decision; the next upload still needs identity match. Auto-rollback is a later product choice.
- **Contract and privacy** — Health is already public, so a revision in the JSON body is public metadata. An optional additive field would regenerate `GlobalHealth` and is a C1 drift item; a required field is a contract bump. Header-only identity would hide the value from generated clients and from the curl probe operators already use. Store only revision, service, environment, upload/deployment id if Railway exposes one, timestamps, and coarse pass/fail. No tokens, source, prompts, or credentials.
- **Evidence gate** — Record expected vs observed identity for two consecutive separately approved uploads, plus a failed-build case and an old-healthy-instance case. Neither window has been run.
- **Promotion rule** — Discovery is complete enough to name the gap. The smallest future engineering item would bake the validated SHA at image build, expose it on the existing public health response, and associate the detached upload with that SHA. It is not admitted here: no ROADMAP ID, no implementation, no production collection, no deploy.

---

### Measure first use

- **User promise** — A new user can install Nikcli, connect a provider, open a project, and complete one useful turn with failures that explain the next action.
- **Proposed events, not in source** — Installation completed, provider configured, session created, first turn started, first turn completed, and categorized failure. If later admitted, events would carry version, platform, elapsed time, and a coarse failure code only. A repo search on 2026-09-09 found these names only in this document and an old plan file, not in runtime code.
- **Promotion rule** — Rank blockers by affected users and elapsed-time cost. Do not turn anecdotal setup preferences into architecture work. Do not collect production telemetry until an engineering ID exists.

---

### Check continuity

- **User promise** — A session started on one supported surface resumes on another without transcript loss, duplicate execution, or hidden queued input.
- **Baseline scenarios** — TUI to desktop, TUI to mobile, reconnect after server restart, and workspace switch. Measure state convergence and explicit recovery, not visual parity.
- **Promotion rule** — Reuse generated HttpApi clients and the shared event/session models. Surface-specific presentation remains local; protocol divergence needs an explicit contract decision.

---

### Assess automation

- **User promise** — Delegated work reports durable progress, survives supported restarts, and fails with enough context for a user to recover.
- **Baseline scenarios** — Loop, mission, background delegation, cancellation, graceful restart, and result handoff. Measure completion and intervention separately.
- **Promotion rule** — Use the existing Loop, Mission, background-run, and graceful-restart seams to discover the smallest evidenced reliability gap and plan the next engineering item. Clustered ownership and hard-crash replay remain non-goals until placement, fencing, provider ambiguity, and tool idempotency are designed together.

---

## Review at release

At release boundaries, record each outcome's baseline window, target, observed result, and linked engineering IDs. Archive an item when evidence rejects the user problem rather than keeping unowned later work.
