# Roadmap

Last reconciled against the source: **2026-08-14**.

This is the ordered plan. Each item says what it buys, what proves it is needed, what it depends on, and how you know it is done. Items are referenced by id from the specs (`S1`, `T2`, …) so a document never has to restate the plan.

An item is only here if the evidence for it is in the repository today. Nothing on this list is speculative product work.

## How To Read This

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| **Buys**      | The user-visible or operational improvement. If this is vague, drop the item. |
| **Evidence**  | The file and fact that makes the case. Verifiable now.                        |
| **Blocks**    | What cannot be done well before this lands.                                   |
| **Done when** | A check someone else can run.                                                 |

Horizons are ordering, not dates. An item moves up when its dependency lands, not when someone has time.

---

## Already Landed

State the wins, so nobody re-plans them:

- **One database.** `nikcli.db` with a journaled TypeScript migration chain, WAL, `foreign_keys=ON`, `mmap_size=0`. `bun:sqlite` is opened in exactly one place. Sessions, messages, parts, todos, permissions, and sync events are SQL. See [storage/nikcli-sql-drizzle-adoption.md](./storage/nikcli-sql-drizzle-adoption.md).
- **One HTTP surface.** ~286 Effect `HttpApi` endpoints; Hono and the experimental flag are gone from `src`. Clients are generated from the contract by `packages/httpapi-codegen`.
- **One event log.** `sync_event` carries both session and workspace aggregates, with snapshots for cold start and an outbox for remote push. The parallel `session_v2_event` and `workspace.events` logs were dropped.
- **Entry read model.** `session_entry` with ids whose lexicographic order _is_ conversation order. See [v2/session.md](./v2/session.md).
- **Instance hot reload.** Config-surface watching with scoped, announced cache invalidation, and an explicit narrow `Provider.refresh()`. See [v2/catalog-config-plugin-lifecycle.md](./v2/catalog-config-plugin-lifecycle.md).
- **Byte-stable tool advertisement.** Locale-independent id ordering, so the prompt-cache prefix is identical across machines. See [v2/tools.md](./v2/tools.md).
- **Turns survive a graceful restart** (was S2, landed 2026-08-14). A private nullable `session_info.time_suspended` with a partial index; `serve` suspends what the process is running before the aborts, and claims each suspension exactly once at startup with a single `UPDATE … RETURNING`. Resume is advisory, because `loop` already derives continuation from history. Hard crashes remain out of scope. See [v2/session-restart-continuation.md](./v2/session-restart-continuation.md).
- **Loops in SQL** (was D2a, landed 2026-08-14). `loop` + `loop_run` behind `LoopRepo`, with `20260814000000_loop_sql` backfilling the JSON tree. The `loop_meta` record kind is gone — the counter is a column excluded from the definition upsert. This is the repository shape the remaining domains follow. See [v2/schema-changelog.md](./v2/schema-changelog.md).
- **Remaining domain state in SQL** (was D2b step 3, landed 2026-08-14). Missions, monitors, shares, and artifacts sit behind `MissionRepo` / `MonitorRepo` / `ShareRepo` / `ArtifactRepo`, with `20260814020000_domain_sql` backfilling the JSON tree. See [storage/remove-json-storage.md](./storage/remove-json-storage.md).
- **Project identity in SQL** (D2b remainder, first move, landed 2026-08-14). `project` behind `ProjectRepo`, with `20260814030000_project_sql` backfilling `storage/project/…` and folding `["project_directory", id]` into a nullable `directories` column. Stats, usage, and analytics backfill enumerate via `ProjectRepo.list()`; `memory_search` dropped a dead `Storage` import. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **Analytics JSON snapshots deleted** (D2b remainder, landed 2026-08-14). `GET /analytics/{global,daily,session,sessions}` queries `message_info` / `session_info` / `message_part`. The install UUID for anonymous reporting sits in one-row `analytics_share` (`20260814040000_analytics_share`). `record*` is a no-op. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **Session goals in SQL** (D2b remainder, landed 2026-08-14). `session_goal` behind `GoalRepo`, with `20260814050000_session_goal` backfilling `storage/goal/…`. `SessionGoal.Service` no longer reads JSON. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **Background runs in SQL** (D2b remainder, landed 2026-08-14). `background_run` behind `BackgroundRunRepo`, with `20260814060000_background_run` backfilling `storage/background_run/…`. Lease/heartbeat stay inside `data`; `listRunning` is a status query so orphan detection survives a restart. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **Routines in SQL** (D2b remainder, landed 2026-08-14). `routine` behind `RoutineRepo`, with `20260814070000_routine` backfilling `storage/routine/…`. `restoreSchedulers` at bootstrap reads SQL. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **Session diffs in SQL** (D2b remainder, landed 2026-08-14). `session_diff` sits behind `SessionDiffRepo`, with `20260814080000_session_diff` backfilling `storage/session_diff/…`. It moved instead of being deleted because unreferenced snapshot trees can be garbage-collected, and imported shares may have only a ready-made `FileDiff[]`. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **PTY / workspace owned 404s** (D2b remainder, landed 2026-08-14). `Pty.NotFoundError` and `Workspace.NotFoundError` replace borrowed `Storage.NotFoundError`; the HTTP wire literal stays `"NotFoundError"`. The workspace JSON backfill is journaled as `20260814090000_workspace_json`, and runtime no longer scans `storage/workspace/*.json`. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 4.
- **JSON Storage retired** (was D2b remainder steps 4–5, completed 2026-08-14). `src/storage/storage.ts` and `src/storage/effect.ts` are gone, along with all production imports. Leftover JSON trees remain for downgrade only and are ignored by current runtime reads. See [storage/remove-json-storage.md](./storage/remove-json-storage.md).
- **Built-in themes lazy-load** (was U3, landed 2026-08-14). Only `nikcli.json` is parsed at TUI module load. The other 97 documents plus the `dim` alias load through static `import()` loaders when selected. Previously unwired files (`arctic`, `muted`, `osaka-jade`, `oxocarbon`, `vivid`, `zinc`) are in the catalog. See [v2/tui-theme-migration.md](./v2/tui-theme-migration.md).
- **Semantic theme tokens** (was U2, landed 2026-08-14). Nested tokens are derived from the flat document in `theme-tokens.ts`. TUI callers use `foreground` / `surface` / `status` / `badge` / `syntax` / `accent.{fg,alt,secondary}`. The `asDual` proxy and the `ThemeColors` intersection on `Theme` are gone. See [v2/tui-theme-migration.md](./v2/tui-theme-migration.md).
- **Subsystem-doc triage** (was X1, landed 2026-08-14). `dc0f8bb003` deleted 52 files under `packages/nikcli/specs/`. The 14 that described live subsystems were read from `dc0f8bb003^` and triaged below — none restored wholesale, because each copy describes a world the code has already left (Hono, `exec_code`, OpenTUI 0.1.95, Browser Use Cloud). Source of truth stays the code until a rewrite against current source is worth a separate pass.

  | Deleted doc                                | Why it stays deleted                                                                                        |
  | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
  | `codemode.md`                              | Live in `src/codemode/`. The copy still argues against `exec_code`/`native-executor` and is Italian-only.   |
  | `sdk-next.md`                              | Live as `packages/sdk-next`, but the copy wires `Server.App()` (Hono). Current host is `Server.fetch`.      |
  | `simulation.md`                            | Live as `packages/simulation` + `NIKCLI_DRIVE`. The copy is a port log, not a current contract.             |
  | `generative-tui.md`                        | Live in `src/tool/opentui.ts`. The copy is a port map onto json-render, not the shipped catalog.            |
  | `startup-performance.md`                   | Snapshot of one graph-cutting pass. Warm-start numbers would be fiction within a week.                      |
  | `unified-auth.md` / `unified-auth-plan.md` | Auth landed; the copies describe the migration, not the current `packages/auth` + UserDB surface.           |
  | `tui-plugins.md`                           | Live as `src/cli/cmd/tui/feature-plugins/` + `plugin/internal.ts`. The copy predates the current slot API.  |
  | `tui-math.md`                              | Live as `packages/tui-math`. Upgrade notes, not a contract.                                                 |
  | `browser-live-view.md`                     | Describes `opentui-browser` Kitty screencast. Current tool is `browser_control` (Playwright).               |
  | `computer-browser-use.md`                  | Live tools, but the copy still mentions `NIKCLI_EXPERIMENTAL_*` default-on flags that are now disable-envs. |
  | `httpapi-codegen.md`                       | Live as `packages/httpapi-codegen`, but the copy still generates "because Hono is the real router".         |
  | `user-profile.md`                          | Live as `src/profile/profile.ts` + Brain habits. Restore only as a rewrite against that module.             |
  | `opentui-0.4-upgrade.md`                   | Finished 2026-08-01. The two-copy `@opentui/core` bug is historical.                                        |

- **One encode per event** (was E1, landed 2026-08-14). `EventFeed` fans both SSE routes out from a single encoded frame, with a per-connection lag budget carried by the stream's own queuing strategy. A stalled reader is evicted with a stated reason instead of growing an unbounded internal queue; `/global/event` went from one `GlobalBus` listener per client to one total. Both wire shapes unchanged. See [v2/event-stream-architecture.md](./v2/event-stream-architecture.md).
- **Session-owned errors** (was D1, landed 2026-08-14). `src/session/error.ts` declares `SessionNotFoundError` and `SessionIOError`; `Session.Error` no longer borrows from `Storage`. The HTTP wire is unchanged — boundaries emit the literal `"NotFoundError"` rather than forwarding `_tag`, which also fixes two sites that produced the tag by coincidence. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 1.
- **Tool output schemas** (was T2, landed 2026-08-14). A tool may declare an `output` zod codec; the wrapper parses `result.value` after execute and rejects a malformed success for that call only. Code Mode receives `Tool.encoded(result, codec)` — the validated value when a codec exists, otherwise the model-facing string. Truncation still bounds only `output`. Tools without a codec are unchanged. See [v2/tools.md](./v2/tools.md) §"One Response Value, Not Three".
- **Provider policy** (was P1, landed 2026-08-14). `Policy` centrally evaluates `experimental.policies` with full or trailing-prefix wildcards and ordered last-match-wins. Legacy enabled/disabled fields translate with their old precedence; the provider catalog, HTTP provider list, CLI auth picker, and session auth picker consume the evaluator, while TUI disconnect writes deny statements. Unit tests cover matching, translation, overrides, filtering, and schema validation; HTTP integration covers legacy allowlist filtering. See [v2/provider-policy.md](./v2/provider-policy.md).
- **Scoped tool registration** (was T1, landed 2026-08-14). `ToolRegistry.register` returns a handle whose `close` removes exactly that stack entry and reveals the next-latest occupant of the id. Config-dir and plugin tools live in a reloadable derived cache; runtime registrations live in a separate non-reloadable cache, so a hot reload cannot drop sdk-next tools. See [v2/tools.md](./v2/tools.md) §"Registration Is An Overlay Stack".

---

## Horizon 1 — Now

Empty. Correctness items with no new public surface have landed. Next work is Horizon 2 (contracts).

---

## Horizon 2 — Next

Contracts. These change what the system promises, so each needs its spec landed before its code.

### S1 · Durable pending input

- **Buys** — Steering a running turn, queueing a follow-up, and a compaction barrier that actually blocks input. Today none of the three exist.
- **Evidence** — `SessionPrompt.admit` writes the user message straight into visible history. `loop` has no delivery mode; a second caller joins the active loop through `PromptState` callbacks and receives the owner's result. There is no pending row and no promotion transaction.
- **Blocks** — S4 (the engine swap has nothing to swap to without this), and any credible hard-crash recovery.
- **Done when** — A `session_pending` row plus a promotion transaction exist; `steer` promotes at the next safe step boundary while `queue` waits for idle; promoting input resets the agent's step allowance once per batch; an interrupted turn leaves its pending input intact.
- **Spec** — [v2/durable-pending-input.md](./v2/durable-pending-input.md) (proposed). Implementation waits on acceptance of that record; do not start from [v2/session.md](./v2/session.md) §"Admission Precedes Execution" alone.

### S3 · Instruction sync as value deltas

- **Buys** — A prompt prefix that survives an `AGENTS.md` edit, an auditable record of what a session was told, and no more silent guidance loss on a failed read.
- **Evidence** — `Instruction.system()` re-reads every rule file and re-fetches every instruction URL on every request assembly; a failed read or a 5s timeout becomes an empty string and vanishes.
- **Blocks** — Nothing hard, but it interacts with compaction epochs, so land it after S1 while the safe-boundary machinery is fresh.
- **Done when** — One `session.instructions.updated { delta }` event of content hashes; blobs stored once, content-addressed; request assembly renders from stored values; a compaction moves the epoch without reading sources.
- **Spec** — [v2/instruction-sync-proposal.md](./v2/instruction-sync-proposal.md)

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
