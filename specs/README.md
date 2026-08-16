# Nikcli Specifications

These documents explain behavior that is hard to recover from one source file: cross-module contracts, decisions and their alternatives, and the migrations still in flight.

They are **not** API reference and **not** a backlog. Generated clients follow the assembled `HttpApi`; work items live in [ROADMAP.md](./ROADMAP.md) and in issues.

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
| [Project / multi-directory](./project.md)                          | Historical  | Why the HTTP surface is flat instead of nested under `/project/:id`.   |
| [TUI package extraction](./tui-package.md)                         | Complete    | TUI lives in `packages/tui`; host files stay in `packages/nikcli`.     |
| [v2 contracts](./v2/README.md)                                     | Index       | Session, tools, events, instructions, catalog, provider policy.        |
| [Public event filter](./v2/public-event-filter.md)                 | Proposed    | Which bus events never reach a client, and why withheld means absent.  |
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
grep -cE '^export type [A-Za-z0-9_]+ = (any|Array<any>)$' packages/sdk/js/src/httpapi/generated/types.ts
```

That command only sees an alias whose **whole** right-hand side is open. It is the headline number, not the whole count, and an item is not done because it reached zero. An open payload nested inside a struct is invisible to it — measured 2026-08-16, 9 top-level aliases against 189 lines containing `any`. Three shapes hide there and each is a different verdict:

```sh
grep -nE '(\[x: string\]: any|Array<any>|: unknown\b)' packages/sdk/js/src/httpapi/generated/types.ts
```

- **`{ [x: string]: any }` as a whole body** — `MobileConfigInfo` is the config document, which has `fromZod(Config.Info)` available. Not justified.
- **`{ [x: string]: any }` as one field** — `metadata`, tool `input`, `JSONSchema`. Justified: the value is caller-defined or already a JSON Schema.
- **`payload: unknown` on a write input** — `MobileLoopCreateInput`, `MissionUpdateInput`. Never justified; the definition schema exists in the tree.

## Rules

- A document states its **Status** in the first lines: `Current`, `Proposed`, `Accepted and implemented`, or `Historical`.
- Current documents describe contracts without copying exact types; the type is in the code.
- Proposals record the alternatives that were rejected and why, so the comparison is not re-litigated.
- Historical documents keep the names that were accurate when written.
- Do not add implementation checklists to contract documents. They belong in [ROADMAP.md](./ROADMAP.md).
