# V2 Specifications

These documents explain V2 behavior that is difficult to recover from one source file. They are not API reference and not a backlog.

"V2" in nikcli names three separate, partially-landed things. Keep them apart when reading:

| Name           | What it is                                                                           | Where                       |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `MessageV2`    | The message/part shape the LLM layer and every client already use. Authoritative.    | `src/session/message-v2.ts` |
| `SessionV2`    | The flat entry model + projector. **Read model only** — writes still delegate to v1. | `src/session/v2/*`          |
| HttpApi ("v2") | The Effect `HttpApi` server surface that replaced Hono. Fully landed.                | `src/server/httpapi/*`      |

## Current Contracts

| Document                | Job                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| [Session](./session.md) | Explain admission, the step loop, retry, compaction, cancellation, and recovery boundaries. |
| [Tools](./tools.md)     | Explain tool construction, registration, execution, truncation, and outcome laws.           |

## Decisions And Proposals

| Document                                                                | Status                     | Job                                                                                  |
| ----------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| [Catalog/config/plugin lifecycle](./catalog-config-plugin-lifecycle.md) | Accepted and implemented   | Record why visible provider state is an invalidatable per-instance cache.            |
| [Event stream](./event-stream-architecture.md)                          | Accepted and implemented   | One encoded feed, one lag budget per connection.                                     |
| [Instruction sync](./instruction-sync-proposal.md)                      | Proposed and unimplemented | Make instruction state value deltas instead of a per-request rebuild.                |
| [Durable pending input](./durable-pending-input.md)                     | Proposed                   | Pending row + promotion transaction; steer vs queue; compaction barrier.             |
| [Restart continuation](./session-restart-continuation.md)               | Accepted and implemented   | Continue interrupted sessions after a graceful server restart.                       |
| [Provider policy](./provider-policy.md)                                 | Accepted and implemented   | Define ordered `provider.use` decisions and legacy compatibility.                    |
| [TUI theme migration](./tui-theme-migration.md)                         | U3 and U2 done             | Nested tokens derived from flat colors. `Theme` is nested-only; documents stay flat. |

## Historical Context

| Document                                  | Job                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| [Schema changelog](./schema-changelog.md) | Preserve the durable-shape compatibility ledger, newest entry first. |

Put actionable work in [../ROADMAP.md](../ROADMAP.md), not here.
