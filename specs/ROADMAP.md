# Effect and TUI Architecture Roadmap

Status: proposed implementation program. Baseline date: 2026-09-10.
Scope: `packages/tui` and `packages/nikcli`. [Catalog and evidence](README.md).

## Objective

Improve responsiveness, predictable resource usage, failure propagation, and maintainability while preserving the
standalone TUI, CLI/worker/HTTP modes, existing user workflows, and the current Effect/OpenTUI pins. Deliver vertical
slices with measured outcomes; do not rewrite every Promise into Effect or every Solid signal into a service.

## Target Architecture

```text
CLI / embedded worker / standalone host
  -> host capabilities + startup config + shutdown ownership
  -> generated SDK transport (HTTP or existing worker adapter)
  -> bounded event admission + recovery + query coordination
  -> normalized Solid stores + pure incremental selectors
  -> OpenTUI components, focus routing, measured row window

Bun.serve / tools / command boundaries
  -> validation + typed Effect services
  -> existing runtime bridge + InstanceRef / WorkspaceRef
  -> scoped execution, bounded work, domain repositories
  -> committed state + events + redacted observability
```

Pure transforms stay pure. Solid owns reactive state and renderable lifetimes. Effect owns backend dependency graphs,
typed failures, cancellation, and service resources. The transport adapter is the seam, not a second domain model.
No TUI import may reach backend runtime, database, account storage, or server implementation code.

## Non-Negotiable Decisions

1. Preserve `layer`/`defaultLayer`, `runPromiseWithLayer`/`runService`, and the existing instance bridge. No second runtime
   factory, second instance ALS, or runtime per component. Any TUI-side Effect execution needs a host-provided owner and
   evidence that it is better than the existing cancellation adapter; the default is not to add one.
2. Use `Schema.TaggedError` for new expected domain failures, retain `Cause`/`Exit` at internal boundaries, and distinguish
   interruption, defect, timeout, transport failure, and an empty successful result.
3. HttpApi remains the contract authority. `nikcli.json` stays Zod-derived through `fromZod`; generated clients are not
   handwritten. Do not introduce Hono, hey-api, a parallel config schema, or an alternate database layer.
4. Bounded queues require a stated overflow/recovery policy. A faster view that drops text, permission prompts, or final
   outcomes is a correctness regression. Safety and tenant isolation outrank performance.
5. Keep existing tests and CI signals. Do not add the full nikcli suite back to CI; run whole-suite checks locally through
   `bun run test:ci`. Preserve targeted Windows suites, client-drift, formatting/lint, and Railway/Docker guards.

## Prioritized Work and Dependencies

Tier 1 = correctness and evidence first; Tier 2 = user-visible performance; Tier 3 = deeper efficiency after evidence.
Owner names below are responsibility roles, not assignments to unconsulted people. Effort is relative: S is a narrow
change, M spans a few seams, L requires several separately verified PRs. No calendar dates are promised.

| ID                                                   | Tier | Phase | Dependencies           | Effort | Risk   | Primary owner     | Release gate                                                |
| ---------------------------------------------------- | ---- | ----- | ---------------------- | ------ | ------ | ----------------- | ----------------------------------------------------------- |
| [EOT-01](effect-tui/01-performance-baseline.md)      | 1    | P0    | none                   | M      | Low    | Performance/test  | Reproducible measurements and failure-sensitive assertions  |
| [EOT-02](effect-tui/02-effect-boundaries.md)         | 1    | P1    | EOT-01                 | L      | High   | Effect/domain     | Typed boundary and multi-instance teardown tests            |
| [EOT-10](effect-tui/10-contracts-errors-security.md) | 1    | P1    | EOT-01                 | L      | High   | HttpApi/security  | Error/encoding/auth parity and clean generated output       |
| [EOT-03](effect-tui/03-tui-lifecycle.md)             | 1    | P1    | EOT-02                 | M      | High   | TUI lifecycle     | No stale commits or surviving owner work                    |
| [EOT-04](effect-tui/04-event-delivery.md)            | 1    | P2    | EOT-02, EOT-10         | L      | High   | Transport/bus     | Bounded lag and verified recovery without silent loss       |
| [EOT-05](effect-tui/05-reactive-state.md)            | 2    | P2    | EOT-03, EOT-04         | L      | High   | TUI state         | Scoped query/state correctness and stable row identity      |
| [EOT-08](effect-tui/08-host-plugins-startup.md)      | 2    | P2    | EOT-02, EOT-03         | M      | Medium | Host/plugins      | Standalone and compiled parity; reload resource plateau     |
| [EOT-06](effect-tui/06-terminal-rendering.md)        | 2    | P3    | EOT-05                 | L      | High   | TUI rendering     | Streaming virtualization, anchor fidelity, measured latency |
| [EOT-07](effect-tui/07-input-interaction.md)         | 2    | P3    | EOT-03, EOT-05         | M      | High   | TUI interaction   | Keyboard/focus/permission matrix on real terminals          |
| [EOT-09](effect-tui/09-jobs-persistence.md)          | 3    | P3    | EOT-02, EOT-04, EOT-10 | L      | High   | Execution/storage | Durable terminal states, concurrency bounds, recovery       |

Dependencies are exit gates, not permission to stall unrelated characterization tests. EOT-02 and EOT-10 can progress
independently after P0; EOT-08 need not wait for EOT-04/05. EOT-06, EOT-07, and EOT-09 are independent after their listed
prerequisites. Run memory-heavy verification serially even when implementation work is independent.

## Phase Exits

### P0: Establish Truth

- Record versions, host modes, workload fixtures, raw metrics, queue/resource counters, and a baseline comparison format.
- Add missing behavioral probes before modifying hot paths; characterize existing best-effort and fallback semantics.
- Ratify EOT-01 candidate budgets in a reviewed baseline artifact. A noisy or missing baseline is not a pass.

### P1: Make Lifetimes and Failures Explicit

- Tighten the runtime bridge incrementally; keep compatibility adapters until callers have migrated and tests prove parity.
- Pilot boundary validation with account and TUI-config flows; prove request cancellation reaches actual I/O.
- Migrate high-risk dialogs and bootstrap teardown first. Verify late success, late failure, and late resource acquisition.

### P2: Bound the Data Path

- Apply capacity and recovery policies to HTTP and worker event delivery before consolidating client batches.
- Separate queries, event reducers, and projections without duplicating authoritative state. Preserve v2 entry rendering.
- Enforce the host import boundary and scoped plugin reload. Move startup work only when the critical path improves.

### P3: Improve the Experience and Execution Core

- Replace estimated row windowing with measured, anchor-preserving rendering; keep selection and pending input reachable.
- Unify focus/input ownership and extract prompt/session controllers by responsibility.
- Bound job admission and repository work; prove terminal-state persistence and process cleanup under races and failures.

### P4: Consolidate and Release

No new feature scope. Remove only migration adapters proven unused, update this catalog with completion evidence,
exercise both host modes and supported terminal platforms, and compare final results to P0. Leave any unpassed spec
proposed/in-progress rather than claiming the architecture program is complete.

## First Implementable Slices

1. EOT-01: the startup probe now records raw samples, nearest-rank percentiles, and child RSS when
   readable; event-feed / plugin-dispose / streaming-cost harnesses record queue-depth, lifecycle
   residuals, and once-path summaries. Collect the 30-warm / 10-cold baseline on a compiled binary
   and ratify candidate budgets before optimization. No production behavior changes.
2. EOT-02: type one `runService` caller chain without widening requirements; exercise finalizers and concurrent instances.
3. EOT-10: characterize standalone TUI-config 401, malformed response, and offline failure; forbid empty-config success.
4. EOT-03: carry abort plus generation checks through one complete dialog request/resource/close flow.
5. EOT-04: classify event types and test overload before introducing admission caps; retain server encode-once behavior.

Each slice contains its matching test, source change, measured result when relevant, and rollback note. Do not combine
an Effect upgrade, transport protocol migration, and virtualization default flip in one PR.

## Domain Adoption Map

The inspected hotspots establish the architecture, not an exhaustive defect audit of every backend directory. Apply these
specs to adjacent domains in measured slices; first read each domain's current implementation and tests. Existing correct
Effect services remain unchanged unless a concrete ownership, error, or performance gap is demonstrated.

| Domain family                                        | Applicable specs               | First question before implementation                                                      |
| ---------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| Account/auth/config/permission/question              | EOT-02, EOT-03, EOT-10         | Do validation, abort, and typed failure survive producer-to-UI transport?                 |
| Session/provider/tool orchestration                  | EOT-02, EOT-04, EOT-09, EOT-10 | Are service crossings, streaming order, concurrency, and terminal outcomes explicit?      |
| Background/delegation/monitor/loop/mission/scheduler | EOT-02, EOT-04, EOT-09         | Who owns accepted work after disconnect, and how is completion committed?                 |
| Project/workspace/worktree/sync/database             | EOT-02, EOT-04, EOT-05, EOT-09 | Are contexts isolated, replay consistent, and transaction/cache lifetimes bounded?        |
| File/LSP/MCP/plugin/connectors                       | EOT-02, EOT-03, EOT-08, EOT-09 | Do watchers, subprocesses, client pools, and config reloads release at the correct scope? |
| Browser/computer/PTY/image/voice                     | EOT-03, EOT-06, EOT-08, EOT-09 | Can cancellation release native resources and stop late frame/result delivery?            |
| Analytics/observability/brain/profile                | EOT-01, EOT-05, EOT-09, EOT-10 | Is collection bounded, privacy-preserving, and off the interaction-critical path?         |
| Share/artifact/mobile/remote integration             | EOT-04, EOT-08, EOT-10         | Do transport capabilities, payload limits, redaction, and generated contracts agree?      |

Unsupported or unmeasured domains are not scheduled for speculative rewrites. Prioritize a failing correctness invariant
over the tier order, then return to the dependency gates; record the evidence and revised slice scope in the relevant spec.

## Verification and Promotion

Run commands from the stated package through Bun; use `monitor` for tests, typechecks, builds, and codegen.

| Change surface             | Required evidence                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Documentation only         | Markdown format check, local-link/source-reference validation, dependency DAG/coverage checks, read-back                    |
| Runtime/service            | Narrow `packages/nikcli/test/effect` and changed domain tests; interruption and finalizer assertions                        |
| TUI lifecycle/state/render | Matching `packages/nikcli/test/tui` tests, real OpenTUI frame assertions, PTY interaction when behavior changes             |
| HTTP contract              | `bun run generate:httpapi-clients`, `bun run check:routes`, affected server/client tests, tracked generated output reviewed |
| Host/startup               | `bun run smoke:standalone` in `packages/tui`; `bun run smoke:tui` and compiled startup probe in `packages/nikcli`           |
| Any implementation slice   | One final root `bun run typecheck` after edits, serialized via the existing root script; affected formatting/lint checks    |
| Release-sized integration  | Local `bun run test:ci` in `packages/nikcli`, relevant compiled build/smokes, existing CI remains blocking                  |

Do not run root `bun test`: the root script intentionally fails. Do not run repeated typechecks during editing on a
low-memory machine. A passing typecheck is not proof of cancellation, replay, focus restoration, or rendering correctness.
Keep raw exit codes, pass/fail counts, fixture parameters, and performance samples with the implementing PR.

## Migration and Rollback Policy

- Ship one authoritative path per domain. Temporary comparison may duplicate pure projection, never tool execution,
  network mutation, or database writes.
- Reuse an existing feature flag where appropriate, especially message virtualization. New flags need a schema-backed
  default, tests in both states, a removal criterion, and EOT-10 review; do not invent undocumented environment switches.
- Rollback swaps an adapter or disables an optimization, not the safety checks. Capacity overflow must remain visible.
- Storage changes are additive and separately approved; no deletion of user data or old compatibility fields as part of
  performance work. Preserve downgrade considerations and stop before production/database operations.

## Deferred Choices

Do not adopt a new global state framework, a browser virtualizer, Effect SQL, Effect AI/CLI, distributed actors, or an
OpenTUI fork merely because the APIs exist. Reconsider only with a measured bottleneck, a compatibility case, and a
separate decision. Renderer worker/thread defaults, authentication policy, plugin trust, and telemetry export defaults
are not changed by this roadmap. No new mandatory external infrastructure or paid service is required.
