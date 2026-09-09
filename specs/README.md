# Specifications

Understand shared behavior, decisions, and evidence gates.

Status: **Current** (2026-09-09).

These documents explain behavior that is hard to recover from one source file: cross-module contracts, decisions and their alternatives, and the migrations still in flight.

They are **not** API reference and **not** a backlog. Generated clients follow the assembled `HttpApi`; evidenced engineering work lives in [ROADMAP.md](./ROADMAP.md), while user outcomes and product bets live in [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md).

---

## Find authority

Authority follows the concern. When a document and the code disagree, the code wins and the document is wrong.

| Concern                                         | Owner                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| HTTP operations and transport errors            | `packages/nikcli/src/server/httpapi/*.ts` — `HttpApiGroup`/`HttpApiEndpoint` definitions |
| Route dispatch and raw streaming responses      | `packages/nikcli/src/server/httpapi/bridge.ts`                                           |
| Public domain shapes and durable event payloads | `packages/nikcli/src/session/message-v2.ts`, `session/v2/entry.ts`, `sync/sync-event.ts` |
| Persistent schema                               | `packages/nikcli/src/**/*.sql.ts`, aggregated by `src/database/schema.ts`                |
| Runtime behavior                                | `packages/nikcli/src/session/*`, `tool/*`, `provider/*`                                  |
| Generated clients                               | `packages/httpapi-codegen` → `packages/sdk/js/src/httpapi`                               |
| Contributor guardrails                          | `packages/nikcli/AGENTS.md`                                                              |

---

## Choose a document

| Document                                                           | Status      | Job                                                                                         |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------- |
| [ROADMAP](./ROADMAP.md)                                            | Live        | Closed engineering IDs plus the remaining sequence (hosted CI, identity uploads).           |
| [Product roadmap](./PRODUCT_ROADMAP.md)                            | Proposed    | Outcome discovery briefs and [remaining sequence](./PRODUCT_ROADMAP.md#remaining-sequence). |
| [TUI package extraction](./tui-package.md)                         | Complete    | TUI lives in `packages/tui`; host files stay in `packages/nikcli`.                          |
| [v2 contracts](./v2/README.md)                                     | Index       | Session, tools, events, instructions, catalog, provider policy.                             |
| [Public event filter](./v2/public-event-filter.md)                 | Implemented | Which bus events never reach a client, and why withheld means absent.                       |
| [SQL + Drizzle adoption](./storage/nikcli-sql-drizzle-adoption.md) | Implemented | The central database runtime, migrations, and domain-owned schema.                          |
| [Retire JSON storage](./storage/remove-json-storage.md)            | Retired     | Both storage modules are deleted; production storage imports are zero.                      |

---

## Preserve boundaries

Multi-project and worktree support uses flat `/project`, `/session`, and `/workspace` groups, not nested `/project/:projectID/session/...` URLs. Directory selection uses the `directory` query or `x-nikcli-directory` header; instance binding and storage keys provide scope rather than URL nesting.

Extend the existing groups unless a separate product decision changes that model. Endpoint definitions live in `packages/nikcli/src/server/httpapi/`; directory resolution lives in `packages/nikcli/src/server/server-router.ts`.

Keep these storage decisions alongside the [SQL contract](./storage/nikcli-sql-drizzle-adoption.md) and [JSON retirement rationale](./storage/remove-json-storage.md):

- Domain repositories share `Database.syncDb()` and pass `Database.TxOrDb` into projector writes. Transactions default to `immediate`, with nested calls joining the outer transaction to protect read-then-write sequence allocation.
- `Database.effect` queues notifications until commit, never on rollback or while holding the write lock. Outside a transaction it runs immediately; queued callback failures are logged after commit, not treated as a rolled-back write.
- Whole-record JSON columns retain domain data; separate columns support queries and ordering. Domain-owned sanitizers retain their read-side validation rather than relying on a copied table inventory.
- `project.directories = null` means bootstrap from sandboxes; `[]` means a deliberately empty list. Identity upserts must not overwrite this independent column.
- `loop.started_runs = null` means derive once from history, not zero. Keep the counter outside definition upserts and trimmed history so lifetime limits still work.
- `loop_run` and `mission_exec` intentionally lack definition foreign keys so orphan recovery can find surviving work. Explicit repository removal owns cascading cleanup.

Session diffs remain durable because imported shares and collected snapshot objects prevent reliable reconstruction. Pending-input admission, instruction folding, event visibility, and graceful-restart limits remain in the [live contracts](./v2/README.md), not research snapshots.

---

## Justify open payloads

`Schema.Unknown` on an endpoint `success` or a domain object emits `unknown` in the SDK. Keep it only for payloads that are genuinely open, and name the reason here rather than in a side document:

- **Upstream passthrough** — a third-party body the server does not interpret.
- **Polymorphic event-sourced entries** — `session_entry` / sync frames whose variant set grows without a contract bump. Re-checked 2026-08-30 (H10): `Schema.TaggedUnion.matchOrElse` does not change this. A half-open union of known variants plus a catch-all was measured and rejected — a malformed known member decodes as the fallback.
- **SSE frames** — the encoded event feed; the wire is `{ type, properties }`, not a closed union at the HTTP layer.
- **Bodyless redirects** — share short-links used to stay `Unknown` so a 308 did not invent a JSON body. H9 (2026-08-30) declared `location` with `HttpApiSchema.WithHeaders`, so `ShareShortOutput` is `{ body: void, headers: { location } }` and this category is empty.

Everything else gets a real schema. Measure top-level leftovers with:

```sh
grep -cE '^export type [A-Za-z0-9_]+ = (unknown|Array<unknown>)$' packages/sdk/js/src/httpapi/generated/types.ts
```

That command only sees an alias whose **whole** right-hand side is open. It is the headline number, not the whole count, and an item is not done because it reached zero. An open payload nested inside a struct is invisible to it.

Measured **2026-08-19** (H1 closed; unchanged since H6 landed): open payloads emit `unknown`, not `any` — the codegen no longer rewrites `\bunknown\b` → `any`. Index-signature catchalls still emit `{ [x: string]: any }`. Top-level open aliases as of H9 (2026-08-30) are `SessionV2EntryList = Array<unknown>`, `SessionV2State = unknown`, `SessionV2EventList = Array<unknown>`, `AccountResponse = unknown`, `WorkspaceJournalEvent = unknown`, `MobileGithubReposOutput = Array<unknown>`, `MobileSessionStreamOutput = unknown`, `MobileEventsOutput = unknown`, `SyncStreamOutput = unknown` (all justified in the categories above). `ShareShortOutput` left that list when H9 declared `location`. Flattened write inputs are `{ name: OpPayload["name"]; … }` plus path params. Loop/mission create-update, `MobileProject`, and `ProfilePatchInput` are real structs.

```sh
grep -nE '(\[x: string\]: any|Array<unknown>|: unknown\b)' packages/sdk/js/src/httpapi/generated/types.ts
```

- **`{ [x: string]: any }` as a top-level tail** — `Config`, `AgentConfig`, `TuiConfig`. These are the `nikcli.json` document (`fromZod(Config.Info)`); the tail is that zod document’s deliberate open end, and it is the **only** whole-body catchall left. `MobileConfigInfo` is no longer one — it emits the full struct with the tail only where the zod document has it. Find them with `awk '/^export type/{n=$3} /^  \[x: string\]: any/{print n}'`; the flat grep above cannot tell a top-level tail from a nested field.
- **`{ [x: string]: any }` as one field** — `metadata`, tool `input`, `JSONSchema`. Justified: the value is caller-defined or already a JSON Schema.
- **`properties: unknown` on `TuiPublishInput`; `body: unknown` on `TuiControlResponseInput` / `TuiControlRequest`** — the publish route is the write side of the SSE `{ type, properties }` envelope: the runtime check on `type` finds the entry in the `TuiEvent` registry (`bus/tui-event.ts`) and the matching per-event schema parses `properties`. The control channel is a verbatim relay queue (`server/tui-control.ts`); the server never interprets the body. Justified — a contract-time union would freeze HTTP to the bus registry or the control protocol.
- **`payload: unknown` on a write input** — **none left** (H1, 2026-08-17). The six TUI payloads reuse `TuiEventPayload`, `ConnectorsAuthSetInput.payload` is `ConnectorAuth.EntrySchema`, and `MobileLoopCreateInput` / `MissionUpdateInput` are structs. `grep -c 'payload: unknown'` on the generated types is 0; it staying 0 is the check.

---

## Maintain contracts

- A document states its **Status** in the first lines: `Current`, `Proposed`, `Accepted and implemented`, or `Historical`.
- Current documents describe contracts without copying exact types; the type is in the code.
- Proposals record the alternatives that were rejected and why, so the comparison is not re-litigated.
- Historical documents keep the names that were accurate when written.
- Do not add implementation checklists to contract documents. They belong in [ROADMAP.md](./ROADMAP.md).
