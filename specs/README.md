# Architecture Specs

Planning baseline: 2026-09-10. Scope: `packages/tui` and `packages/nikcli`, including their SDK and host seams.

Start with the [integrated roadmap](ROADMAP.md). These are implementation specifications, not claims that the proposed
changes or performance targets have shipped. All ten specs are **proposed**. No benchmark was run to establish a runtime
baseline during this documentation change.

## Specification Catalog

| ID     | Specification                                                                         | Primary ownership                    | Outcome                                                        |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| EOT-01 | [Performance and verification baseline](effect-tui/01-performance-baseline.md)        | Both packages                        | Reproducible budgets, lifecycle counters, meaningful gates     |
| EOT-02 | [Effect runtime and service boundaries](effect-tui/02-effect-boundaries.md)           | nikcli Effect and domain maintainers | Typed requirements, one bridge, explicit resource ownership    |
| EOT-03 | [TUI asynchronous lifecycle](effect-tui/03-tui-lifecycle.md)                          | TUI contexts and dialogs             | Cancellation and stale-result safety without framework churn   |
| EOT-04 | [Event delivery and recovery](effect-tui/04-event-delivery.md)                        | Bus, server feed, TUI SDK            | Bounded delivery with explicit recovery and no silent loss     |
| EOT-05 | [Reactive state and query coordination](effect-tui/05-reactive-state.md)              | TUI sync and session view            | Incremental updates, bounded caches, truthful readiness        |
| EOT-06 | [Measured terminal rendering](effect-tui/06-terminal-rendering.md)                    | TUI session and renderer             | Stable streaming, measured virtualization, idle efficiency     |
| EOT-07 | [Input and interaction architecture](effect-tui/07-input-interaction.md)              | TUI prompt, dialogs, keymaps         | Deterministic focus and accessible keyboard workflows          |
| EOT-08 | [Host, plugin, and startup boundaries](effect-tui/08-host-plugins-startup.md)         | CLI host and TUI plugin maintainers  | Lean startup and revocable plugin lifetimes                    |
| EOT-09 | [Jobs, persistence, and resource budgets](effect-tui/09-jobs-persistence.md)          | nikcli execution and repositories    | Durable outcomes, bounded concurrency, correct cancellation    |
| EOT-10 | [Contracts, errors, and trust boundaries](effect-tui/10-contracts-errors-security.md) | HttpApi and domain maintainers       | Validated responses and failures that cannot look like success |

## Evidence Register

Paths are relative to the repository root. Line references describe this inspection, not permanent API anchors.
An observed implementation surface is not automatically a proven runtime bug.

| Evidence | Inspected source                                                                                        | Observed foundation or next-step opportunity                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B01      | `packages/tui/package.json:33`, `packages/nikcli/package.json:111`, `package.json:72`                   | Effect/platform-bun `4.0.0-rc.112`, OpenTUI core/solid `0.5.10`, Solid `1.9.12`; preserve the pins                                    |
| B02      | `packages/nikcli/src/effect/runtime.ts:7`, `packages/nikcli/src/effect/run-service.ts:9`                | Shared memo map and cached runtimes exist; bridge signatures erase requirements with `any`                                            |
| B03      | `packages/nikcli/src/effect/instance-scope.ts:19`, `packages/nikcli/src/effect/instance-state.ts:44`    | Structured interruption already exists; instance state has effectively unlimited capacity and lifetime by design                      |
| B04      | `packages/tui/src/util/lifecycle.ts:21`                                                                 | Abort-on-cleanup helper explicitly requires both abort and post-await checks; extend, do not duplicate                                |
| B05      | `packages/tui/src/context/sdk.tsx:117`                                                                  | Client batches envelopes at 16 ms; its array has no explicit capacity; reconnect uses manual backoff and `Bun.sleep`                  |
| B06      | `packages/nikcli/src/server/httpapi/event-feed.ts:33`                                                   | Server already encodes once and bounds lag at 4096 frames; this is not a byte bound                                                   |
| B07      | `packages/tui/src/context/sync.tsx:728`, `packages/tui/src/context/sync.tsx:867`                        | Bootstrap has a generation guard; session LRU already has 25 entries and 30-minute TTL; optional request failures need explicit state |
| B08      | `packages/tui/src/routes/session/index.tsx:167`                                                         | Live renderer already consumes `fromEntries` and stabilizes turns; nearby v1 migration prose is stale                                 |
| B09      | `packages/tui/src/routes/session/index.tsx:180`, `packages/tui/src/routes/session/message-window.ts:54` | Virtualization exists, uses six-row estimates and 50 ms polling, and falls back to the full list during streaming                     |
| B10      | `packages/tui/src/app.tsx:102`, `packages/tui/src/host/standalone.ts:52`                                | Renderer cap is 45 FPS; standalone host has no backend imports; remote config failure currently becomes an empty config               |
| B11      | `packages/tui/src/ui/dialog.tsx:146`                                                                    | Escape handling exists; Ctrl+C interaction detection inspects component text and a DOM-style active element                           |
| B12      | `packages/tui/src/plugin/runtime.ts:140`                                                                | Plugin cleanup distinguishes success/error/timeout, but a Promise timeout alone cannot stop underlying work                           |
| B13      | `packages/nikcli/src/bus/index.ts:173`                                                                  | Promise publish is deliberately best-effort; changing it globally would change compatibility semantics                                |
| B14      | `packages/nikcli/src/monitor/manager.ts:24`, `packages/nikcli/src/background/run.ts:19`                 | Monitor output/tail and persistence are already throttled; background runs already have ownership and leases                          |
| B15      | `packages/nikcli/src/account/index.ts:31`, `packages/nikcli/AGENTS.md:67`                               | Tagged account failures and schema-first HttpApi workflow already exist                                                               |
| B16      | `packages/nikcli/script/tui-startup.ts:71`                                                              | Startup benchmark discards warmup and reports best-of; it does not establish percentile latency                                       |
| B17      | `packages/nikcli/test/tui/streaming-churn.test.tsx:25`                                                  | Real renderable destruction is measured; preserve these non-vacuous regression assertions                                             |
| B18      | `packages/nikcli/src/session/prompt.ts`, `packages/tui/src/component/prompt/index.tsx`                  | Large coordination modules deserve responsibility-based extraction, not arbitrary file-size targets                                   |
| B19      | `docs/sync-architecture.md:6`, `packages/nikcli/src/sync/index.ts`                                      | Durable per-aggregate sequence/snapshot machinery exists; global SSE is not automatically a replay protocol                           |

## Pinned Technique References

The workspace has no root `node_modules/effect/AGENTS.md`; the installed reference is
`packages/nikcli/node_modules/effect/AGENTS.md`. Read that file and its sibling `ai-docs/src`, not an unrelated v3 tutorial.
Confirmed in this installation: `Context.Service`, `Schema.TaggedError`, `Effect.fn`, `Effect.tryPromise`,
`Effect.acquireRelease`, `Effect.forkScoped`, `Queue.bounded`, `PubSub.bounded`, `Schedule.exponential`,
`Schedule.jittered`, and `Schedule.recurs`. Exact composition semantics must be checked when implementing.

Relevant installed examples:

- `packages/nikcli/node_modules/effect/ai-docs/src/01_effect/05_resources/10_acquire-release.ts`
- `packages/nikcli/node_modules/effect/ai-docs/src/06_schedule/10_schedules.ts`
- `packages/nikcli/node_modules/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts`

OpenTUI skill pages read: `/docs/bindings/solid`, `/docs/core-concepts/renderer`, and `/docs/core-concepts/keyboard`.
Those documentation routes are references, not repository files. Check the installed declarations before selecting APIs:
`packages/tui/node_modules/@opentui/core/renderer.d.ts`,
`packages/tui/node_modules/@opentui/core/renderables/ScrollBox.d.ts`, and
`packages/tui/node_modules/@opentui/solid/index.d.ts`.
`testRender`, `requestRender`, `requestLive`, `dropLive`, and typed scroll position access exist in this pin.
Do not assume an `onScroll` JSX prop or browser DOM virtualization library exists for this renderer.

## Existing Plans and Compatibility

At inspection, `specs/` and `docs/architecture/` were empty and no on-disk roadmap was found in `specs`, `docs`, or `.goals`.
Source comments still cite absent plans such as `specs/opencode-parity/`, `specs/v2/event-stream-architecture.md`, and
`specs/tui-package.md`. This catalog supplies a new planning baseline; it does not reconstruct or mark those historical
documents complete. Existing [sync architecture documentation](../docs/sync-architecture.md) remains a reference; recheck
implementation details before changing replay semantics.

| Historical topic                                 | Continuation in this roadmap |
| ------------------------------------------------ | ---------------------------- |
| Runtime/instance R2 and Effect service migration | EOT-02                       |
| Dialog lifecycle and cancellation                | EOT-03                       |
| Event stream architecture                        | EOT-04                       |
| Cache eviction and request throttling            | EOT-05                       |
| Message virtualization and streaming churn       | EOT-06                       |
| TUI package extraction and startup               | EOT-08                       |
| SQL storage consolidation                        | EOT-09                       |
| HttpApi encoding, schema reuse, and clients      | EOT-10                       |

## Open Payloads

This is the continuation point for the open-payload policy referenced by `packages/nikcli/AGENTS.md`.
It is not an audited allowlist of current endpoints. EOT-10 must inventory each intentional open payload with operation,
schema location, owner, justification, and a runtime/consumer test. Only genuine opaque passthroughs, polymorphic event
payloads, SSE frames, or bodyless redirects qualify; an ordinary domain success object does not. Never introduce
`Schema.Unknown` merely to make response encoding or generated-client validation pass.
