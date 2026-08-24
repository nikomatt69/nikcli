# Roadmap

Orders verified work by value and dependency.

Last reconciled against the source: **2026-08-24**. H4 / H5 / H1 / H6 / I1 / X2 / H7 / H3 / C1 are done. E4 is complete under its corrected scope: the remaining `jsonSafe` calls protect deliberately open or live-function payloads and are not optional-key debt. E5 is closed: the session boundary maps declared errors from the typed channel only, and `catchDefect(asSessionError)` is gone. E5, P2 and H8 all closed on 2026-08-24. The near plan is empty; what remains (R1, T3, P3) is `Later` and still waiting on the coverage or characterization each names. Historical verification counts remain in the dated landing log; re-run checks rather than treating those counts as a current baseline.

This is the ordered plan. Each item says what it buys, what proves it is needed, what it depends on, and how you know it is done. Items are referenced by id from the specs (`S1`, `T2`, `H1`, …) so a document never has to restate the plan.

An item is only here if the evidence for it is in the repository today. Nothing on this list is speculative product work. User outcomes, adoption, distribution, cross-device parity, and commercial validation live separately in [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md); product priorities may promote an evidenced engineering item, but they do not weaken its acceptance criteria.

The previous plan closed one durability model, one HTTP surface, and one TUI package. Those **seams** now exist. The next plan deepens the HttpApi **module** — it is the **interface** every remaining adapter (TUI, SDK, mobile, standalone host) already crosses — and finishes the Effect v4 runtime that still sits behind ALS and `Effect.promise`. A shallow field on that interface (`Schema.Unknown` → generated `any`, a path spelled in four files, a present `undefined` that forces `JSON.parse(JSON.stringify)`) leaks to every caller.

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

The **E4 service-side slices landed** (2026-08-19): `Session.Info` and every `MessageV2` message and part schema are on `optionalKey` with their producers omitting the key, and `jsonSafe` is down to the payloads that keep it for reasons optionality cannot reach — the three `Schema.Unknown` SessionV2 entry shapes in `session.ts`, and the live-`fetch` records in `provider.ts` / `config.ts`. That unblocks the first PR, **H7**: 115 unvalidated `/mobile/*` bodies, which no longer need a second `jsonSafe` on encoded mobile responses.

| ID      | Horizon | Item                                                                      |
| ------- | ------- | ------------------------------------------------------------------------- |
| **C1**  | Done    | Release integrity: generated drift, blocking static checks, release gates |
| **E4**  | Done    | Encode optionals as absent keys — corrected scope complete                |
| **H7**  | Done    | JSON `/mobile/*` onto encoded handlers (landed 2026-08-20)                |
| **H3**  | Done    | Generate the exhaustive SDK namespaced compatibility view                 |
| **E5**  | Done    | Keep expected session failures on Effect's typed channel (2026-08-24)     |
| **H8**  | Done    | Auth declared with `HttpApiMiddleware` on the contract (2026-08-24)       |
| **S4r** | Done    | Import / teleport / run write through SessionV2                           |
| **P2**  | Done    | Request-path cuts: list SQL + hot-poll log policy; URL carry-through cut  |
| **R1**  | Later   | Keyed scoped instance runtime after lifecycle coverage                    |
| **T3**  | Later   | Output codecs on structured built-ins                                     |
| **P3**  | Later   | Characterize, then optimize `normalizeMessages`                           |

### Release integrity (C1) — landed 2026-08-23

- **Buys** — A green release means reviewed generated clients are current, static checks passed, and a required deployment was not silently skipped.
- **Evidence** — `publish.yml` regenerated clients after the primary validation job, direct snapshot/manual publishes bypassed that job, formatting and lint were non-blocking in `script/ci-validate.ts`, and the Railway job exited successfully when `RAILWAY_TOKEN` was absent.
- **Implementation** — Validation regenerates the HttpApi clients and fails on tracked drift; formatting and lint are blocking. Direct publishes run the same central validation unless the `ci-pipeline` caller explicitly marks them prevalidated. A missing Railway credential fails the required deploy job.
- **Done when** — `ci-targeted.test.ts` pins all four invariants, a direct publish cannot reach `Publish` without validation, and the normal `live-main` path does not duplicate validation.

---

## Review landed work

State the wins, so nobody re-plans them:

- **One database.** `nikcli.db` with a journaled TypeScript migration chain, WAL, `foreign_keys=ON`, `mmap_size=0`. `bun:sqlite` is opened in exactly one place. Sessions, messages, parts, todos, permissions, and sync events are SQL. See [storage/nikcli-sql-drizzle-adoption.md](./storage/nikcli-sql-drizzle-adoption.md).
- **One HTTP surface.** Effect `HttpApi` endpoints; Hono and the experimental flag are gone from `src`. Clients are generated from the contract by `packages/httpapi-codegen`.
- **Generated namespaced SDK view** (H3, landed 2026-08-23). `PublicClientCompat` beside `PublicApi` declares all 336 Promise endpoints exactly once, including the 40 endpoints the hand-maintained view had omitted. `emitPromiseCompat` rejects missing, unknown, duplicate, colliding, or adapter-incompatible entries and emits `packages/sdk/js/src/httpapi/generated/compat.ts`; the small manual wrapper retains request selection and `{ data, error }` behavior. Client generation now fails before a declared group can disappear from `createNikcliClient`, and C1 blocks generated drift in CI.
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
- **One dispatcher, generated allowlist, typed write inputs** (H4 / H5 / H1, landed 2026-08-17; H6 / I1 / X2 2026-08-18). `PublicHttpApi.layer` composes the per-group `HandlersLive`; `implementedRoutes` derives from `OpenApi.fromApi(PublicApi)`; `check:routes --strict` is honored; the six TUI payloads and connector auth are real schemas, so `payload: unknown` in the generated SDK types is **0**. Codegen keeps `unknown` as `unknown` and emits each struct payload once. `packages/util/src/identifier.ts` and six caller-less adapters are deleted. The per-item detail is in the dated log below; do not re-plan from it.

---

## Reconciled completed scope

### Encode optionals as absent keys (E4)

**The original framing was wrong. Measured 2026-08-18 by deleting the helper and running the
route tests; corrected below before anyone repeats it.**

- **Buys** — The remaining `jsonSafe` handlers (`session.ts`, `provider.ts`, `config.ts`) stop doing `JSON.parse(JSON.stringify(...))` before HttpApi encodes.
- **Evidence** — `Schema.optional` is `optionalKey(UndefinedOr(self))` (`node_modules/effect/src/Schema.ts:2022`), so `undefined` is a valid _union member_ — and the HTTP encode path serializes that member as **`null`**. `jsonSafe` is what turns a present `undefined` into an _absent key_; it is load-bearing, not the defensive placeholder its own comment claims. Deleting it while the schemas stay `Schema.optional` produces:
  - `POST /session/:id/unrevert` → `revert: null` instead of absent (fails `httpapi-session.test.ts:270`)
  - `GET /session/:id/context` → `model: null`
  - `GET /config` → **400** (`httpapi-config.test.ts:113`, the test written for exactly this)

  Flipping those response schemas to `optionalKey` instead does not work on its own either: `optionalKey` _rejects_ a present `undefined` at encode time, and the producers emit one — `session/context-breakdown.ts:362` (`detail: firstLine ? … : undefined`) and `:418` (`model`), and `delegation/manager.ts` `projectJob`, which assigns all ten optional `JobItem` members unconditionally.

  **A schema-level probe lies about this.** `Schema.encodeUnknownEffect` returns the JS object with the present-`undefined` own property still attached, and the `Result`'s `toJSON` renders it through `JSON.stringify`, which drops it — so the probe prints `{"a":"x"}` and reads as "key dropped". (The success field is `.success`, not `.value`.) Only a real request through `Server.fetch` shows the `null`. Verify this class of change end to end, never with a probe.

- **Depends on** — nothing, but it is **not** the small item it looked like. It is producer-by-producer: each response schema flips to `optionalKey` **and** its producer stops writing present-`undefined`, together, per endpoint. **Scope closed 2026-08-19 (fifth slice).** `httpapi/session.ts` is down to three `jsonSafe` call sites — `v2Entries`, `v2State`, `v2Events` — the `Schema.Unknown` payloads that keep it permanently. The `provider.ts` and `config.ts` calls that remain are the live-`fetch` records, not optionality; both carry a comment saying so, and removing them is a different item.
- **How to do a slice** — The compiler will not help: `exactOptionalPropertyTypes` is off, so `field?: X` still accepts `undefined` and every producer bug is a runtime 400. Flip the schema, then grep the producers three ways — `draft.<field> = undefined`, an object literal that assigns an optional member unconditionally, and any value typed `T | null` handed to a `string` member (`null` fails `optionalKey` exactly like a present `undefined`, and that is what broke `sessionWarp`'s detach path). Use `setOptional` from `@/util/optional-key`, or `...(v !== undefined && { k: v })` in a literal. Then run the **whole** suite, not the route test: the three producers this slice missed were caught by `httpapi-workspace.test.ts` and `workspace-warp-route.test.ts`, not by the session tests.
- **`MessageV2` was the last slice, and it was smaller than it looked. Landed 2026-08-19.** 53 `Schema.optional` across the message and part schemas, and 144 part literals across 19 files — but the Effect encoder only ever sees them on **four** handlers (`messages`, `message`, `command`, `shell`), and three of those read rows that were round-tripped through `JSON.stringify` on write, so they cannot carry a present `undefined`. **Corrected 2026-08-19:** an earlier draft of this bullet claimed a part that fails to encode inside an SSE frame is silently withheld. It is not. SSE is a raw streaming response — `EventFeed.frame()` is `JSON.stringify`, which drops present-`undefined` and never consults the schema, and its one failure path already logs (`event encoding failed`). The streaming producers are not on the encode path at all; `command` and `shell`, which return freshly built messages, are.
- **The config 400 was one unconditional key, not the converter.** Measured 2026-08-19 with the encode-failure log from the first slice: `config.ts`'s agent transform returned `{ ...agent, options, permission, steps }` where `steps = agent.steps ?? agent.maxSteps`, so every agent that declares neither carried a present `undefined`. `Schema.Unknown` at the JSON boundary is `Schema.Json`, which walks the value and rejects it — hence a 400 rather than a `null`. Spreading the key fixed `GET /config` with no schema change at all. `util/zod-effect.ts:165` still decides optionality for the whole `nikcli.json` document in one place, but it did not have to move, and it should not move without its own evidence.
- **`/provider` and `/config/providers` keep `jsonSafe` for a different reason entirely.** Not optionality: a provider whose credential comes from the account sign-in carries a live `fetch` **function** in `options` (`provider/provider.ts` ~539), and `options` is `Schema.Record(String, Unknown)`, which rejects a function at the JSON boundary. The round-trip launders it out. Removing it there needs the function to stop living in a schema-declared record — a different item, and one no unit test would have caught: the test catalog is empty, so this only appears against real models.dev data.
- **`jsonSafe` cannot leave `session.ts` entirely.** `v2Entries` / `v2State` / `v2Events` declare `Schema.Unknown` on purpose (the entry variant set grows without a contract bump — see non-goals), and `Schema.Unknown` rejects a present `undefined` regardless of what the producers do. Those three keep the round-trip until entries stop carrying `undefined`, which is a different item. Amend "Done when" accordingly: the target is `session.ts` down to the `Unknown` payloads, not zero.
- **Costs if skipped** — Nothing user-visible. `jsonSafe` produces the correct wire shape today; this is a cost and clarity item, not a bug.
- **Done when** — Per endpoint: the response schema uses `optionalKey`, the producer omits the key, and a route test asserts the key is _absent_ (not `null`) with a service object that leaves the field unset. `session.ts` keeps `jsonSafe` only for the three deliberately open SessionV2 payloads; `provider.ts` and `config.ts` keep it only where live `fetch` functions must be removed before JSON encoding. Curl `GET /session`, `GET /session/:id`, `GET /config`, and `GET /provider` against real data with unset optionals. These criteria were met on 2026-08-19.
- **Already paid for** — The two live 400s this same failure mode was causing are fixed (see 2026-08-18 landed work): `mission.ts` `featureMutate` and `config/tui.ts` `plugin_meta`. Grep for `= undefined` on a field whose response schema is `optionalKey` before adding one.

## Active and queued structure

These are evidenced leftovers, not product ideas. `Now` items are independent and may proceed in order; `Next` items follow their stated dependency or measurement gate; `Later` items stay deferred until their lifecycle or characterization coverage exists.

### Execute next

- **Order** — Nothing is queued. E5, P2 and H8 landed on 2026-08-24; the three `Later` items below each state the coverage they wait on.
- **H8.1 — Put auth on the contract.** Landed 2026-08-24; see the dated log.
- **P2.1 — Push list work into SQL.** Landed 2026-08-24, measured below. P2.2 is now unblocked, but it is a separate decision: read the measurement before scheduling it.
- **P2.2 — Decided 2026-08-24 against the measurement.** The logging policy landed; the parsed-URL carry-through is **rejected** and the benches are **not scheduled**. Reasoning and numbers in the dated log below.

### Typed Effect failure channel (E5) — landed 2026-08-24

- **Buys** — Expected 404/409 cannot arrive as defects. Handlers stop compensating for untyped Promise adapters with `catchDefect`.
- **Evidence** — `httpapi/session.ts` applied `Effect.catchDefect(asSessionError)` after mapping the typed failure channel, `SessionRevert.Interface` and the route-facing `SessionSummary` methods exposed `unknown`, and both modules used the untyped `Effect.tryPromise(() => ...)` form, so `Effect.tryPromise` wrapped `SessionNotFoundError` in `UnknownError` and missing-session revert and diff answered 500. `Session.BusyError` was already a `Schema.TaggedErrorClass`, so the contract vocabulary existed.
- **Implementation** — E5.2 / E5.3 landed in `ff061973ec`: `Session.asSessionError` is exported, `SessionRevert.Interface` and `SessionSummary.summarize` / `diff` carry `Session.Error`, and the domain-rejecting handler bridges (`MessageV2.get` ×2, `SessionContext.breakdown` ×2, `SessionV2.entries`, `Monitor.get` / `readLog` / `cancel`) use `Effect.tryPromise({ catch: Session.asSessionError })`. `computeDiff` keeps `unknown` — it is real dependency I/O. E5.1 / E5.4 closed it: `declaredErrors` is a single `Effect.catch(asSessionError)`, and the `background` handler dropped its defect arm. The ten remaining `Effect.promise` sites are the audited unknown-I/O set — `Array.fromAsync`, the two session-delete cancels, the `collectSystemPaths` import and call, and the four `Delegation` job routes — and stay on `orDie`. The one `catchDefect` left in the file is the best-effort MCP toggle log, which swallows both channels on purpose and is not part of this boundary.

  **Caveat for the next reader.** `SessionPrompt.assertNotBusy` is still declared `Effect.Effect<void>` and raises by `throw` inside `Effect.gen`. It reaches callers typed only because `SessionRevert` runs it through `runPromiseWithLayer` and re-maps the rejection with `Session.asSessionError`; the busy assertion below pins that behavior. Narrowing that signature to `Session.BusyError` with an explicit `Effect.fail` is a separate cleanup, not a reopening of E5.

  **Corrected 2026-08-18 for `loop.ts` / `mission.ts`.** Both already carry the typed channel: declared 404/400 schemas plus `failNotFound` / `failValidation`, and their managers use the return-`undefined` convention the handlers already check. The `fromPromise` `orDie` wraps genuine I/O, not domain errors. There are no `Engine.LoopNotFoundError` / `MissionNotFoundError` / `MissionAlreadyExistsError` tags to fail with — an earlier draft of this item invented them. The one real gap there is fixed (see landed work).

- **Depends on** — nothing. H4 landed, so there was already one boundary to fix. H8 waited for this typed vocabulary and no longer does.
- **Done when** — Met. Domain methods map `Session.Error` on the typed channel; return-`undefined` plus an explicit `Effect.fail` remains valid for loop/mission. Session handlers map schema-declared errors without `catchDefect`, and `Effect.promise` / `orDie` remains only for genuinely unknown I/O. The service-level assertions in `test/session/session-lifecycle.test.ts` assert `Cause.hasDies === false` before squashing, so they separate `Effect.fail` from `Effect.die` instead of reading through both; route tests separately pin the unchanged 404/409 wire bodies.

### Request-path cuts (P2)

- **Buys** — Encoded JSON requests stop paying for work the contract already did. Hot polls (`/event`, `/session/status`, TUI) stop dominating logs and extra SQL.
- **Evidence** — Three of the five original items landed 2026-08-17 (`disableLogger`, `COUNT(*)`, the `sessionForRequest` short-circuit). What is left, measured 2026-08-19:
  - ~~`GET /session` calls `SessionRepo.list` → `Array.fromAsync` over **every** session of the project, then filters directory / roots / start / search in JS, sorts, and slices the limit.~~ **Fixed 2026-08-24 (P2.1).** `SessionRepo.query` applies every filter, the ordering, and the limit in SQL; `Session.Service.query` converts the directory to its comparison key; the route delegates.
  - ~~`ServerRouter.make` already parses one `URL` and passes it into `dispatch` / `context`, but downstream public, bridge, fallback, auth, and mobile raw paths still reparse `request.url`.~~ **Measured and rejected 2026-08-24.** The reparses are real but cost 0.03% of a request; see the dated log.
  - ~~`server-router.ts:269` / `:283` log start and completion for every request except `/log`; hot polls (`/event`, `/session/status`) dominate the log with no sampling or duration gate.~~ **Fixed 2026-08-24.** `logCompletion` gates the hot paths on status and duration.
- **Depends on** — nothing. Start with session-list SQL and measure it before queueing the rest. Do not rebuild the HttpApi layer per request — it is already memoized.
- **Done when** — Met 2026-08-24, with one leg answered rather than built. Session list limit/filter/search/order is SQL with directory comparison semantics preserved. `/event` and `/session/status` use a deterministic duration-and-status policy that never hides failures. The parsed-URL carry-through and the request-path benches were measured and closed as not worth their cost — P2 is done.

### `HttpApiMiddleware` on encoded groups (H8) — landed 2026-08-24

- **Buys** — Auth is a property of the declaration: an endpoint added to a protected group is authenticated by construction, and OpenAPI says which credential schemes the server accepts.
- **Evidence** — effect-smol `HttpApiMiddleware` is for authentication, authorization, logging, tracing, rate limiting, request-scoped services, and schema-error handling; `packages/nikcli/src` has no import of it. Normal router dispatch authenticates once and passes `upstreamAuthVerified`, so double authentication is not the active bug. The gap is that security remains outside the contract, direct bridge callers need an imperative guard, and OpenAPI cannot describe the scheme.
- **Depends on** — E5 (typed errors, or middleware has nothing typed to map); H4 landed. `/user` and `/account` stay ahead of the router until their `{ error }` union can be discriminated (`global-handlers.ts`).
- **Done when** — Met. Protected encoded groups declare security middleware while public operations remain unannotated (328 secured, 10 open, pinned by `test/server/httpapi-security.test.ts`). A remembered principal prevents re-authentication; a direct encoded bridge call with no principal authenticates in the middleware; no-password open mode and Tailscale are untouched because `Auth.authenticate` is still the only implementation. SSE / prompt / upgrade stay outside it (non-goal). OpenAPI declares `bearerAuth`, `auth_token` and `basicAuth`.

  **The middleware is not the only enforcement, and the spec should not pretend otherwise.** It can guard only what the contract describes: an unmatched path has no endpoint and therefore no middleware, so the router's and bridge's imperative checks stay as the catch-all. What changed is that protection now travels with the declaration and is visible in the generated OpenAPI, instead of depending on a route being reached through the right dispatcher.

### Keyed scoped instance runtime (R1)

- **Buys** — One instance key. Fibers see `InstanceRef` without falling back to ALS. `withInstanceAsync({ init })` can die.
- **Evidence** — `project/instance.ts` still caches `Map<string, Promise<Context>>` through `util/context.ts` ALS, while `workspace-context.ts` consumes the same ambient context. The migration surface is broader than those imports: `Instance.provide`, `withInstanceAsync({ init })`, promise-cache invalidation, `InstanceState.context`'s ALS fallback, and bootstrap ownership must move together. See [research-effect-di.md](./research-effect-di.md).
- **Depends on** — nothing; H4 landed, so HTTP is not also the ALS guinea pig. Two production importers remain: `project/instance.ts:2` and `workspace/workspace-context.ts:1` (verified 2026-08-19).
- **Done when** — Lifecycle tests first pin concurrent acquisition, invalidation, bootstrap failure, and disposal. Then a per-directory `ManagedRuntime` / `ScopedCache` owns bootstrap; `Instance.provide` is gone or a thin test helper, `withInstanceAsync` has no `init` path, `InstanceState.context` does not catch into ALS, and `util/context.ts` has no production importers.

### Output codecs on structured built-ins (T3)

- **Buys** — Code Mode and any machine consumer get a validated `value` from tools that already return JSON in `output`.
- **Evidence** — T2 landed the wrapper; built-ins are not required to use it ([v2/tools.md](./v2/tools.md)). No built-in in `src/tool/*.ts` declares an `output` codec. `browser-control` and `todo` already `JSON.stringify` structured results into the model-facing string.
- **Depends on** — nothing. Later because T2 called this additive; do not add a CI rule that every tool must have a codec.
- **Done when** — Tools that already emit JSON declare a codec and return `value`. Model-facing `output` stays a string. A malformed `value` fails that call only. Tools that emit prose are unchanged.

### Import / teleport / run write through SessionV2 (S4 remainder) — landed 2026-08-23

- **Buys** — One conversation write. A share import or teleport cannot commit v1 rows the entry table cannot represent.
- **Evidence** — S4 inverted HTTP create/prompt ([v2/session-v2-write-path.md](./v2/session-v2-write-path.md)). Three callers still wrote `MessageRepo` first and then `SessionEntryProjection.rebuild`: `cli/cmd/run.ts`, `cli/cmd/import.ts`, `server/mobile/teleport.ts`.
- **Implementation** — Those three callers persist each imported message through `SessionV2Write.persist`. Session create stays `Session.create` / `SessionRepo.upsert`. `rebuild` after a direct `MessageRepo` write is gone from production; tests may still call it. Token coalescing in `SessionProcessor.updatePartCoalesced` may still publish ahead of the projector — that path is documented and is not this item.
- **Done when** — Those three callers persist through `SessionV2` / `SessionV2Write.persist`. `rebuild` after a direct `MessageRepo` write is gone from production. Do not delete `SessionV2Write` or `SessionEntryProjection` as part of this; they earn their keep. `SessionV2.prompt` / `admit` / `loop` / `create` remaining as thin wrappers over `SessionPrompt` / `Session.createNext` is a later naming cleanup, not this item.

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
- ~~E4 service-side: `Session.Info` / `MessageV2.Info` schemas still use `Schema.optional`.~~ **Done 2026-08-19** — both flipped across the five service-side slices; `session.ts` keeps `jsonSafe` only on the three `Schema.Unknown` entry payloads.
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
- H7 / E5 / H8 / H3 / R1 / T3 / P3.

### 2026-08-18 (later) — E4 correction / E5 slice / session-model inheritance / route-table repairs

**Phase 1 — E4 is not what it looked like.**

- Executing the written E4 (delete `jsonSafe`, leave the schemas) turned three route tests red and was reverted. The plan section above now carries the measurement instead of the assumption. `jsonSafe` stays in `session.ts` / `provider.ts` / `config.ts`.
- The failure mode it predicts is real and was already shipping as two 400s, both fixed here (Phase 4).

**Phase 2 — E5 slice: `Manager.upsert` throw → declared 400.**

- `sanitizeDefinition` runs `safeParse` **then** `validateDefinition`; the handlers re-ran only the second, so a body that satisfied the route payload schema could still make `upsert` throw → `fromPromise`/`orDie` → 500, on routes that already declare a 400.
- `loop.ts` / `mission.ts` — new `upsertDefinition` maps that throw onto the declared `ValidationError`. New `test/server/httpapi-loop.test.ts` pins it: on the previous commit the route answers `500`, now `400`. Mission's create already zod-parses in the handler, so the helper is defensive there (`featureMutate` does not) — no test was added that would pass either way.
- The rest of `loop.ts` / `mission.ts` was left alone: see the E5 correction above.

**Phase 3 — mission / loop / brain run on the launching session's model.**

- New `src/session/model.ts` — `sessionModelOwn` (persisted `lastModel` column → message stream → `undefined`), `sessionModel` (same + global default), `sessionModelRef` (`"providerID/modelID"`). `tool/plan.ts`'s private `getLastModel` was the original of this logic and now imports it.
- Execution already inherited (`Engine.runOnce` / `Engine.start` take `callerSessionID`). The gap was _generation_: `{loop,mission}/generate.ts` created a throwaway session with no parent and no model, so drafting a mission from a description ran on the global default. `sessionID` now threads through the httpapi and `/mobile/*` payloads, the TUI dialogs (`api.route.current`), and `Brain.trigger` → `getBrainProviderModel(sessionID)`.
- The model is passed as an **explicit** `model`, not left to the inheritance chain: `prepareUserMessage` resolves `input.model ?? agent.model ?? inheritedModel(...)`, so an agent with a configured model would otherwise outrank the session. For the same reason `sessionModelOwn` returns `undefined` rather than the global default.
- Verified against real data: the drafting session now records `minimax-coding-plan/MiniMax-M3` with its parent set, where the previous runs recorded `openrouter/google/gemini-3-pro-image-preview` (an image model — hence "No endpoints found that support tool use").

**Phase 4 — seven pre-existing bugs, found by making the suite green.**

- `config/tui.ts:228` wrote `plugin_meta = undefined` against an `optionalKey` response schema: `GET /tui/config` answered an **empty 400 for every user with no plugins**, and the TUI read that as an empty config (no keybinds) with nothing logged.
- `mission.ts` `featureMutate` wrote `next.error = undefined` the same way: `POST /mission/:id/feature/:id` answered **400** on `status: "done"`.
- `mission.start` / `loop.run` declared a bare payload while their handlers read `payload?.` — a bodyless POST failed the request decode with a 400 before the handler could answer 404. Now `[HttpApiSchema.NoContent, …]`, as `session.create` already did.
- `bridge.ts` `globalRoutes` filtered `/^\/(global|user)\//` against `pattern.source`, which begins `^\/…` — it never matched, so the list had silently collapsed to the three hand-rolled `/account` entries and `/user/*` sat in the instance table instead of the instance-less branch. Filtering happens on the OpenAPI path now.
- `POST /chatbot/:platform/:bot` was missing from the table (contract only describes `/chatbot/bots*`); the pattern is built from `ChatbotHttp.PLATFORMS` so an unknown platform stays unsupported exactly as the handler rejects it.
- `GET /pty/:id/connect` (a WebSocket upgrade, contract-only for the OpenAPI) was _in_ the table.
- Trailing slash was lost when the hand-written table (`/^\/mission\/?$/`, `/^\/doctor\/?$/`) became OpenAPI-derived; `supports` retries without it, raw path first so the `/mobile/` prefix entries are untouched.

**Phase 5 — deleted `httpapi/errors.ts`.**

- `notFound` / `badRequest` / `conflict` / `asHttpBody` (the `__http` marker helpers) had no production importer in their lifetime — only `test/server/httpapi-errors.test.ts`, deleted with them. Its docstring described the per-route `catchTag` design E5 wants, but its wire literal is `{ name: "NotFound" }` while `session.ts` declares `"NotFoundError"`, so one shared helper could not have served both groups without changing the public error body. Each group already carries its own typed helpers against its own declared literal (`failNotFound` / `failValidation` in loop and mission, `asSessionError` in session); E5 continues from those, not from a fourth vocabulary.

**Test-suite repairs.**

- `test/tool/edit.test.ts` never set `NIKCLI_TEST_HOME`, so it ran against the developer's real `~/.local/share/nikcli/nikcli.db` while a live nikcli held it open — an intermittent `SQLITE_IOERR_VNODE` from `fromDirectoryImpl`. It has its own home now.
- `database.test.ts` journal list was missing `20260816000000_session_last_model`.
- `profile-command.test.ts` asserted `systemPrompt.profile()` in `session/prompt.ts`; that assembly moved to `session/instruction-sync.ts` (the feature is intact) and the test now pins it there.
- **Verify with `bun run test`, not bare `bun test`.** The script is `--timeout 30000` with `**/*benchmark*.test.ts` and `**/*integration*.test.ts` ignored. Bare `bun test` uses bun's 5s default and pulls the benchmarks in, manufacturing a _rotating_ set of 5-7 failures per run (provider/brain layer boot, and benchmarks asserting relative timings — one failed by 3%). Also capture `$?` immediately: `bun test > log; echo $?; grep …` inside one command reports grep's status, which hides both a failing suite and a failing typecheck.
- Result: `bun run test` 3820 pass / 0 fail; `bun run typecheck` clean.

### 2026-08-19 — E4 first service-side slice (`Session.Info`) + encode-failure logging

**Phase 1 — `Session.InfoSchema` on `optionalKey`.**

- `session/index.ts` — all 35 `Schema.optional` in `WorktreeInfoSchema`, `GithubInfoSchema`, `MobileInfoSchema` and `InfoSchema` are `Schema.optionalKey`. `createNextImpl` spreads its optional members in only when they have a value instead of assigning all eight unconditionally, and unshare does `delete draft.share`.
- Producers that wrote a present `undefined`: `revert.ts` (three `draft.revert = undefined`, the `partID` in the constructed revert, and `snapshot` — `Snapshot.track()` returns `string | undefined`), `workspace/index.ts` (two `workspaceID` writes), `prompt.ts` / `prompt-commands.ts` / `tool/goal.ts` (`activeCommand`, which is `undefined` on the goal-finished path), `server/mobile/session-lifecycle.ts` (`publishError`).
- New `src/util/optional-key.ts` — `setOptional(target, key, value)` deletes on `undefined`. It carries the explanation of why this class of bug is invisible to `bun run typecheck`.
- `httpapi/session.ts` — the ten handlers returning `Session.Info` (list, create, update, fork, revert, unrevert, share, unshare, get, children) return the service object directly. `jsonSafe` stays for `MessageV2.Info` and the SessionV2 shapes; its comment says so.
- `test/server/httpapi-session.test.ts` — new case asserts the twelve unset optionals are **absent** on create / get / list / update, and that a child session carries only `parentID`. `toBeUndefined()` would have passed on `null`; `not.toHaveProperty` is the assertion that means something here.

**Phase 2 — `null` is not the same bug, and it bit.**

`sessionWarp` takes `workspaceID: string | null`, where `null` means detach. The old code spelled `?? undefined` and `jsonSafe` dropped the key; a naive `setOptional(draft, "workspaceID", workspaceID)` wrote `null`, which `optionalKey(Schema.String)` rejects exactly like a present `undefined` — `GET /session/:id` answered 400 for every warped session. Caught by `httpapi-workspace.test.ts` and `workspace-warp-route.test.ts`, not by the session suite.

**Phase 3 — an encode failure is no longer silent.**

Diagnosing phase 2 took two blind cycles because the 400 had an **empty body and produced no log at all**. Effect's `HttpMiddleware.logger` is what reports the cause, and P2 turned it off wholesale on 2026-08-17 (`disableLogger: true`) to stop the duplicate request line. `bridge.ts` now passes a `middleware: logFailures` that keeps the silence for successful requests and logs only the failure cause, verified to print `SchemaError: Expected string, got 12345` with the failing path. A declared 404 does not go through it — it is a handled response, not a failure — so this does not log routine not-founds.

**Verified.** `bun run test` 3821 pass / 0 fail. `bun run typecheck` clean. `bun run generate:httpapi-clients` re-run and committed.

**Phase 4 — second slice: context breakdown + delegation jobs.**

- `session/context-breakdown.ts` — the two producers the plan named. A tool source wrote `detail: undefined` when the description's first line was empty, and the breakdown wrote `model: undefined` when no model is resolved. Both spread the key in instead.
- `delegation/manager.ts` — `projectJob` assigned all ten optional `JobItem` members unconditionally; they are spread in now. `resultSummary` and `error` became locals so the spread reads the same as the others.
- `httpapi/session.ts` — `contextBreakdown`, `contextToggle`, `delegation` and `backgroundInspect` return the service object directly. 14 `jsonSafe` calls remain.
- Coverage: `GET /session/:id/context` had **no route test at all**; there is one now, and `test/delegation-flow.test.ts` gained a `listJobs` / `inspectJob` case. Both were confirmed to fail against the un-fixed producer before being kept — a test that cannot fail is not coverage.

**Phase 5 — third slice: goal, monitor, pending.**

- `monitor/manager.ts` — `partID`, `timeoutMs`, `pid`, `exitCode`, `signal` and `time.completed` on `optionalKey`. `start` spread `timeoutMs` in instead of assigning it, and the exit handler used `setOptional` for `exitCode` / `signal` where it wrote `undefined` to clear them. `preview` and `bytes` keep `Schema.optional` — they carry a `withDecodingDefault` and are a different construct.
- `session/goal.ts` — `tokenBudget` on `optionalKey`; `setImpl` already spread it.
- `session/pending.ts` — the nine `PromptPayloadSchema` optionals on `optionalKey`. The part inputs nested under `parts` derive from `MessageV2` and stay until that slice.
- `httpapi/session.ts` — `goal`, `monitor`, `monitorLog`, `monitorCancel`, `pending` and `pendingSteer` return the service object directly.
- Coverage: none of these six routes had a test. The monitor one is a real regression catcher — verified to fail against the un-fixed `start`. The goal and pending ones are shape pins: their producers were already correct, so they would have passed before the flip too. Said plainly here because "added a test" and "added a test that could have caught it" are not the same claim.
- The pending test exercises the list route only. `POST .../pending/:id/steer` promotes the entry and starts a real prompt loop, which dies on model resolution in the test environment and surfaces as an unhandled error between tests.

### 2026-08-19 (later) — E4 fourth slice: config and provider

**The `GET /config` 400 was not what the plan said.** The first slice's encode-failure log named it in one run: `config.ts`'s agent transform wrote `steps: agent.steps ?? agent.maxSteps` unconditionally, so an agent declaring neither carried a present `undefined`, and `Schema.Unknown` at the JSON boundary is `Schema.Json`, which walks the value and rejects it. Spreading the key fixed the route with **no schema change** — `util/zod-effect.ts:165` never had to move. `test/server/httpapi-config.test.ts`'s existing "agent steps" case, written for exactly this and passing only because of `jsonSafe`, is now the regression guard: it fails against the un-fixed transform.

**`provider/schema.ts` on `optionalKey`** — `api.url`, `family`, `cost.experimentalOver200K`, `limit.input`, `variants`, `Info.key`. Seven producers in `provider.ts` stopped writing them unconditionally, via a new `spreadIf` next to `setOptional`.

**`/provider` and `/config/providers` keep `jsonSafe`, and the reason is not optionality.** A provider whose credential comes from the account sign-in puts a live `fetch` **function** into `options`, which is `Schema.Record(String, Unknown)`; the JSON boundary rejects a function and the route answers 400. The round-trip launders it out. Both routes carry a comment saying so. This is invisible to the unit suite — the test catalog is empty — and only appeared when the route was driven against real models.dev data.

`jsonSafe` is now gone from `GET /config` and `GET /provider/auth`.

**Verified.** `bun test --timeout 30000 test/server/httpapi-{config,provider,session}.test.ts test/provider` — 164 pass / 0 fail. All four routes driven against a real catalog answer 200. Not re-run: the full suite and typecheck.

### 2026-08-19 (last) — E4 fifth slice: `MessageV2` on `optionalKey`, and the `unknown` audit

**`MessageV2` flipped whole, and nothing broke.** All 53 `Schema.optional` across the message, part and error schemas are `Schema.optionalKey`; `grep -c 'Schema.optional('` on `session/message-v2.ts` is 0. The producers needed less work than the bullet feared, for the reason that bullet had already corrected: only four handlers (`messages`, `message`, `command`, `shell`) reach the Effect encoder, three of them read rows round-tripped through `JSON.stringify` on write, and the streaming path never consults the schema at all. `spreadIf` from `@/util/optional-key` covers the literals that assigned unconditionally.

**`jsonSafe` is down to what it can never leave.** `httpapi/session.ts` holds three call sites — `v2Entries`, `v2State`, `v2Events` — whose payloads are `Schema.Unknown`, i.e. `Schema.Json` at the boundary, which rejects a present `undefined` no matter what the producers do. `provider.ts` and `config.ts` keep theirs for the live-`fetch` record, not optionality. Both facts are now in the code comment next to the helper, which had gone stale twice over: it still claimed the context / goal / delegation / monitor shapes round-tripped (they stopped in the second and third slices) and still called `MessageV2` "the next slice".

**The `unknown` audit that rode along.** `src/util/json.ts` introduces `JsonValue` — the JSON value domain — so parse boundaries in `codemode`, `bus/bus-event.ts` and `tool-schema.ts` stop widening to `unknown`. `codemode/interpreter/model.ts` grew a `CodeModeValue` union for what a program can bind, and `tool-runtime.ts` a `CopiedOut` type for what `copyOut` actually yields (JSON data plus `ToolReference` and `undefined` holes — its old signature claimed `JsonValue`, which its own recursion violated). The three `unknown`s left on the TUI publish and control payloads are deliberate and now named in `specs/README.md` §Open payloads.

**Verified.** `bun test` on `packages/nikcli` 3982 pass / 7 skip / 0 fail; `bun run typecheck` 35/35 packages clean; `bun run check:routes --strict` ok at 338 contracts / 315 handlers / 23 raw. `bun run generate:httpapi-clients` was stale against the flipped schemas and its output is part of this change: 364 insertions in `httpapi/generated/types.ts`, all of it `?: X | undefined` collapsing to `?: X`, plus the numbered duplicates this section predicted (`MessageContextOverflowError1`, `APIError2`, `SubtaskPart1`) that will re-converge as the zod mirrors flip. Both `specs/README.md` leakage gates are unmoved: 10 top-level open aliases, 0 `payload: unknown`.

**The curl pass E4 asks for, done.** A real server on `127.0.0.1:47823`, a session with its optionals unset: `GET /config`, `GET /session`, `GET /session/:id`, `GET /session/:id/context`, `GET /session/:id/message` and `GET /provider` all answer 200 with **zero** `:null` occurrences across every body. The two cases this section named as the failure mode are clean: `POST /session/:id/unrevert` returns with `revert` **absent**, and the context sources omit `toggleKind` / `toggleKey` rather than nulling them. `POST /session/:id/shell` is the one that matters for this slice — it builds a fresh `MessageV2` with parts and puts it through the Effect encoder rather than reading a `JSON.stringify`-d row; it answers 200 with `summary`, `error`, `structured` and `snapshot` absent. A schema probe could not have shown any of this, which is why this section says to drive the route.

### 2026-08-20 — H7 (JSON `/mobile/*` onto encoded handlers)

**Every JSON `/mobile/*` endpoint is an encoded `.handle`; the dispatcher is down to the raw leftovers.**

- `server/mobile/*.ts` are now typed route functions returning plain data instead of `Request → Response` path matchers. `mobile-handlers.ts` wires each op through `fromPromise` (`Effect.promise` + `orDie`, for routes with no declared error) or `route` (`Effect.promise` + `catchDefect` → a declared `{ name, error }` body, discriminated by an `httpApiStatus` literal of 400/401/404). The response encoder validates every body that used to go through `Response.json` untouched.
- `dispatchMobileRequest` chains only the three leftovers: `events` (SSE), `session/…/stream` (SSE), and `teleport/upload/:id` (binary chunk). The contract-only `ptyConnect` upgrade stays `handleRaw` and still answers 404 (the dispatcher never served it). A drifted JSON schema now fails the request instead of shipping an undescribed body.
- Contract changes: `authTokenCreate` / `worktreeCreate` / `routineRun` / `routineTrigger` payloads are `[HttpApiSchema.NoContent, …]` (bodyless POST accepted, exactly as the old `body(schema.optional())` did); `sessionMessage` payload is now `SessionPending.PromptInput.omit({sessionID: true})` (gains `delivery` + `parentSessionID`, `parts` typed as `PromptParts.InputPart`); `sessionMessage` success is `{ accepted: true }` at **202**; `permissionRespond` `response` is the `"once"|"always"|"reject"` literal; `worktreeCreate` success is `Worktree.Info` (the contract declared `ManagedWorktree.Info` — a drift the raw path silently shipped); and every handler that answered a bare `{ error }` now declares the matching 400/401/404 schema.
- **Two real bugs surfaced by the move.** (1) Mission `create`/`update` relied on the zod `.default([])` on feature `dependsOn` (plus `models` / `status`) that only the old `body()` parse applied — the encoded decode skips zod defaults, so `validateDefinition` iterated an absent `dependsOn` and `POST /mobile/missions` 500'd. Handlers now normalize through `MissionDefinitionSchema.safeParse` before validating (mirroring `sanitizeDefinition`). (2) `gitStatus` returned `staged`/`unstaged`/`lastCommit` as `Record<string, unknown>` — an encode rejection waiting to happen. Now typed to the contract.
- `test/server/mobile-dispatcher.test.ts` was rewritten for the new dispatcher scope; the JSON routes are covered by the encoded router through `mobile-{session,loop,mission}-route` tests.

**Verified.** `bun run typecheck` clean in `packages/nikcli` and `packages/sdk`. `bun run check:routes --strict` ok at 338 contracts / 315 handlers / 23 raw. Mobile route tests 11 pass / 0 fail. `bun run generate:httpapi-clients` re-run and its output committed (sdk `types.ts` / `client.ts` + nikcli `client/`).

### 2026-08-20 — E5 (typed Effect failure channel on session handlers)

> **Status correction (2026-08-24): superseded, not current source.** This entry was written
> ahead of the tree: it was reopened on 2026-08-22 because the handlers still ran
> `Effect.catchDefect(asSessionError)`, and the `trySessionPromise` / `fromPromise` helpers it
> names were never added — the shipped form maps rejections inline with
> `Effect.tryPromise({ catch: Session.asSessionError })`. Read the 2026-08-24 entry below for
> what actually landed; keep this one only as the record of the intended design.

**404/409 are typed failures now, never defects.** `httpapi/session.ts`'s `declaredErrors` used `catch` + `catchDefect` because a handful of raw `Effect.promise` sites surfaced domain errors as defects; it is now a single `catch` over the typed channel.

- `httpapi/session.ts` gained two helpers next to `asSessionError`: `trySessionPromise` (a promise whose rejection is a declared `SessionError.NotFoundError` / `Session.BusyError`, left on the typed failure channel for `asSessionError`; anything else re-raised as a defect) and `fromPromise` (`Effect.promise` + `orDie`, for true unknown I/O). Domain-throwing sites (`MessageV2.get` ×2, `SessionContext.breakdown` ×2, `SessionV2.entries`, `Monitor.get/readLog/cancel` ×3) moved to `trySessionPromise`; I/O sites (`Array.fromAsync`, the abort cancels, `collectSystemPaths`, `Delegation.listJobs`) moved to `fromPromise`. `declaredErrors` dropped `catchDefect`.
- `session/index.ts` exported `Session.asSessionError` (unknown → `Session.Error`) so sibling services stop wrapping their rejects in `Cause.UnknownError`. `SessionRevert.revert/unrevert/cleanup` and `SessionSummary.summarize`/`diff` now use `Effect.tryPromise({ try, catch: Session.asSessionError })`; `SessionRevert`'s interface tightened `unknown` → `Session.Error`. `SessionPrompt` already preserved the typed error (`runInInstanceContext` returns it unchanged when it `instanceof Error`); `Todo.getImpl` returns `[]` (never a session-domain throw); `PermissionNext.reply` only `Bus.publish`es.
- `test/server/httpapi-session.test.ts` gained two 404 cases — `POST /session/:id/revert` and `GET /session/:id/diff` for a missing session — that fail against the old `UnknownError` wrap.

**Verified.** `bun run typecheck` clean; `bun test test/server/httpapi-session.test.ts` 13 pass / 0 fail (a combined run with the mobile suite showed one environmental `models.dev` refresh timeout in the context-breakdown test, which passes in isolation).

### 2026-08-24 — E5 closed (E5.1 + E5.4) and roadmap reconciliation

**The session boundary is typed-channel only.** E5.2 / E5.3 had already landed in `ff061973ec` without the item being marked; this pass closed the two remaining halves and reconciled the plan with the tree.

- **Reconciliation first.** The item's headline evidence — "the 2026-08-23 baseline is red, missing-session revert and diff answer 500" — was stale: `bun test test/server/httpapi-session.test.ts` was already 13 pass / 0 fail. `asSessionError` was described as private at `session/index.ts:913`; it is exported at `:918`. `SessionRevert.Interface` and `SessionSummary.summarize` / `diff` already carried `Session.Error`, and no untyped `tryPromise(() => ...)` remained in either module. Those three claims were corrected before any code changed, because a stale red baseline sends the next reader hunting a defect that is not there.
- **E5.1 completed.** The existing three `Exit` / `Cause` assertions proved only that the squashed error was a `NotFoundError` — `Cause.squash` reads through both channels, so they could not tell a `fail` from a `die`. All three now assert `Cause.hasDies(exit.cause) === false` first. The busy half of the gate did not exist anywhere in `test/`: a fourth assertion seeds `PromptState.reserve(session.id)` and pins that a busy `SessionRevert.revert` fails with `Session.BusyError` on the typed channel, no defect.
- **E5.4 completed.** `declaredErrors` is `Effect.catch(asSessionError)`; the defect arm is gone, so a genuine defect stays a 500 instead of being laundered into a declared 404 / 409. The `background` handler dropped its `catchDefect(() => succeed(undefined))`, which could turn any defect into a fake `{ error: "Session not found" }`. The MCP-toggle `catchDefect` at `session.ts:1007` is deliberately untouched: it swallows both channels for a best-effort log and is not part of this boundary.
- **Audited, not converted.** The ten remaining `Effect.promise` sites are unknown I/O and keep `orDie`: `Array.fromAsync` in `list`, the two cancels in session delete, the `collectSystemPaths` dynamic import and call, and the four `Delegation` job routes.
- **Left standing on purpose.** `SessionPrompt.assertNotBusy` is still `Effect.Effect<void>` raising by `throw` inside `Effect.gen`. Busy reaches callers typed only because `SessionRevert` re-maps the rejection through `Session.asSessionError`; the new assertion pins that. Narrowing the signature is a separate cleanup.

**Verified.** `bun test test/server/httpapi-session.test.ts test/session/` 584 pass / 0 fail; `bun test test/server/` 185 pass / 0 fail; `bun run typecheck` clean. No HttpApi contract change, so no client regeneration.

### 2026-08-24 (later) — P2.1 (session list filters, ordering, and limit in SQL)

**`GET /session` stops reading the whole project to return twenty rows.** The route materialized every session of the project through `Array.fromAsync` — one `JSON.parse` of the `data` blob per stored row — then filtered directory / roots / start / search in JS, sorted, and sliced.

- **Two derived columns, because the JS predicates are not expressible in SQLite without changing their meaning.** `session_info.directory_key` stores `Filesystem.comparisonKey(directory)`: on Windows that is a JS `toLowerCase` of a resolved, forward-slashed path, so `WHERE directory = ?` would be a different predicate and `WHERE lower(directory) = ?` an ASCII-only approximation of it. `session_info.title_lower` stores `title.toLowerCase()`, because SQLite's `lower()` is ASCII-only and would silently drop non-ASCII search matches the JS filter accepts. `20260824000000_session_directory_key` adds both and backfills them with the same functions the write path uses, so runtime and backfill agree by construction. Neither column is read back into `Session.Info` or put on the wire.
- **Search uses `instr()`, not `LIKE`.** `LIKE` reads `%` and `_` in a user's search term as wildcards; `String.includes` does not. A route test pins that searching for `%` returns nothing.
- **`SessionRepo.query` + `Session.Service.query`.** The repository takes a comparison key; the service takes a directory path and converts it, so no caller can pass a raw path where a key is expected. `list()` stays — it is the "walk every session of this project" iterator other callers still want. Ordering is `updated_at DESC, created_at ASC`; the tiebreaker reproduces the old behavior, whose stable `Array.prototype.sort` over a created-ascending input kept created order on equal `updatedAt`.
- **Both hand-enumerated column lists updated.** `upsert`'s `onConflictDoUpdate.set` and `update`'s `.set` list columns one by one, so the derived pair had to be added to both — otherwise a rename would leave `title_lower` stale and the search filter would match the old title.
- **`EXPLAIN QUERY PLAN` chose the index shape.** A plain `(project_id, updated_at)` index gave `SEARCH … USING INDEX` plus `USE TEMP B-TREE FOR LAST TERM OF ORDER BY`. Declaring the index `(project_id, updated_at DESC, created_at ASC)` — matching the query's directions — reduces the plan to the bare `SEARCH`.

**Measured.** 2000 seeded sessions, `limit=20`, same request before and after: rows materialized 2000 → 20, elapsed 7.84 ms → 0.73 ms. The measurement harness was a throwaway; it is not in the tree.

**Verified.** `bun test test/server/ test/session/ test/database/` 792 pass / 1 fail, the failure being `httpapi-file.test.ts`'s ripgrep search under load, which passes alone — the documented load flake, unrelated to this change. `bun run typecheck` clean. No HttpApi contract change, so no client regeneration.

### 2026-08-24 (last) — P2.2 decided: log policy in, URL carry-through out

P2.2 was queued behind "only after P2.1 records its result". It did, so this is the decision rather than the implementation of all three legs.

**Rejected: carry the parsed URL into downstream dispatch.** Instrumented `globalThis.URL` around one warmed `GET /session` through `Server.fetch` and counted constructions by call site. A request builds **5** URLs — `server-router.ts:267`, `public.ts:29`, `public.ts:56`, `httpapi/auth.ts:162`, `extra.ts:78` — at 0.079 µs each: **0.39 µs against a 1.19 ms request, or 0.03%**. Threading a parsed URL through public, bridge, fallback, auth, and mobile dispatch would touch every file H8.1 is about to rewrite, for a saving three orders of magnitude below the noise. The reparses are real; they are not a cost. Do not re-propose this as a performance item — if it returns, it returns as a clarity argument, with a different justification.

**Not scheduled: the request-path benches.** A bench guards a budget. The measurement above says the encoded request path has no evidenced budget to guard, and P2.1's win came from SQL, not from the router. Left out rather than added as an unowned CI cost.

**Landed: the hot-poll logging policy.** `server-router.ts` logged a start and a completion line for every request except `/log`, so a connected client's polling accounted for most of the log. `logCompletion` now gates `/event` and `/session/status`: no start line, and a completion line only when the response is 4xx/5xx, when no response was produced (a thrown error), or when the request took at least 250 ms. It is a duration-and-status gate, not sampling — the same request logs the same way every time, so a reproduction never depends on which side of a sample it fell, and the policy can only ever suppress a _fast, successful_ poll. `test/server/router-log-policy.test.ts` pins all three: the quiet success, an ordinary route still logging both lines, and a failing hot path still logging.

**Verified.** `bun test test/server/` 190 pass / 0 fail; `bun run typecheck` clean. No contract change.

### 2026-08-24 (last) — H8.1: authentication on the HttpApi contract

**Security is now declared where the endpoint is declared.** `ServerRouter` and the bridge authenticated imperatively, so OpenAPI could not name a scheme and a new encoded group was protected only by being reached through the right dispatcher.

- **`httpapi/security.ts`** declares `bearerAuth` / `auth_token` / `basicAuth` and implements all three with one delegate to `Auth.authenticate`, reading the raw `Request` rather than the decoded credential. It has to: the server accepts combinations no single scheme describes — a Tailscale identity header, or open mode with no credential at all. `Auth.authenticate` remains the only implementation of the acceptance order.
- **The 401 is returned as a `Response`, not raised as a declared error.** Failing with an error schema would have JSON-encoded the body and dropped the `WWW-Authenticate` challenge. Returning it verbatim keeps the wire identical _and_ keeps the middleware's error union empty — which is why `bun run generate:httpapi-clients` produced **zero drift**.
- **Classification, which is the actual work.** 328 operations secured, 10 open. The 10 are exactly the paths reachable without credentials, from two different sources: `Auth.isPublicPath` (health probe, browser sign-in, account creation) and `PublicRoutes.publicRequest`, which answers the share routes _ahead_ of authentication entirely. `global` and `users` mix public and protected, so those two mark the protected endpoint at its definition site — a group-level sweep would have made the liveness probe advertise a scheme it does not enforce.
- **Where the middleware has to be provided, and why it is not obvious.** `HttpApiBuilder.group` captures `Effect.context()` when the group layer is built, and `applyMiddleware` resolves the middleware service out of _that_ captured context. Providing it only to `ApiLive` compiles and then fails every protected request at runtime with `Service not found: nikcli/HttpApiAuth`. It therefore goes to the merged handler layers in `public.ts`, and separately to `mobile-handlers.ts`, `sync.ts`, `global.ts` and `contract-extra.ts`, which build their groups against their own `Api`.

**Two regressions found and closed before they shipped:**

- **The imperative checks had to stay.** Removing them looked right — the middleware covers the encoded routes — but the middleware can only guard paths the contract describes. An unmatched path has no endpoint, so a password-protected server would have started answering 404 to unauthenticated callers where it previously answered 401. Both checks are back, and they now `Auth.remember` so the middleware does not authenticate a second time.
- **`WorkspaceServer` would have started rejecting everything.** It serves a workspace sandbox on its own `Bun.serve`, performs no authentication, and passes `upstreamAuthVerified: true`. With the middleware in place and nothing remembered, it would have authenticated those requests and failed every one on a server with `NIKCLI_SERVER_PASSWORD` set. `Auth.markUpstreamVerified` records that the question was already settled — a different statement from `remember`, which records _who_ the caller is. `test/server/httpapi-bridge-401.test.ts` pins it, and that assertion was confirmed to fail without the marker.

**Verified.** `bun test` full suite 4018 pass / 2 fail. Neither failure is this change: `httpapi-file.test.ts`'s ripgrep search is the documented load flake and passes alone, and `test/mcp/streamable-http-transport.test.ts`'s SSE-reconnect case fails identically on pristine `3c4819927f` in a clean worktree — it is a pre-existing failure, unrelated to the server auth path. `bun run check:routes` ok — 338 contracts, 315 handlers, 23 raw. `bun run generate:httpapi-clients` regenerated with no diff. Typecheck was not run in this session at the author's request; it is the one gate still outstanding.

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
