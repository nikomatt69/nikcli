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
| [TUI package extraction](./tui-package.md)                         | Proposed    | Move the TUI out of `src/cli/cmd/tui` into `packages/tui`.             |
| [v2 contracts](./v2/README.md)                                     | Index       | Session, tools, events, instructions, catalog, provider policy.        |
| [SQL + Drizzle adoption](./storage/nikcli-sql-drizzle-adoption.md) | Implemented | The central database runtime, migrations, and domain-owned schema.     |
| [Retire JSON storage](./storage/remove-json-storage.md)            | Retired     | How the `Storage.*` JSON key-value store was removed. Zero call sites. |

## Rules

- A document states its **Status** in the first lines: `Current`, `Proposed`, `Accepted and implemented`, or `Historical`.
- Current documents describe contracts without copying exact types; the type is in the code.
- Proposals record the alternatives that were rejected and why, so the comparison is not re-litigated.
- Historical documents keep the names that were accurate when written.
- Do not add implementation checklists to contract documents. They belong in [ROADMAP.md](./ROADMAP.md).
