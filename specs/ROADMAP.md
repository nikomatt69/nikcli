# Roadmap

Orders verified work by value and dependency.

Last reconciled against the source: **2026-08-18** (I1 / X2 / H6 landed in working tree; H4 / H5 / P2 / E4 / H1 first slice already committed).

This is the ordered plan. Each item says what it buys, what proves it is needed, what it depends on, and how you know it is done. Items are referenced by id from the specs (`S1`, `T2`, `H1`, …) so a document never has to restate the plan.

An item is only here if the evidence for it is in the repository today. Nothing on this list is speculative product work.

The previous plan closed one durability model, one HTTP surface, and one TUI package. Those **seams** now exist. The next plan deepens the HttpApi **module** — it is the **interface** every remaining adapter (TUI, SDK, mobile, standalone host) already crosses — and finishes the Effect v4 runtime that still sits behind ALS and `Effect.promise`. A shallow field on that interface (`Schema.Unknown` → generated `any`, a path spelled in four files, a hand-copied namespaced client, a present `undefined` that forces `JSON.parse(JSON.stringify)`) leaks to every caller.

Do not start a second HttpApi rewrite. Hono and `NIKCLI_EXPERIMENTAL_HTTPAPI` are gone.

---

## Read the plan

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| **Buys**      | The user-visible or operational improvement. If this is vague, drop the item. |
| **Evidence**  | The file and fact that makes the case. Verifiable now.                        |
| **Blocks**    | What cannot be done well before this lands.                                   |
| **Done when** | A check someone else can run.                                                 |

Horizons are ordering, not dates. An item moves up when its dependency lands, not when someone has time.

The first PR is **H4 + H5** together: one dispatcher, one `HandlersLive` list, `supports()` generated from the contract. Land the uncommitted method-bucket benchmark with H5.

| ID      | Horizon | Item                                                                  |
| ------- | ------- | --------------------------------------------------------------------- |
| **H4**  | Now     | Close contract-only strangler leftovers (one live dispatcher)         |
| **H5**  | Now     | Generate `HttpApiBridge.supports` from `PublicApi`                    |
| **H1**  | Now     | Close remaining nested `Unknown` / `payload: unknown`                 |
| **E4**  | Now     | Encode optionals as absent keys (delete `jsonSafe`)                   |
| **H6**  | Later   | Codegen named field refs; keep `unknown` as `unknown`                 |
| **H7**  | Later   | JSON `/mobile/*` onto encoded handlers                                |
| **E5**  | Later   | Typed Effect failure channel on HttpApi handlers                      |
| **H3**  | Later   | Generate the SDK namespaced view (`compat.ts`)                        |
| **P2**  | Later   | Request-path cuts (URL, session lookup, logs, list SQL)               |
| **H8**  | Later   | `HttpApiMiddleware` on encoded groups                                 |
| **R1**  | Later   | Keyed scoped instance runtime (drop ALS)                              |
| **I1**  | Later   | Reconcile Identifier (`util/id` vs `util/identifier`)                 |
| **T3**  | Later   | Output codecs on structured built-ins                                 |
| **S4r** | Later   | Import / teleport / run write through SessionV2                       |
| **X2**  | Later   | Delete adapters with no production callers                            |
| **P3**  | Later   | `normalizeMessages` on the LLM turn path                              |

---

## Review landed work

State the wins, so nobody re-plans them:

- **One database.** `nikcli.db` with a journaled TypeScript migration chain, WAL, `foreign_keys=ON`, `mmap_size=0`. `bun:sqlite` is opened in exactly one place. Sessions, messages, parts, todos, permissions, and sync events are SQL. See [storage/nikcli-sql-drizzle-adoption.md](./storage/nikcli-sql-drizzle-adoption.md).
- **One HTTP surface.** Effect `HttpApi` endpoints; Hono and the experimental flag are gone from `src`. Clients are generated from the contract by `packages/httpapi-codegen`.
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
- **JSON Storage retired** (was D2b remainder steps 4–5, completed 2026-08-14). Production storage imports are zero. `session_diff` remains durable behind `SessionDiffRepo` because imported shares may contain only `FileDiff[]` and snapshot GC may remove unreferenced `write-tree` objects. `20260814090000_workspace_json` journals the idempotent workspace backfill. Legacy JSON stays on disk for downgrade only and is ignored by runtime reads and writes. PTY and workspace now own their domain errors while preserving the HTTP wire literal `"NotFoundError"`. See [storage/remove-json-storage.md](./storage/remove-json-storage.md).
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

- **One encode per event** (was E1, landed 2026-08-14). `EventFeed` fans both SSE routes out from a single encoded frame, with a per-connection lag budget carried by the stream's own queuing strategy. A stalled reader is evicted with a stated reason instead of growing an unbounded internal queue; `/global/event` went from one `GlobalBus` listener per client to one total. Both wire shapes unchanged. The proposal's "public filter" stage was not built here; it landed separately as E3c below. See [v2/event-stream-architecture.md](./v2/event-stream-architecture.md).
- **Session-owned errors** (was D1, landed 2026-08-14). `src/session/error.ts` declares `SessionNotFoundError` and `SessionIOError`; `Session.Error` no longer borrows from `Storage`. The HTTP wire is unchanged — boundaries emit the literal `"NotFoundError"` rather than forwarding `_tag`, which also fixes two sites that produced the tag by coincidence. See [storage/remove-json-storage.md](./storage/remove-json-storage.md) step 1.
- **Tool output schemas** (was T2, landed 2026-08-14). A tool may declare an `output` zod codec; the wrapper parses `result.value` after execute and rejects a malformed success for that call only. Code Mode receives `Tool.encoded(result, codec)` — the validated value when a codec exists, otherwise the model-facing string. Truncation still bounds only `output`. Tools without a codec are unchanged. Built-ins are not required to declare a codec. See [v2/tools.md](./v2/tools.md) §"One Response Value, Not Three".
- **Provider policy** (was P1, landed 2026-08-14). `Policy` centrally evaluates `experimental.policies` with full or trailing-prefix wildcards and ordered last-match-wins. Legacy enabled/disabled fields translate with their old precedence; the provider catalog, HTTP provider list, CLI auth picker, and session auth picker consume the evaluator, while TUI disconnect writes deny statements. Unit tests cover matching, translation, overrides, filtering, and schema validation; HTTP integration covers legacy allowlist filtering. See [v2/provider-policy.md](./v2/provider-policy.md).
- **Scoped tool registration** (was T1, landed 2026-08-14). `ToolRegistry.register` returns a handle whose `close` removes exactly that stack entry and reveals the next-latest occupant of the id. Config-dir and plugin tools live in a reloadable derived cache; runtime registrations live in a separate non-reloadable cache, so a hot reload cannot drop sdk-next tools. See [v2/tools.md](./v2/tools.md) §"Registration Is An Overlay Stack".
- **Durable pending input** (was S1, landed 2026-08-14). Busy input lives in `session_pending` until atomic batched promotion, outside transcript history. The TUI restores queued message cards with `press ctrl-enter to send`: Enter queues, Ctrl/Cmd+Enter with text steers the new input, and the same shortcut with an empty composer changes the oldest queued card to steering until promotion. Canonical retry identity, targeted waiters, safe compaction boundaries, cancellation, and graceful restart remain intact without claiming hard-crash recovery or clustered ownership. See [v2/durable-pending-input.md](./v2/durable-pending-input.md).
- **Instruction sync** (was S3, landed 2026-08-14). Request assembly admits a `session.instructions.updated` delta of content hashes, stores bodies once in `instruction_blob`, and renders the system prefix from the fold. A failed later read keeps the last stored value. Successful compaction moves the epoch without re-reading sources. TUI and desktop show changed keys from the delta (not prose or hashes). See [v2/instruction-sync-proposal.md](./v2/instruction-sync-proposal.md).
- **V2 write path** (S4, 2026-08-14). Entries persist first; v1 is `toV1*` of those rows; HTTP create/prompt share `SessionV2`. `prompt_data` stays on `message_info`. `SessionPrompt.loop` still runs the step engine. See [v2/session-v2-write-path.md](./v2/session-v2-write-path.md).
- **Public event filter** (was E3, then E3c, landed 2026-08-16). Six event types no longer cross the SSE **seam**: two that were the bus used as in-process RPC (`lsp.client.diagnostics`, `mcp.browser.open.failed`) and four with no subscriber anywhere (`command.executed`, `instance.reload.started`, `instance.reloaded`, `loop.aborted`). Visibility is declared on the event, not listed in the feed, so it cannot drift from what it describes; `Feed.broadcast` returns ahead of the encode, and a withheld event produces no frame at all. The wire change is that those six left the generated `Event` union — free, because nothing referenced them. `project.directories.updated` was deleted rather than filtered (declared, never published), and `BusEvent.payloads()` went with it: a second zod copy of the union with zero callers. `schemas()` now requires an Effect Schema for public events only, which retires the documented landmine where one zod-only **test fixture** made `bun test test/server/ test/bus/` fail while either directory alone passed. See [v2/public-event-filter.md](./v2/public-event-filter.md).
- **One instance-less path module** (was H2, landed 2026-08-16). `httpapi/instance-less.ts` owns the root table (`/global`, `/user`, `/account`), each root claiming its bare path as well as its subtree. `HttpApiBridge.handleGlobal`, `Server.fallback`, `ServerRouter.dispatch` and `PublicRoutes.globalRequest` ask `isInstanceLessPath` / `instanceLessRoot` instead of spelling prefixes out. The raw handlers are one `InstanceLessDispatch` record in `httpapi/global-handlers.ts`, keyed by the root union, so adding a root fails `bun run typecheck` until it says what answers — the drift that used to be uncheckable is now a compile error. That record is a second module and not part of `instance-less.ts` on purpose: `server.ts` and `server-router.ts` need only the path predicate, and folding the handlers in would pull `UsersHttp` and `AccountHttp` into their module graph. `test/server/instance-less-paths.test.ts` pins the predicate and fails if a decision site re-spells a prefix. `account-path.ts` is gone; no HTTP wire change, `check:routes` clean.
- **TUI package extracted** (was U1, landed 2026-08-16). `packages/tui` (`@nikcli-ai/tui`) holds the terminal. `packages/nikcli/src/cli/cmd/tui/` keeps four host files — `thread.ts`, `worker.ts`, `attach.ts`, `plugin/host-local.ts` — so the literal `./src/cli/cmd/tui/worker.ts` in the build scripts stays correct. `packages/tui` has no `@/` import and no `nikcli-ai` dependency; its tsconfig does not reference `packages/nikcli`. The second consumer is `packages/tui/bin/nikcli-tui.ts` → `src/host/standalone.ts`, which attaches to a server it did not start. Compatibility re-exports that only forwarded are gone; the installer hook is wired explicitly. See [tui-package.md](./tui-package.md).
- **H1 write-path leftovers** (landed 2026-08-17, remainder below). Loop/mission create and update reuse `Domain.*` (`httpapi/domain.ts`, `httpapi/loop.ts`, `httpapi/mission.ts`) instead of `Schema.Unknown` plus a cast. `MobileProject` is a real struct. `ProfilePatchInput` is `Profile.InputSchema`. Headline `= any` aliases in `packages/sdk/js/src/httpapi/generated/types.ts` are the justified open payloads only (SessionV2 entry/state/event, SSE, share redirects, GitHub repo list, plus `MobileEventsOutput`). Nested `any` lines in that file went 189 → 125. `MobileLoopCreateInput` / `MissionUpdateInput` are no longer `payload: unknown`.
- **Bash output cap** (already in tree; do not re-plan the June 2026 unbounded-buffer finding). `tool/bash.ts` truncates at `MAX_OUTPUT_LENGTH = 5 * 1024 * 1024`.
- **HttpApi layer memoized** (already in tree; do not “optimize” per-request layer build). `HttpApiBridge.webHandler` uses `sharedMemoMap`; Effect `toWebHandler` caches the built handler. See [research-effect-di.md](./research-effect-di.md).

---

## Finish current work

### Close the contract-only strangler leftovers (H4)

- **Buys** — One live dispatcher for JSON contract-only routes. Adding a handle in the group file cannot typecheck and 404 because `public.ts` was not copied. `check:routes` can actually mean “this path is served.” `/account` gets the same generation contract `/user` already has.
- **Evidence** — `PublicApi` adds eight contract-only groups. Live serving is a second pathname stack (`PublicRoutes` / `extra.ts` / `HttpApiPrompt`). `httpapi/global-handlers.ts` says the two stacks exist *because* H4 has not landed. `ContractExtraHttpApi.HandlersLive` is an Effect copy of those routes; the only importer of `contract-extra.ts` is `public.ts`, and it adds the groups, not `HandlersLive`. Almost every group already exports `HandlersLive`; `public.ts` re-declares the same `.handle` names. Only `SyncHttpApi.HandlersLive` is composed as-is. Group-local `export const layer` is unused by the served API. `/user/*` is on `UsersGroup`; `/account`, `/account/login`, and `/account/login/complete` are not on `PublicApi`. `GET /config/profiles` is served from `extra.ts` and is absent from `rawRouteImplementations` (the POSTs are listed). `bun run check:routes --strict` is a no-op: `packages/nikcli/script/check-route-coverage.ts` never reads `argv`, while `script/ci-validate.ts` still passes `--strict`.
- **Depends on** — nothing now that H2 landed: `/account` is already a root in `httpapi/instance-less.ts`, so putting it on `PublicApi` is a contract edit, not a routing one.
- **Done when** — `HandlersLive` in `contract-extra.ts` is deleted or is the single live adapter for those JSON routes. `PublicHttpApi.layer` is `Layer.mergeAll(SessionHttpApi.HandlersLive, …)` — the per-group `HandlersLive` is the single list. `GET /config/profiles` is in `inventory.ts`. `/account` is on `PublicApi` the way `/user` is. `check-route-coverage.ts` implements `--strict` (fail on contract/handler/raw inventory gaps) and CI’s existing flag starts meaning something. `bun run check:routes --strict` is clean. SSE, prompt streaming, and websocket upgrades stay raw (see non-goals).
- **First PR** — land with H5.

### Generate `HttpApiBridge.supports` from `PublicApi` (H5)

- **Buys** — The pre-router allowlist cannot drift from the contract. A miss still falls through to the website proxy, which is why `supports()` must exist: an HttpApi 404 must not replace `app.nikcli.store`.
- **Evidence** — `implementedRoutes` in `httpapi/bridge.ts` is a second spelling of `PublicApi` + inventory (~215 regexes). Coverage scripts already exist (`script/httpapi-bridge-inventory.ts`, `test/server/routes-coverage.test.ts`). Method bucketing at module load (uncommitted 2026-08-17) plus `test/benchmarks/bridge-supports.benchmark.test.ts` is the right **lookup**; the **source** of the table is still copy-paste. Steady state in that bench is ~2–3µs/op — not the request-path bottleneck; H5 is a drift fix, not a latency hunt.
- **Depends on** — nothing. Land with H4 so the generated table and the single dispatcher agree.
- **Done when** — `listImplemented()` is generated from `OpenApi.fromApi(PublicApi)` plus `rawRouteImplementations`. A new group without a regex cannot ship. Method buckets and the benchmark stay. `supports()` is not deleted.

### Close remaining nested `Unknown` / `payload: unknown` (H1)

- **Buys** — Generated clients stop seeing `any` / `unknown` on bodies the server already validates. Effect handlers reject a malformed TUI or connector write instead of taking `Schema.Unknown`.
- **Evidence** — Headline `= any` aliases measured 2026-08-17 are the justified open payloads in [README.md](./README.md) §Open payloads:

  ```
  SessionV2EntryList = Array<any>
  SessionV2State = any
  SessionV2EventList = Array<any>
  WorkspaceJournalEvent = any
  MobileGithubReposOutput = Array<any>
  MobileSessionStreamOutput = any
  MobileEventsOutput = any
  SyncStreamOutput = any
  ShareShortOutput = any
  ```

  Nested leftovers the headline grep cannot see:

  | Leftover | Source already in tree |
  | --- | --- |
  | Six TUI `payload: unknown` (`TuiAppendPromptInput`, `TuiExecuteCommandInput`, `TuiShowToastInput`, `TuiPublishInput`, `TuiSelectSessionInput`, `TuiControlResponseInput`) | zod `parseWith` in `httpapi/tui.ts` |
  | `ConnectorsAuthSetInput.payload: unknown` | connector auth schema |
  | `MobileConfigInfo` `[x: string]: any` catchall | `fromZod(Config.Info)` — the zod document’s open tail |

  `MobileConfigInfo`’s catchall is the one config exception: either pin it or name it in [README.md](./README.md) §Open payloads as justified (the `nikcli.json` catchall). Do not treat a zero headline `any` count as done.
- **Blocks** — Typed TUI/SDK callers for those writes; H3 generating `any`/`unknown` into the namespaced view.
- **Done when** — The nested measure in [README.md](./README.md) §Open payloads lists only justified open payloads. TUI payloads reuse the zod codecs already used by `parseWith`, lifted to Effect. Connector auth payload reuses the connector schema. `bun run generate:httpapi-clients` and `bun run check:routes` pass. Land one group at a time; curl the write route against a real server — the encoder rejects `undefined` as empty data, not as an error (see E4).
- **Keep `Unknown`** — `SessionV2` entry/state/event lists (`SessionEntry.Entry` grows without a contract bump). SSE (`/event`, `/sync/stream`, mobile session stream, `MobileEventsOutput`). Share short-links. GitHub repo list: type the `imported*` wrapper fields; the upstream repo body may stay open. Do not pin `SessionEntry.Entry` through `fromZod` as part of this item.
- **Spec** — [README.md](./README.md) §Open payloads; `packages/nikcli/AGENTS.md` §Schema rules.

### Encode optionals as absent keys (E4)

- **Buys** — Encoded GET `/session/:id/message` (and every other `jsonSafe` handler) stops doing `JSON.parse(JSON.stringify(...))` before HttpApi encodes. Present `undefined` is no longer a failed request.
- **Evidence** — Effect v4: `Schema.optional` is `optionalKey(UndefinedOr(self))` (effect-smol `Schema.ts`), so a **present** `undefined` is valid TypeScript and invalid JSON. `Schema.optionalKey` creates an absent key (`age?: number`). Nikcli HTTP/domain structs almost all use `Schema.optional`; `optionalKey` appears only under `src/codemode/`. Session objects still carry `parentID: undefined` as own properties. `httpapi/session.ts` documents `jsonSafe` for that reason and uses it 29 times; `mission.ts` 11, `loop.ts` 10, plus provider/config. The hot path is SQL `JSON.parse(row.info)` then `jsonSafe` then Schema encode.
- **Depends on** — nothing. Parallel with H4. Do not wait for H1; this is encoding, not contract openness.
- **Done when** — Encoded success structs use `Schema.optionalKey` (or the service boundary strips present-`undefined` once). `jsonSafe` is gone from HttpApi handlers. `GET /session/:id` and `GET /session/:id/message` round-trip against a real server without encoder failures on optional fields. A bench next to `bridge-supports.benchmark.test.ts` pins `jsonSafe` vs omit-undefined on a real session-list payload if the helper survives anywhere.

---

## Plan later structure

These are evidenced leftovers, not product ideas. They wait because a smaller item in current work already covers the same **seam**, or because the leftover is one adapter.

### Codegen named field refs (H6)

- **Buys** — Smaller `types.ts`, cheaper `bun run typecheck`, readable SDK types. Open payloads stay `unknown` instead of silently becoming `any`.
- **Evidence** — Flattened Promise inputs emit the whole struct per field:

  ```ts
  // packages/httpapi-codegen/src/index.ts (promiseInput emission)
  `(${typeOf(schema)})[${JSON.stringify(field.name)}]`
  ```

  `LoopUpsertInput` inlines `LoopCreateInput` once per field (`T["name"]`, `T["stages"]`, …). That indexed-access pattern appears hundreds of times in `packages/sdk/js/src/httpapi/generated/types.ts`. `structuralTypes` also rewrites `\bunknown\b` → `any`. `generate-httpapi-clients.ts` omits union payloads `auth.set` and `session.partUpdate` from the Effect client because `HttpApiClient.ForApi` narrows a union payload to its first member.
- **Depends on** — H1 (do not freeze `any` into named refs). Independent of H4.
- **Done when** — Flattened inputs are `{ name: LoopCreateInput["name"]; … }` or `payload: LoopCreateInput` plus path params. `unknown` stays `unknown` for documented open payloads. Effect clients express `auth.set` and `session.partUpdate` or the omit list is justified next to `PublicApi`. `bun run generate:httpapi-clients` and SDK typecheck pass.

### JSON `/mobile/*` onto encoded handlers (H7)

- **Buys** — A drifted mobile JSON schema fails the request instead of shipping a body the contract did not describe. One encoder with `/loop` and `/session`.
- **Evidence** — `httpapi/mobile.ts` says every `/mobile/*` endpoint is served through `handleRaw` (contract-only). `mobile-handlers.ts` is 115 `handleRaw("…", forward)` calls into `dispatchMobileRequest`. Loop/session/git JSON routes do not need the raw `Request`. SSE, teleport upload, and PTY upgrade do.
- **Depends on** — H1 leftovers that those routes still leave open; E4 so encoded mobile responses do not need a second `jsonSafe`. H4 so there is one dispatcher to hang `.handle` on.
- **Done when** — JSON mobile routes use `.handle`. Raw stays for stream/upload/upgrade. The dispatcher shrinks to those leftovers. `bun run generate:httpapi-clients` and `bun run check:routes --strict` pass.

### Typed Effect failure channel (E5)

- **Buys** — Expected 404/409 cannot arrive as defects. Handlers stop wrapping every service in `Effect.promise` + `orDie` + `catchDefect`.
- **Evidence** — `httpapi/session.ts`: “services still wrap async impls with `Effect.promise`, so expected errors can arrive on either channel” — then `declaredErrors` does `catch` **and** `catchDefect`. `loop.ts` uses `fromPromise = Effect.promise(fn).pipe(Effect.orDie)`. `Session.BusyError` is already `Schema.TaggedErrorClass`. `httpapi/errors.ts` (`notFound` / `badRequest` / `conflict` with `__http` markers) has no production importer — only `test/server/httpapi-errors.test.ts`. Session handlers reinvent `{ name, data }` next to the schema.
- **Depends on** — nothing strictly. Cleaner after H4 so there is one place to catch.
- **Done when** — Domain methods return `Effect.fail(SessionError.NotFoundError)` (and siblings). Handlers `catchTag` / schema-declared errors. `Effect.promise` is only for true unknown I/O. `httpapi/errors.ts` is wired or deleted.

### Generate the SDK namespaced view (H3)

- **Buys** — Adding a declared HttpApi group cannot ship a client that typechecks and 404s at `api.client.<group>`.
- **Evidence** — `packages/sdk/js/src/httpapi/compat.ts` is "maintained by hand" (its own header). [tui-package.md](./tui-package.md) paid an hour for this: codegen produced the raw and Effect clients; `api.client.chatbot` did not exist until the group was added to the namespaced view by hand. The remapping (`app.agents` → `raw["top-level"].agent`) **is** the caller **interface**; deleting `compat.ts` would reappear as edits across the TUI.
- **Depends on** — H1 (do not generate `any` into the namespaced view). Better after H6 so the generated view is not built on indexed-access blobs.
- **Done when** — Codegen emits the namespaced view from a declared map next to `PublicApi`. Adding a group without updating that map fails `packages/sdk` typecheck. Existing call sites do not change names.

### Request-path cuts (P2)

- **Buys** — Encoded JSON requests stop paying for work the contract already did. Hot polls (`/event`, `/session/status`, TUI) stop dominating logs and extra SQL.
- **Evidence** —
  - `ServerRouter.make` already parses `URL`; `PublicRoutes.*`, `body-limit`, `extra.ts`, mobile dispatcher, and (if pathname not forwarded) the bridge call `new URL(request.url)` again.
  - `context()` always `sessionForRequest` → `Session.getAnyProject` when the path looks like a session id, even when `x-nikcli-workspace` / `?workspace=` is already set.
  - Effect `toWebHandler` installs `HttpMiddleware.logger` unless `disableLogger: true` (effect-smol `HttpRouter.ts`). `HttpApiBridge` does not pass that. `ServerRouter.make` also logs start + duration for every request except `POST /log`. Encoded requests are logged twice.
  - `GET /session` loads every project session via `SessionRepo.list`, then filters directory/search/limit in JS, then `jsonSafe`.
  - `MessageRepo.countMessages` does `select id … .all().length` instead of `COUNT(*)`.
- **Depends on** — H5 if the bench runner is the place new scenarios live. E4 if session-list cost is dominated by `jsonSafe`. Do not rebuild the HttpApi layer per request — it is already memoized.
- **Done when** — Dispatch takes `{ url, pathname }`. `sessionForRequest` runs only when workspace is not in query/header. Effect logger is disabled **or** nikcli’s duplicate is dropped; `/event` and `/session/status` are sampled or duration-gated. Session list limit/filter can be SQL. `countMessages` is `COUNT(*)`. Benches exist for `ServerRouter.context` with/without the session lookup and for encoded `GET /session/:id`. Loose CI budgets, same as the supports bench.

### `HttpApiMiddleware` on encoded groups (H8)

- **Buys** — Auth, tracing, and schema-error mapping live on the contract instead of a second check in the bridge. OpenAPI security follows the groups.
- **Evidence** — effect-smol `HttpApiMiddleware` is for “authentication, authorization, logging, tracing, rate limiting, request-scoped services, schema-error handling.” `packages/nikcli/src` has zero imports of it. Auth runs in `ServerRouter.make` then again in `HttpApiBridge.handle` unless `upstreamAuthVerified` is set.
- **Depends on** — H4 (one dispatcher). E5 (typed errors, or middleware has nothing typed to map). `/user` and `/account` stay ahead of the router until their `{ error }` union can be discriminated (`global-handlers.ts`).
- **Done when** — Encoded groups declare security middleware. Bridge does not re-authenticate when the middleware already ran. SSE / prompt / upgrade stay outside it (non-goal). OpenAPI shows the security scheme.

### Keyed scoped instance runtime (R1)

- **Buys** — One instance key. Fibers see `InstanceRef` without falling back to ALS. `withInstanceAsync({ init })` can die.
- **Evidence** — `project/instance.ts` still caches `Map<string, Promise<Context>>` via `util/context.ts` ALS. Only two production users: `instance.ts` and `workspace-context.ts`. `InstanceState.context` catches missing `InstanceRef` and reads `Instance.directory`. `with-instance.ts` says the `init` path is removed “when the keyed scoped runtime replaces the promise cache.” Instance bootstrap (`project/bootstrap.ts`) is the one-time `init` passed from `server-router.ts`. See [research-effect-di.md](./research-effect-di.md).
- **Depends on** — H4, so HTTP is not also the ALS guinea pig. Independent of H5/H6.
- **Done when** — Per-directory `ManagedRuntime` / `ScopedCache` owns bootstrap. `Instance.provide` is gone or is a thin test helper. `InstanceState.context` does not catch into ALS. `util/context.ts` has no production importers.

### Reconcile Identifier (I1)

- **Buys** — One id **module**. A caller cannot import the unprefixed generator and persist a row the prefixed schema will reject.
- **Evidence** — [tui-package.md](./tui-package.md) §1 left this open: `packages/util/src/identifier.ts` and the nikcli prefixed id were two implementations of the same idea. The prefixed one moved to `@nikcli-ai/util/id` (every `packages/nikcli` and `packages/tui` import). `@nikcli-ai/util/identifier` remains — unprefixed `ascending()` / `descending()`, used only by `packages/enterprise/src/core/share.ts` and its test. **Deletion test:** removing `identifier.ts` concentrates the prefix/schema rules in `id.ts`; the enterprise adapter has to take a prefix.
- **Depends on** — nothing. Later because the only leftover adapter is enterprise.
- **Done when** — One export. Enterprise compiles against it. `packages/util/src/identifier.ts` is gone or is a deprecated alias that does not generate unprefixed ids. Same pass may delete the `@deprecated` `@/computer/sandbox` and `sandbox-image` re-exports of `@nikcli-ai/computer-use`.

### Output codecs on structured built-ins (T3)

- **Buys** — Code Mode and any machine consumer get a validated `value` from tools that already return JSON in `output`.
- **Evidence** — T2 landed the wrapper; built-ins are not required to use it ([v2/tools.md](./v2/tools.md)). No built-in in `src/tool/*.ts` declares an `output` codec. `browser-control` and `todo` already `JSON.stringify` structured results into the model-facing string.
- **Depends on** — nothing. Later because T2 called this additive; do not add a CI rule that every tool must have a codec.
- **Done when** — Tools that already emit JSON declare a codec and return `value`. Model-facing `output` stays a string. A malformed `value` fails that call only. Tools that emit prose are unchanged.

### Import / teleport / run write through SessionV2 (S4 remainder)

- **Buys** — One conversation write. A share import or teleport cannot commit v1 rows the entry table cannot represent.
- **Evidence** — S4 inverted HTTP create/prompt ([v2/session-v2-write-path.md](./v2/session-v2-write-path.md)). Three callers still write `MessageRepo` first and then `SessionEntryProjection.rebuild`: `cli/cmd/run.ts`, `cli/cmd/import.ts`, `server/mobile/teleport.ts`.
- **Depends on** — nothing. Later because the HTTP path already uses `SessionV2Write.persist`.
- **Done when** — Those three callers persist through `SessionV2` / `SessionV2Write.persist`. `rebuild` after a direct `MessageRepo` write is gone from production. Token coalescing in `SessionProcessor.updatePartCoalesced` may still publish ahead of the projector — that path is documented and is not this item. Do not delete `SessionV2Write` or `SessionEntryProjection` as part of this; they earn their keep. `SessionV2.prompt` / `admit` / `loop` / `create` remaining as thin wrappers over `SessionPrompt` / `Session.createNext` is a later naming cleanup, not this item.

### Delete adapters with no production callers (X2)

- **Buys** — Locality: a reader cannot pick the unused share, message, runner, or LLM path and think it is live.
- **Evidence** — `BusEvent.payloads()` was one of these and is already gone (taken by E3c, because filtering a second copy of the union that nothing calls is worse than deleting it). The rest: production share/HTTP/bootstrap use `ShareNext`, not `share/share.ts`. `session/message.ts` is only imported from session test suites. `session/runner.ts` / `run-state.ts` are only imported from `test/session/runner.test.ts`; live ownership is `PromptState`. `session/llm/ai-sdk.ts` has no importers. `provider/llm-client.ts` exports an Effect layer with no importers (`LLM.stream` is the live path).
- **Depends on** — nothing. Later because none of these are on a live call path.
- **Done when** — Those modules are gone, or each remaining one has a production importer. `specs/v2/session.md` no longer describes `SessionRunner` as if it were a second ownership machine. Tests that only existed to pin the unused module go with it.

### `normalizeMessages` on the LLM turn path (P3)

- **Buys** — Provider turns allocate fewer copies of the message list. Not an HTTP win.
- **Evidence** — `provider/transform.ts` still has `// TODO: fix this stupid inefficient dogshit function` on `normalizeMessages` (multiple `msgs.map` passes, per-part allocations). June 2026 resource review flagged it; the function is still there. Independent of the HttpApi module.
- **Depends on** — nothing. Later because it is on the LLM turn, not the contract.
- **Done when** — One documented pass (or a measured reason to keep several). A bench or a comment with a counter replaces the TODO. Behavior of sanitization / tool-result shaping is unchanged.

---

## Respect non-goals

Recorded so they are not re-proposed:

- **Nested `/project/:projectID/session/...` URLs.** Directory scoping is middleware plus storage keys. See [project.md](./project.md).
- **Automatic hard-crash session recovery.** S2 covers the graceful case on purpose. Anything more needs provider-dispatch ambiguity, tool idempotency, and retry budgets designed together.
- **Clustered session ownership.** Execution stays process-local until there is an explicit placement and fencing protocol.
- **A shared PubSub for the event feed.** Considered and rejected in E1's spec; the win it offers is queue-slot references, not frame copies.
- **Rebuilding TUI features opencode already has.** The jlongster TUI set is already present; "moving sessions" upstream is nikcli's existing warp.
- **Rewriting `SessionProcessor` or `toModelMessages` to consume entries.** [v2/session.md](./v2/session.md) leaves `MessageV2` as the LLM layer on purpose.
- **Pinning `SessionEntry.Entry` on the HTTP contract.** The variant set grows without a contract bump; that is why those three SessionV2 types stay `Unknown`.
- **Promoting raw streaming / prompt / SSE / websocket routes into encoded Effect handlers.** `POST /session/:id/message` and `prompt_async` are raw because they open a chunked 200 or return 204 before the loop finishes (`httpapi/prompt.ts`). SSE and upgrades stay ahead of the router. H7 does not promote mobile SSE/upload/upgrade.
- **Desktop as a second TUI renderer.** [tui-package.md](./tui-package.md) §6: `packages/desktop` is a Tauri webview; the TUI renders through `@opentui/solid`. The packaging check is `nikcli-tui`, and it already exists.
- **Deleting leftover `storage/*.json` trees.** They stay on disk for downgrade. Runtime does not read them.
- **Mandatory tool output codecs.** T2 is opt-in. T3 adds codecs only where the tool already returns structured JSON.
- **Raising SQLite `mmap_size`.** `mmap_size = 0` is a durability choice; WAL checkpoint already runs. Not a perf item without a measured crash/WAL story.
- **`idleTimeout` other than `0` without an SSE/websocket-aware policy.** `server.ts` sets `idleTimeout: 0` on both `Bun.serve` and `listenEffect`. Default Bun idle would kill EventFeed. EventFeed already evicts stalled readers.
- **Per-request HttpApi layer rebuild.** `sharedMemoMap` + `toWebHandler` already cache the handler.
- **Full `fromZod` rewrite of `config.ts`.** The `nikcli.json` document is zod; `fromZod` is the correct adapter. New HTTP/domain shapes are Effect-first; `zodObject` is for leftover zod callers.

## Review landed work

Recorded at phase boundaries so the next pass does not redo work.

### 2026-08-17 — H4 / H5 / P2 / E4 / H1 first slice

**Phase 1 — P2 quick cuts (4 small perf items).**
- `bridge.ts` `webHandler` now sets `disableLogger: true`. Effect's `HttpMiddleware.logger` was double-logging every encoded request on top of `ServerRouter.dispatch`'s start/duration log; nikcli's own log wins.
- `MessageRepo.countMessages` switched from `SELECT id … array.length` to `SELECT COUNT(*)` via drizzle's `count()`. Used by `SessionV2` entry-projection check.
- `ServerRouter.context` skips `sessionForRequest` when `?workspace=` or `x-nikcli-workspace` is set. The session lookup also derives the workspace; pinning one short-circuits the call.
- `extra.ts` keeps a single source of `URL` parsed at the top of the dispatcher (comment note).

**Phase 2 — E4 (delete `jsonSafe`).**
- `domain.ts` — `LoopWorktree`, `LoopStage`, `LoopAuthoredFields`, `LoopCreateInput`, `LoopUpdateInput`, `LoopPullRequestRef`, `LoopRun`, `LoopRuntime`, `LoopTemplate`, `Routine` switched to `Schema.optionalKey`. Two layers of `Schema.optional` (synthetic + author) flattened.
- `loop.ts` — `jsonSafe` definition removed; all 10 call sites dropped. Handlers return objects directly.
- `mission.ts` — same `jsonSafe` deletion. `MissionFeature`, `MissionMilestone`, `MissionModels`, `MissionWorktree`, `MissionDefinitionOutput`, `MissionExecSchema`, `MissionRuntime` switched to `optionalKey`.
- `provider.ts` — `jsonSafe` deletion; `CallbackPayload` `optionalKey`. `provider.list` and `provider.auth` return objects directly.
- `tui.ts` — `TuiConfig.get` no longer JSON-round-trips. `tui-event-schema.ts` `toastShow.title` switched to `optionalKey` so the wire carries the same shape.
- `connectors.ts` — `authSet` payload now typed as `ConnectorAuth.EntrySchema`, all `optionalKey`. `EntrySchema` re-exported from `connectors/auth.ts`.
- `session.ts` — local input schemas (ListQuery, CreatePayload, UpdatePayload, ForkPayload, RevertPayload, SummarizePayload, CommandPayload, ShellPayload, MonitorLogQuery, MessagesQuery, DiffQuery, ContextSource, ContextBreakdown, DelegationJob) switched to `optionalKey`. Service-boundary `jsonSafe` kept — the next E4 sub-step is the service-side `Session.Info` / `MessageV2.Info` schemas.

**Phase 3 — H1 first slice (TUI payloads typed).**
- `tui.ts` — `parseWith` helper removed. `AppendPromptPayload = TuiEventPayload.promptAppend`, `ExecuteCommandPayload = { command: string }`, `ShowToastPayload = TuiEventPayload.toastShow`, `PublishPayload = { type, properties: Unknown }`, `SelectSessionPayload = TuiEventPayload.sessionSelect`, `ControlResponsePayload = { path, body: Unknown }`. Handlers receive typed payloads; `Bus.publish` is the only Effect call. `TuiEventZod.toastShow` is the bridge for the legacy `default(5000)` zod parse.
- `connectors.ts` — `authSet` payload is `ConnectorAuth.EntrySchema` (the H1 connector leftover).
- `session.ts` — `partUpdate` handler now declares `payload: typeof MessagePart.Type` (was `unknown`); inside the body it parses through `MessageV2.Part.parse` because the service's `updatePart` takes the mutable `Part` (the first arm of `UpdatePartInput`'s zod union).

**Phase 4 — H5 (generate supports from PublicApi).**
- `bridge.ts` — `implementedRoutes` now derives from `OpenApi.fromApi(PublicApi)` via `routesFromPublicApi`. `pathToRegex` walks the OpenAPI template; `groupByMethod` keeps the per-method bucket strategy. Manual entries (`/mobile/*` prefix match) are an override layer.
- `globalRoutes` derives the same way, filtered by `/^\/(global|user)\//`, plus the three `/account` entries that the dispatcher still consults.
- Bench regression guard: `test/benchmarks/bridge-supports.benchmark.test.ts`. New numbers: hits 1.30µs/op (was 3.29µs), misses 1.43µs/op (was 1.65µs), mixed 1.33µs/op (was 1.63µs), supportsGlobal 0.06µs/op (was 0.59µs). Bucket strategy stays; the generator cut the per-method scan by ~10x for global.

**Phase 5 — H4 (collapse two dispatcher stacks).**
- `contract-extra.ts` adds `AccountGroup` (paths `/account`, `/account/login`, `/account/login/complete`, prefix `/account`, `handleRaw` callers to `AccountHttp.handle`). `ConfigManagementGroup` gains `profilesList` (GET `/config/profiles`).
- `public.ts` `PublicApi` and `PublicHttpApi.Api` both `.add(ContractExtraHttpApi.AccountGroup)`. `AccountHandlersLive` is registered in `Layer.mergeAll` next to the other handlers.
- `inventory.ts` — `rawRouteImplementations` updated so the three account paths are not flagged as both handler and raw. `/config/profiles` removed (now a contract entry).
- `global-handlers.ts` — `/account` entry is `undefined`; the second-stack dispatcher falls through to the encoded router.
- `auth.ts` — `isPublicPath` extended for `/account`, `/account/login`, `/account/login/complete`.
- `script/check-route-coverage.ts` — `process.argv.includes("--strict")` is now honored. `--strict` currently the same rules as default; future strict additions land here.
- Verifies: `bun run check:routes --strict` exits 0. 334 contracts, 311 handlers, 23 raw implementations.

**Followups noted, not done.**
- Eight `/account` `{ error }` bodies still cannot round-trip the HttpApi error encoder. The contract declares the schema with `success: AccountSuccess` (`Schema.Unknown.annotate`); the raw handle path answers. The discriminator stays raw until `TaggedErrorClass` lands enough of the contract error vocabulary.
- E4 service-side: `Session.Info` / `MessageV2.Info` schemas still use `Schema.optional`. The session.ts `jsonSafe` calls remain on `Session.Info` / `MessageV2.Info` returns until those schemas flip.
- **Re-opening June 2026 resource-review items that already landed.** JSON `storage.update()` pretty-print (storage module gone). Per-client SSE `GlobalBus.on` (EventFeed). Unbounded bash buffer (5MB cap).
- **A second Effect HttpApi rewrite.** The seam exists; deepen the module.
- **Product work without a structural leftover** — single-binary distribution, provider cost envelopes, unifying mobile and voice upload, an active Brain planner, share v2, a workspace trust lattice. None of those have a file-and-fact case in the tree today.

### 2026-08-18 — I1 / X2 / H6

**Phase 1 — I1 (one Identifier module).**
- `packages/util/src/identifier.ts` deleted. Unprefixed `ascending()` / `descending()` cannot generate an id the prefixed schema will reject.
- `packages/enterprise/src/core/share.ts` and its test import `@nikcli-ai/util/id` and call `Identifier.descending("event")` / `Identifier.descending("session")`. Prefix is required.

**Phase 2 — X2 (delete adapters with no production callers).**
- Deleted: `provider/llm-client.ts`, `session/llm/ai-sdk.ts`, `session/message.ts` (legacy v1; not `message-v2` / `message-repo`), `session/run-state.ts`, `session/runner.ts`, `share/share.ts` (nikcli adapter; not enterprise `share.ts`).
- Tests that only pinned those modules went with them: `test/session/runner.test.ts`, the audit-suite `Legacy Message schemas` block, and the deep-bench `Message.*` schema loop. `specs/v2/session.md` no longer describes `SessionRunner` as a second ownership machine. Live ownership stays `PromptState`; live share stays `ShareNext`.

**Phase 3 — H6 (codegen flatten + keep `unknown`).**
- Flattened Promise inputs stay flat (call-site compatible). Each struct payload is emitted once as `${Op}Payload`, then fields are `${Op}Payload["name"]` instead of inlining the whole struct per field.
- Headline open aliases stay `unknown` (`SessionV2State`, `AccountResponse`, `MobileGithubReposOutput`, …). Index-signature catchalls stay `{ [x: string]: any }` (the old global `\bunknown\b` → `any` rewrite is gone).
- SDK `SessionEntry` is `{ id: string } & Record<string, unknown>` — the generated list is still `Array<unknown>`.
- `ConfigHandlersLive` now `handleRaw`s `profilesList` (H4 leftover that failed typecheck).
- Named-ref `payload: LoopCreateInput` is not this landing. Measure in [README.md](./README.md) §Open payloads.

**Followups noted, not done.**
- H6 polish: emit input schemas into `structuralTypes` so flattened payloads can be `payload: LoopCreateInput`.
- E4 service-side `jsonSafe` in `session.ts` (`Session.Info` / `MessageV2.Info`).
- H7 / E5 / H8 / H3 / R1 / T3 / S4r / P3.

## Follow working rules

- Commit at phase boundaries, not per file. H4 and H5 land together.
- Every commit that changes a contract updates its spec in the same commit.
- Verify with `bun test` unit tests and `bun run typecheck` (never a bare `tsc`; the repo's `.bin/tsc` is the JS 5.x one). Do not verify with the simulation harness. Typecheck once at the end of an edit session.
- Adding a migration breaks `test/database/database.test.ts`'s journal assertion. That is expected; update it in the same commit.
- After an HttpApi contract change, run `bun run generate:httpapi-clients` from `packages/nikcli` and commit the generated output.
- `bun run check:routes` is the inventory gate today. `--strict` is honored as of H4 (same rules as default; future strict-only checks land in `script/check-route-coverage.ts`).
- The TUI packaging check is `bun run smoke:tui` / `bun run smoke:standalone`, not `--version` or `--help`.
- The unit-suite baseline observed 2026-08-16 is one source-reading failure: `test/tui/profile-command.test.ts` still looks for `systemPrompt.profile()` in `session/prompt.ts` after S3 moved that block into `InstructionSync`. `EditTool` passed in isolation. Do not treat that leftover assertion as a missing profile feature.
- Prefer Effect v4 APIs already in the tree (`Schema.optionalKey`, `Schema.TaggedErrorClass`, `Effect.fn`, `HttpApiMiddleware`) over new wrappers. Verify against `.opencode/references/effect-smol` when adding Effect-specific code.
