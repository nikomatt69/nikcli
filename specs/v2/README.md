# V2 Specifications

These documents explain V2 behavior that is difficult to recover from one source file. They are not API reference and not a backlog.

"V2" in nikcli names three separate, partially-landed things. Keep them apart when reading:

| Name           | What it is                                                                                                                                                                      | Where                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `MessageV2`    | The message/part shape the LLM layer and every client already use. Authoritative.                                                                                               | `src/session/message-v2.ts` |
| `SessionV2`    | The flat entry model. Reads are native; writes persist entries first and derive v1 from them. HTTP create/prompt, share import, `nikcli import`, and teleport write through it. | `src/session/v2/*`          |
| HttpApi ("v2") | The Effect `HttpApi` server surface that replaced Hono. Fully landed.                                                                                                           | `src/server/httpapi/*`      |

## Current Contracts

| Document                                            | Job                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Session](./session.md)                             | Explain admission, the step loop, retry, compaction, cancellation, and recovery boundaries.                                                      |
| [Session v2 write path](./session-v2-write-path.md) | Entries persist first; v1 is `toV1*` of those entries. HTTP create/prompt share `SessionV2`. `prompt_data` stays on `message_info`. Implemented. |
| [Tools](./tools.md)                                 | Explain tool construction, registration, execution, truncation, and outcome laws.                                                                |

## Decisions And Proposals

| Document                                                                | Status                   | Job                                                                                  |
| ----------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| [Catalog/config/plugin lifecycle](./catalog-config-plugin-lifecycle.md) | Accepted and implemented | Record why visible provider state is an invalidatable per-instance cache.            |
| [Event stream](./event-stream-architecture.md)                          | Accepted and implemented | One encoded feed, one lag budget per connection.                                     |
| [Instruction sync](./instruction-sync-proposal.md)                      | Implemented              | Instruction state is a hash delta instead of a per-request rebuild.                  |
| [Durable pending input](./durable-pending-input.md)                     | Implemented              | Pending row + promotion transaction; steer vs queue; compaction barrier.             |
| [Restart continuation](./session-restart-continuation.md)               | Accepted and implemented | Continue interrupted sessions after a graceful server restart.                       |
| [Provider policy](./provider-policy.md)                                 | Accepted and implemented | Define ordered `provider.use` decisions and legacy compatibility.                    |
| [TUI theme migration](./tui-theme-migration.md)                         | U3 and U2 done           | Nested tokens derived from flat colors. `Theme` is nested-only; documents stay flat. |
| [Session v2 write path](./session-v2-write-path.md)                     | Implemented              | Persist entries first; derive v1 from them; HTTP uses `SessionV2`.                   |
| [Public event filter](./public-event-filter.md)                         | Implemented              | Which bus events are internal, and why withheld means absent rather than typed.      |

## Historical Context

| Document                                  | Job                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| [Schema changelog](./schema-changelog.md) | Preserve the durable-shape compatibility ledger, newest entry first. |

## Proposed Contracts

The following documents describe behavior that exists in code but has no decision doc yet. They are the candidates for promotion to **Accepted and implemented** once the invariants they record are wired into tests.

| Document                                                                          | Scope                                                                                         | Job                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Tool / plugin autoload security](./tool-plugin-autoload-security.md)             | `src/tool/registry.ts`, `src/plugin/*`                                                        | Trust model for config-dir `tool/*.ts` autoload, `tool.allow`/`tool.pin`, and `Plugin.Service` hooks.   |
| [Permission ruleset & coupling](./permission-ruleset-and-coupling.md)             | `src/permission/next.ts`, `src/permission/ruleset.ts`                                         | Tool-to-permission-family authority map, `ask`/`reply` semantics, and the asymmetric deny direction.    |
| [Loop engine contract](./loop-engine-contract.md)                                 | `src/loop/engine.ts`, `src/loop/pr.ts`, `src/sandbox/registry.ts`                             | Single-flight, scheduled cadence, `MAX_CONCURRENT_RUNS`, lease recovery, sandbox per run.               |
| [Mission orchestrator contract](./mission-orchestrator-contract.md)               | `src/mission/*`, `src/server/httpapi/mission.ts`                                              | Lifecycle from description draft through completed/failed/cancelled states; post-H7 contracts.          |
| [Brain consolidation pass](./brain-consolidation-pass.md)                         | `src/brain/`, `src/server/httpapi/brain.ts`                                                   | What the scheduled pass reads, writes, and what's reversible; model selection chain.                    |
| [Workspace trust lattice](./workspace-trust-lattice.md)                           | `src/workspace/*`, `src/cli/cmd/workspace-serve.ts`                                           | Multi-workspace hosting trust model, `SessionProxyMiddleware` enforcement, SSE feed boundaries.         |
| [CLI command surface](./cli-command-surface.md)                                   | `src/cli/cmd/*.ts`, `src/cli-main.ts`                                                         | Authoritative index of every `nikcli …` command; subcommands, flags, exit codes.                        |
| [Observability / OTLP / live panel](./observability-otlp-and-in-process-panel.md) | `src/observability/`, `src/effect/runtime.ts`                                                 | The three telemetry states, env triggers, `TelemetryRecord` shape, per-layer opt-out.                   |
| [Provider message normalization](./provider-message-normalization.md)             | `src/provider/transform.ts`, `src/session/llm/*`                                              | Semantic contract for `normalizeMessages` independent of its perf work.                                 |
| [Share v2 contract](./share-v2-contract.md)                                       | `src/share/*`, `src/server/httpapi/contract-extra.ts`                                         | `StoredShare`/`LocalShare` shape, public read path, privacy, cross-account sharing.                     |
| [Mobile companion protocol](./mobile-companion-protocol.md)                       | `src/server/mobile/*`, `src/server/httpapi/mobile.ts`, `packages/mobile`                      | H7 contract diffs, raw-route exceptions, auth model, durable pending interaction.                       |
| [Logging redaction contract](./logging-redaction-contract.md)                     | `src/util/redact.ts`, `src/util/log.ts`                                                       | The `safeStringify`/`redactUrl` guarantee, the `NIKCLI_LOG_REDACT=0` escape hatch, what's not redacted. |
| [CI pipeline runtime budgets](./ci-pipeline-runtime-budgets.md)                   | `script/ci-validate.ts`, `script/test-ci.ts`, `script/railway-deploy.sh`, `script/check-*.ts` | Memory budget of the suite, sharding math, `--detach` deploy footgun and its three guards.              |

Put actionable work in [../ROADMAP.md](../ROADMAP.md), not here.
