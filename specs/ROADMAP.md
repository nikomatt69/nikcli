# Roadmap

Orders verified work by value and dependency.

Last reconciled against the source: **2026-08-16** (second pass: H2 and E3c landed).

This is the ordered plan. Each item says what it buys, what proves it is needed, what it depends on, and how you know it is done. Items are referenced by id from the specs (`S1`, `T2`, `H1`, …) so a document never has to restate the plan.

An item is only here if the evidence for it is in the repository today. Nothing on this list is speculative product work.

The previous plan closed one durability model, one HTTP surface, and one TUI package. Those **seams** now exist. The next plan deepens the HttpApi **module** — it is the **interface** every remaining adapter (TUI, SDK, mobile, standalone host) already crosses. A shallow field on that interface (`Schema.Unknown` → generated `any`, a path spelled in four files, a hand-copied namespaced client) leaks to every caller.

---

## Read the plan

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| **Buys**      | The user-visible or operational improvement. If this is vague, drop the item. |
| **Evidence**  | The file and fact that makes the case. Verifiable now.                        |
| **Blocks**    | What cannot be done well before this lands.                                   |
| **Done when** | A check someone else can run.                                                 |

Horizons are ordering, not dates. An item moves up when its dependency lands, not when someone has time.

| ID      | Horizon  | Item                                                           |
| ------- | -------- | -------------------------------------------------------------- |
| **H1**  | Now      | Close unjustified `Schema.Unknown` on the HttpApi contract     |
| **H3**  | Later    | Generate the SDK namespaced view (`compat.ts`)                 |
| **I1**  | Later    | Reconcile Identifier (`util/id` vs `util/identifier`)          |
| **T3**  | Later    | Output codecs on structured built-ins                          |
| **H4**  | Later    | Close contract-only strangler leftovers                        |
| **S4r** | Later    | Import / teleport / run write through SessionV2                |
| **X2**  | Later    | Delete adapters with no production callers                     |

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

---

## Finish current work

### Close unjustified `Schema.Unknown` (H1)

- **Buys** — Generated clients stop seeing `any` on bodies the server already validates. Effect handlers start rejecting a malformed loop/mission/profile write instead of casting it. One definition per object, the rule `packages/nikcli/AGENTS.md` already states.
- **Evidence** — The contract is now the TUI/SDK/mobile **interface**. `Schema.Unknown` on `success` or a domain object compiles to `any` (`packages/sdk/js/src/httpapi/generated/types.ts`). Measured 2026-08-16:

  ```
  MobileProject = any
  SessionV2EntryList = Array<any>
  SessionV2State = any
  SessionV2EventList = Array<any>
  WorkspaceJournalEvent = any
  MobileGithubReposOutput = Array<any>
  MobileSessionStreamOutput = any
  SyncStreamOutput = any
  ShareShortOutput = any
  ```

  The last four plus the three SessionV2 names are the open-payload cases listed in [README.md](./README.md) (polymorphic entries, SSE frames, bodyless redirects). The rest already have a source the contract is not using:

  | Contract name                         | Source already in tree                                                                                              | What the handler does today                                  |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
  | `LoopCreateInput` / `LoopUpdateInput` | `Domain.LoopDefinition` in `httpapi/domain.ts`; zod `LoopDefinitionSchema` in `loop/schema.ts`                      | `payload as Omit<LoopDefinition, "id" \| "createdAt">`       |
  | `MissionCreateInput` / `Update`       | `MissionDefinitionSchema.omit({ id, createdAt, status })` already bound as `CreateInputZod` in `httpapi/mission.ts` | Contract is `Schema.Unknown`; zod parse is a side path       |
  | `MobileProject`                       | `Project.Info.extend({ current: z.boolean() })` in `server/mobile/helpers.ts`                                       | `httpapi/mobile.ts` annotates `Schema.Unknown`               |
  | `ProfilePatchInput`                   | `Profile.InfoSchema` / `Profile.Input` in `profile/profile.ts`                                                      | `Schema.Record(Schema.String, Schema.Unknown)`               |
  | Mobile config / parts / loop bodies   | `fromZod(Config.Info)` in `httpapi/config.ts`; `MessageV2.PartSchema`; `Domain.LoopDefinition`                      | Still `Schema.Unknown` / open records in `httpapi/mobile.ts` |

  Analytics already shows the intended shape: real Effect structs, with a comment that a drift fails the request. Loop/mission create is the opposite: the **interface** is open, so the **implementation** cannot enforce what it already knows.

- **Blocks** — Typed mobile/SDK callers; any new field on those objects; trusting the encoder on write routes.
- **Done when** — Both measure commands in [README.md](./README.md) §Open payloads list only the justified open payloads — the second one matters, because the headline `^export type … = any$` grep cannot see `MobileConfigInfo`'s open body or a `payload: unknown` write input, which are two of the targets in the table above (SSE, polymorphic `session_entry` / sync frames, bodyless redirects, genuine upstream passthrough). Loop and mission create/update reuse `Domain.*` (create = definition minus server-assigned fields). `MobileProject` is `fromZod` of the helper. Profile patch is the editable half of `Profile.InfoSchema`. Mobile payloads that already have a zod or Effect source reuse it. `bun run generate:httpapi-clients` and `bun run check:routes` pass. Land one group at a time; curl the write route against a real server — the encoder rejects `undefined` as empty data, not as an error.
- **Keep `Unknown`** — `SessionV2` entry/state/event lists (`SessionEntry.Entry` grows without a contract bump; that is the open-payload exception). SSE (`/event`, `/sync/stream`, mobile session stream). Share short-links. GitHub repo list: type the `imported*` wrapper fields; the upstream repo body may stay open. Do not pin `SessionEntry.Entry` through `fromZod` as part of this item.
- **Spec** — [README.md](./README.md) §Open payloads; `packages/nikcli/AGENTS.md` §Schema rules.

---

## Plan later structure

These are evidenced leftovers, not product ideas. They wait because a smaller item in current work already covers the same **seam**, or because the leftover is one adapter.

### Generate the SDK namespaced view (H3)

- **Buys** — Adding a declared HttpApi group cannot ship a client that typechecks and 404s at `api.client.<group>`.
- **Evidence** — `packages/sdk/js/src/httpapi/compat.ts` is "maintained by hand" (its own header). [tui-package.md](./tui-package.md) paid an hour for this: codegen produced the raw and Effect clients; `api.client.chatbot` did not exist until the group was added to the namespaced view by hand. The remapping (`app.agents` → `raw["top-level"].agent`) **is** the caller **interface**; deleting `compat.ts` would reappear as edits across the TUI.
- **Depends on** — H1 (do not generate `any` into the namespaced view).
- **Done when** — Codegen emits the namespaced view from a declared map next to `PublicApi`. Adding a group without updating that map fails `packages/sdk` typecheck. Existing call sites do not change names.

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

### Close the contract-only strangler leftovers (H4)

- **Buys** — One live dispatcher for JSON contract-only routes. `check:routes` cannot miss a served path. `/account` gets the same generation contract `/user` already has.
- **Evidence** — `PublicApi` adds eight contract-only groups. Live serving is a second pathname stack (`PublicRoutes` / `extra.ts` / `HttpApiPrompt`). `ContractExtraHttpApi.HandlersLive` is an Effect copy of those routes; the only importer of `contract-extra.ts` is `public.ts`, and it adds the groups, not `HandlersLive`. `SessionHttpApi.HandlersLive` is also unreferenced (`public.ts` re-lists the same `.handle` names). `/user/*` is on `UsersGroup`; `/account`, `/account/login`, and `/account/login/complete` are not on `PublicApi`. `GET /config/profiles` is served from `extra.ts` and is absent from `rawRouteImplementations` (the POSTs are listed).
- **Depends on** — nothing now that H2 landed: `/account` is already a root in `httpapi/instance-less.ts`, so putting it on `PublicApi` is a contract edit, not a routing one.
- **Done when** — `HandlersLive` in `contract-extra.ts` is deleted or is the single live adapter. `GET /config/profiles` is in `inventory.ts`. `/account` is on `PublicApi` the way `/user` is. `bun run check:routes --strict` is clean. SSE, prompt streaming, and websocket upgrades stay raw (see non-goals).

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
- **Promoting raw streaming / prompt / SSE / websocket routes into encoded Effect handlers.** `POST /session/:id/message` and `prompt_async` are raw because they open a chunked 200 or return 204 before the loop finishes (`httpapi/prompt.ts`). SSE and upgrades stay ahead of the router.
- **Desktop as a second TUI renderer.** [tui-package.md](./tui-package.md) §6: `packages/desktop` is a Tauri webview; the TUI renders through `@opentui/solid`. The packaging check is `nikcli-tui`, and it already exists.
- **Deleting leftover `storage/*.json` trees.** They stay on disk for downgrade. Runtime does not read them.
- **Mandatory tool output codecs.** T2 is opt-in. T3 adds codecs only where the tool already returns structured JSON.
- **Product work without a structural leftover** — single-binary distribution, provider cost envelopes, unifying mobile and voice upload, an active Brain planner, share v2, a workspace trust lattice. None of those have a file-and-fact case in the tree today.

## Follow working rules

- Commit at phase boundaries, not per file.
- Every commit that changes a contract updates its spec in the same commit.
- Verify with `bun test` unit tests and `bun run typecheck` (never a bare `tsc`; the repo's `.bin/tsc` is the JS 5.x one). Do not verify with the simulation harness.
- Adding a migration breaks `test/database/database.test.ts`'s journal assertion. That is expected; update it in the same commit.
- After an HttpApi contract change, run `bun run generate:httpapi-clients` from `packages/nikcli` and commit the generated output.
- The TUI packaging check is `bun run smoke:tui` / `bun run smoke:standalone`, not `--version` or `--help`.
- The unit-suite baseline observed 2026-08-16 is one source-reading failure: `test/tui/profile-command.test.ts` still looks for `systemPrompt.profile()` in `session/prompt.ts` after S3 moved that block into `InstructionSync`. `EditTool` passed in isolation. Do not treat that leftover assertion as a missing profile feature.
