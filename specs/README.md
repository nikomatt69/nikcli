# Nikcli Specifications

These documents explain behavior that is hard to recover from one source file: cross-module contracts, decisions and their alternatives, and the migrations still in flight.

They are **not** API reference and **not** a backlog. Generated clients follow the assembled `HttpApi`; evidenced engineering work lives in [ROADMAP.md](./ROADMAP.md), while user outcomes and product bets live in [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md).

## Authority

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

## Index

| Document                                                           | Status      | Job                                                                    |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| [ROADMAP](./ROADMAP.md)                                            | Live        | The ordered plan: what is done, what is next, and what each step buys. |
| [Product roadmap](./PRODUCT_ROADMAP.md)                            | Proposed    | Outcome priorities, evidence gates, and promotion into engineering.    |
| [Project / multi-directory](./project.md)                          | Historical  | Why the HTTP surface is flat instead of nested under `/project/:id`.   |
| [TUI package extraction](./tui-package.md)                         | Complete    | TUI lives in `packages/tui`; host files stay in `packages/nikcli`.     |
| [v2 contracts](./v2/README.md)                                     | Index       | Session, tools, events, instructions, catalog, provider policy.        |
| [Public event filter](./v2/public-event-filter.md)                 | Implemented | Which bus events never reach a client, and why withheld means absent.  |
| [SQL + Drizzle adoption](./storage/nikcli-sql-drizzle-adoption.md) | Implemented | The central database runtime, migrations, and domain-owned schema.     |
| [Retire JSON storage](./storage/remove-json-storage.md)            | Retired     | Both storage modules are deleted; production storage imports are zero. |

## Open payloads

`Schema.Unknown` on an endpoint `success` or a domain object compiles to `any` in the SDK. Keep it only for payloads that are genuinely open, and name the reason here rather than in a side document:

- **Upstream passthrough** — a third-party body the server does not interpret.
- **Polymorphic event-sourced entries** — `session_entry` / sync frames whose variant set grows without a contract bump.
- **SSE frames** — the encoded event feed; the wire is `{ type, properties }`, not a closed union at the HTTP layer.
- **Bodyless redirects** — share short-links and similar 3xx responses.

Everything else gets a real schema. Measure top-level leftovers with:

```sh
grep -cE '^export type [A-Za-z0-9_]+ = (unknown|Array<unknown>)$' packages/sdk/js/src/httpapi/generated/types.ts
```

That command only sees an alias whose **whole** right-hand side is open. It is the headline number, not the whole count, and an item is not done because it reached zero. An open payload nested inside a struct is invisible to it.

Measured **2026-08-19** (H1 closed; unchanged since H6 landed): open payloads emit `unknown`, not `any` — the codegen no longer rewrites `\bunknown\b` → `any`. Index-signature catchalls still emit `{ [x: string]: any }`. Top-level open aliases are now `SessionV2EntryList = Array<unknown>`, `SessionV2State = unknown`, `SessionV2EventList = Array<unknown>`, `AccountResponse = unknown`, `WorkspaceJournalEvent = unknown`, `MobileGithubReposOutput = Array<unknown>`, `MobileSessionStreamOutput = unknown`, `MobileEventsOutput = unknown`, `SyncStreamOutput = unknown`, `ShareShortOutput = unknown` (all justified in the categories above). Flattened write inputs are `{ name: OpPayload["name"]; … }` plus path params. Loop/mission create-update, `MobileProject`, and `ProfilePatchInput` are real structs.

```sh
grep -nE '(\[x: string\]: any|Array<unknown>|: unknown\b)' packages/sdk/js/src/httpapi/generated/types.ts
```

- **`{ [x: string]: any }` as a top-level tail** — `Config`, `AgentConfig`, `TuiConfig`. These are the `nikcli.json` document (`fromZod(Config.Info)`); the tail is that zod document’s deliberate open end, and it is the **only** whole-body catchall left. `MobileConfigInfo` is no longer one — it emits the full struct with the tail only where the zod document has it. Find them with `awk '/^export type/{n=$3} /^  \[x: string\]: any/{print n}'`; the flat grep above cannot tell a top-level tail from a nested field.
- **`{ [x: string]: any }` as one field** — `metadata`, tool `input`, `JSONSchema`. Justified: the value is caller-defined or already a JSON Schema.
- **`properties: unknown` on `TuiPublishInput`; `body: unknown` on `TuiControlResponseInput` / `TuiControlRequest`** — the publish route is the write side of the SSE `{ type, properties }` envelope: the runtime check on `type` finds the entry in the `TuiEvent` registry (`bus/tui-event.ts`) and the matching per-event schema parses `properties`. The control channel is a verbatim relay queue (`server/tui-control.ts`); the server never interprets the body. Justified — a contract-time union would freeze HTTP to the bus registry or the control protocol.
- **`payload: unknown` on a write input** — **none left** (H1, 2026-08-17). The six TUI payloads reuse `TuiEventPayload`, `ConnectorsAuthSetInput.payload` is `ConnectorAuth.EntrySchema`, and `MobileLoopCreateInput` / `MissionUpdateInput` are structs. `grep -c 'payload: unknown'` on the generated types is 0; it staying 0 is the check.

## Rules

- A document states its **Status** in the first lines: `Current`, `Proposed`, `Accepted and implemented`, or `Historical`.
- Current documents describe contracts without copying exact types; the type is in the code.
- Proposals record the alternatives that were rejected and why, so the comparison is not re-litigated.
- Historical documents keep the names that were accurate when written.
- Do not add implementation checklists to contract documents. They belong in [ROADMAP.md](./ROADMAP.md).
