# Roadmap

Last reconciled against the source: **2026-08-14**.

This is the ordered plan. Each item says what it buys, what proves it is needed, what it depends on, and how you know it is done. Items are referenced by id from the specs (`S1`, `T2`, …) so a document never has to restate the plan.

An item is only here if the evidence for it is in the repository today. Nothing on this list is speculative product work.

## How To Read This

| Field       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| **Buys**    | The user-visible or operational improvement. If this is vague, drop the item. |
| **Evidence**| The file and fact that makes the case. Verifiable now.                  |
| **Blocks**  | What cannot be done well before this lands.                             |
| **Done when** | A check someone else can run.                                          |

Horizons are ordering, not dates. An item moves up when its dependency lands, not when someone has time.

---

## Already Landed

State the wins, so nobody re-plans them:

- **One database.** `nikcli.db` with a journaled TypeScript migration chain, WAL, `foreign_keys=ON`, `mmap_size=0`. `bun:sqlite` is opened in exactly one place. Sessions, messages, parts, todos, permissions, and sync events are SQL. See [storage/nikcli-sql-drizzle-adoption.md](./storage/nikcli-sql-drizzle-adoption.md).
- **One HTTP surface.** ~286 Effect `HttpApi` endpoints; Hono and the experimental flag are gone from `src`. Clients are generated from the contract by `packages/httpapi-codegen`.
- **One event log.** `sync_event` carries both session and workspace aggregates, with snapshots for cold start and an outbox for remote push. The parallel `session_v2_event` and `workspace.events` logs were dropped.
- **Entry read model.** `session_entry` with ids whose lexicographic order *is* conversation order. See [v2/session.md](./v2/session.md).
- **Instance hot reload.** Config-surface watching with scoped, announced cache invalidation, and an explicit narrow `Provider.refresh()`. See [v2/catalog-config-plugin-lifecycle.md](./v2/catalog-config-plugin-lifecycle.md).
- **Byte-stable tool advertisement.** Locale-independent id ordering, so the prompt-cache prefix is identical across machines. See [v2/tools.md](./v2/tools.md).

---

## Horizon 1 — Now

Correctness and cost. No new public surface, no contract changes.

### E1 · Encode the event stream once, bound each connection

- **Buys** — Server CPU that stops scaling with connected clients, and a stalled reader that gets evicted instead of growing without limit.
- **Evidence** — `src/server/httpapi/event.ts`: both handlers define a private `send` that runs `JSON.stringify` per connection; `controller.enqueue` has no lag budget; `GlobalBus` is a bare `EventEmitter` with no `setMaxListeners`, so the 11th `/global/event` client emits a false leak warning. Upstream measured −89% at 10 clients and −98% at 50 for the same boundary.
- **Blocks** — Nothing. Independent of every other item, which is why it goes first.
- **Done when** — One encode per event with N subscribers is asserted by a test; a slow subscriber fails with a typed `SubscriberOverflowError` while healthy ones keep receiving in order; both wire shapes (`{type,…}` on `/event`, `{payload}` on `/global/event`) are byte-identical to today.
- **Spec** — [v2/event-stream-architecture.md](./v2/event-stream-architecture.md)

### D1 · Give `Session` its own errors

- **Buys** — An honest picture of what is still on JSON, and error types that can say "no such session" instead of "file not found".
- **Evidence** — `src/session/index.ts` declares `Session.Error = BusyError | Storage.NotFoundError | Storage.IOError` and coerces unknown rejections into `Storage.IOError`, though session rows have been SQL since `20260611000000`.
- **Blocks** — D2. While the error types are shared, a grep cannot distinguish a real JSON dependency from a vestigial one.
- **Done when** — `src/session` imports nothing from `src/storage`, and the HTTP error mapping is unchanged for clients.
- **Spec** — [storage/remove-json-storage.md](./storage/remove-json-storage.md)

### D2a · Move loops to SQL

- **Buys** — Loop definitions and runs get a schema, a real transaction, and queries instead of key-prefix directory scans.
- **Evidence** — `src/loop/manager.ts` performs `list`/`read`/`write`/`update`/`remove` over `Storage` key prefixes across ~15 call sites. It is a three-column table implemented as a directory tree.
- **Blocks** — The rest of D2. This establishes the repository shape the other domains copy.
- **Done when** — Loops read and write through Drizzle; a data migration backfills the existing JSON tree; `test/database/database.test.ts`'s journal assertion is updated in the same commit.
- **Spec** — [storage/remove-json-storage.md](./storage/remove-json-storage.md)

### S2 · Continue sessions after a graceful restart

- **Buys** — `nikcli upgrade` and a server redeploy stop killing in-flight turns. Today the transcript survives and the turn does not.
- **Evidence** — `PromptState` holds ownership in memory only; `serve.ts` aborts every controller on `SIGINT`/`SIGTERM`. Nothing marks or resumes.
- **Blocks** — Nothing, deliberately. It is scoped to the graceful case precisely so it does not wait on S1.
- **Done when** — One private nullable `session_info.time_suspended` column exists; suspend-then-interrupt on shutdown; atomic consume-and-resume on startup; two servers racing on one directory resume each session exactly once; the column appears in no HTTP response.
- **Spec** — [v2/session-restart-continuation.md](./v2/session-restart-continuation.md)

### X1 · Rematerialize the deleted spec tree

- **Buys** — The documentation for features that are live and undocumented.
- **Evidence** — 54 files under `packages/nikcli/specs/` are staged as deleted while only `project.md` and `storage/` were rewritten at the new root. The deleted set includes documents for shipped subsystems: `codemode.md`, `sdk-next.md`, `simulation.md`, `generative-tui.md`, `startup-performance.md`, `unified-auth.md`, `tui-plugins.md`, `tui-math.md`, `browser-live-view.md`, `computer-browser-use.md`, `httpapi-codegen.md`, `user-profile.md`, `opentui-0.4-upgrade.md`, the `effect/` migration set, and the `opencode-parity/` set.
- **Blocks** — Nothing technically. But every week it stays deleted, another live feature loses its only written explanation.
- **Done when** — Each deleted document is either restored under `specs/` with a current status header, or explicitly deleted with the reason recorded in this file. Restoring is `git checkout HEAD -- <path>` plus a move; deciding is the work.

---

## Horizon 2 — Next

Contracts. These change what the system promises, so each needs its spec landed before its code.

### S1 · Durable pending input

- **Buys** — Steering a running turn, queueing a follow-up, and a compaction barrier that actually blocks input. Today none of the three exist.
- **Evidence** — `SessionPrompt.admit` writes the user message straight into visible history. `loop` has no delivery mode; a second caller joins the active loop through `PromptState` callbacks and receives the owner's result. There is no pending row and no promotion transaction.
- **Blocks** — S4 (the engine swap has nothing to swap to without this), and any credible hard-crash recovery.
- **Done when** — A `session_pending` row plus a promotion transaction exist; `steer` promotes at the next safe step boundary while `queue` waits for idle; promoting input resets the agent's step allowance once per batch; an interrupted turn leaves its pending input intact.
- **Spec** — [v2/session.md](./v2/session.md) §"Admission Precedes Execution"; needs its own decision record before implementation.

### T2 · Tool output schemas

- **Buys** — Code Mode gets typed, validated values instead of a string it has to parse. The registry can reject a malformed success.
- **Evidence** — `Tool.Result.output` is a `string` and is simultaneously the model-facing content and the machine value `src/codemode/tool-runtime.ts` consumes. A tool cannot declare an output shape.
- **Blocks** — Any serious Code Mode work. It is the largest remaining divergence in the tool contract.
- **Done when** — A tool may declare an output codec; the encoded value reaches Code Mode; model-facing content stays separately bounded; a tool without an output codec keeps working unchanged.
- **Spec** — [v2/tools.md](./v2/tools.md) §"One Response Value, Not Three"

### T1 · Scoped tool registration

- **Buys** — A plugin that unloads stops contributing its tools, and the tool it shadowed comes back.
- **Evidence** — `ToolRegistry.register` splices or appends into one flat per-instance array. There is no scope, no removal, and no overlay stack; the `InstanceState` entry is deliberately non-reloadable *because* runtime registrations would be lost, which is the same problem seen from the other side.
- **Blocks** — TUI plugin hot reload reaching parity for tool-contributing plugins.
- **Done when** — Registration returns a scoped handle; closing it removes exactly that registration and reveals the next-latest; the registry can become reloadable without losing runtime tools.

### S3 · Instruction sync as value deltas

- **Buys** — A prompt prefix that survives an `AGENTS.md` edit, an auditable record of what a session was told, and no more silent guidance loss on a failed read.
- **Evidence** — `Instruction.system()` re-reads every rule file and re-fetches every instruction URL on every request assembly; a failed read or a 5s timeout becomes an empty string and vanishes.
- **Blocks** — Nothing hard, but it interacts with compaction epochs, so land it after S1 while the safe-boundary machinery is fresh.
- **Done when** — One `session.instructions.updated { delta }` event of content hashes; blobs stored once, content-addressed; request assembly renders from stored values; a compaction moves the epoch without reading sources.
- **Spec** — [v2/instruction-sync-proposal.md](./v2/instruction-sync-proposal.md)

### P1 · Provider policy

- **Buys** — One evaluation point instead of five copies, and a vocabulary that extends to `plugin.load` and `mcp.connect`.
- **Evidence** — The same two-line allow/deny check is written out in `provider/provider.ts`, `server/httpapi/provider.ts`, `cli/cmd/auth.ts`, `session/auth.ts`, and the TUI provider dialog — which mutates `disabled_providers` directly.
- **Blocks** — Nothing. Small and self-contained; it sits here rather than in Horizon 1 only because nothing is currently broken by it.
- **Done when** — Ordered statements with wildcards and last-match-wins; old fields translate at config load and keep working; four of the five call sites read the catalog instead of re-deriving.
- **Spec** — [v2/provider-policy.md](./v2/provider-policy.md)

---

## Horizon 3 — Later

Structure. Large, and each depends on Horizon 2.

### S4 · Move the session write path to v2

- **Buys** — One engine. Today `SessionV2` is an honest strangler: reads are native entries, writes delegate to the v1 `Session`/`SessionPrompt` services so behavior stays exactly the production engine's.
- **Evidence** — The status comment at the top of `src/session/v2/index.ts` says so, and `SessionV2.prompt` is a pass-through to `SessionPrompt.prompt`.
- **Depends on** — S1. Without durable pending input the new write path would reimplement the old one's limits.
- **Done when** — Writes produce entries directly; the v1 projection becomes derived; `MessageV2` remains authoritative for the LLM layer, which is not in scope for this item.

### U1 · Extract the TUI into `packages/tui`

- **Buys** — A TUI that builds, tests, and starts without the backend module graph, and a second host (desktop) that shares one implementation.
- **Evidence** — 252 files and ~68k lines under `src/cli/cmd/tui`, with 241 `@/` imports across 67 distinct backend modules — but only ~18 of those touch server-side execution. The `@tui/*` alias already resolves as if it were a package root.
- **Depends on** — Nothing formally, but section 1 (extract shared `util`) removes 103 of the 241 imports and is worth doing regardless.
- **Done when** — `packages/tui` typechecks with `packages/nikcli` out of its references; no import resolves into `packages/nikcli`; the TUI starts from the installer binary; warm startup does not regress.
- **Spec** — [tui-package.md](./tui-package.md)

### U3 · Lazy-load themes → U2 · Semantic theme tokens

- **Buys** — Startup that does not parse 92 theme documents to render one, then a token system where a warning badge is readable in every theme without a component inventing colors.
- **Evidence** — `theme.tsx` statically imports 92 of 98 theme JSON files. Six documents (`arctic`, `muted`, `osaka-jade`, `oxocarbon`, `vivid`, `zinc`) are imported by nothing and referenced nowhere. Components read flat colors: 746 `textMuted`, 359 `text`, 207 `primary`.
- **Order matters** — U3 first. Adding tokens to 98 documents while all 98 are eagerly parsed multiplies the startup cost of the very change meant to improve the UI.
- **Done when** — Only the selected theme plus one built-in are parsed at startup; then paired foreground/background tokens and explicit surface levels exist, with a compatibility proxy deleted at the end.
- **Spec** — [v2/tui-theme-migration.md](./v2/tui-theme-migration.md)

### D2b · Finish retiring JSON storage

- **Buys** — One durability model. Ends the class of bug where a crash between a SQL write and a JSON write leaves state no migration can detect.
- **Depends on** — D1, D2a.
- **Done when** — No production module imports `src/storage/storage.ts`; the file and `storage/effect.ts` are deleted; the JSON tree stays on disk for downgrade.
- **Spec** — [storage/remove-json-storage.md](./storage/remove-json-storage.md)

---

## Explicit Non-Goals

Recorded so they are not re-proposed:

- **Nested `/project/:projectID/session/...` URLs.** Directory scoping is middleware plus storage keys. See [project.md](./project.md).
- **Automatic hard-crash session recovery.** S2 covers the graceful case on purpose. Anything more needs provider-dispatch ambiguity, tool idempotency, and retry budgets designed together.
- **Clustered session ownership.** Execution stays process-local until there is an explicit placement and fencing protocol.
- **A shared PubSub for the event feed.** Considered and rejected in E1's spec; the win it offers is queue-slot references, not frame copies.
- **Rebuilding TUI features opencode already has.** The jlongster TUI set is already present; "moving sessions" upstream is nikcli's existing warp.

## Working Rules

- Commit at phase boundaries, not per file.
- Every commit that changes a contract updates its spec in the same commit.
- Verify with `bun test` unit tests and `bun run typecheck` (never a bare `tsc`; the repo's `.bin/tsc` is the JS 5.x one). Do not verify with the simulation harness.
- Adding a migration breaks `test/database/database.test.ts`'s journal assertion. That is expected; update it in the same commit.
