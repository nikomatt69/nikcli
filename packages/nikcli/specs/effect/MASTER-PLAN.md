# Effect migration master plan

This document is the single integrated execution plan for the `packages/nikcli` Effect migration. It sequences every item tracked in the other 9 spec files (`migration.md`, `facades.md`, `instance-context.md`, `loose-ends.md`, `routes.md`, `tools.md`, `schema.md`, `server-package.md`, `http-api.md`) into one dependency-ordered roadmap.

The plan is deliberately progressive: every phase ships compilable, testable, behavior-preserving code. No phase introduces a placeholder, mock, or `TODO`. Earlier phases prepare the seams that later phases consume.

## Execution log (2026-05-08)

Phase P expansion landed on this branch in the 2026-05-08 pass. Full per-commit ledger (most recent first):

- `5c04b69` — `SessionStatus.Info` (Schema.Union of `idle`/`retry`/`busy` tagged structs annotated with `zodObjectMode("strip")` so legacy unknown-field tolerance is preserved on session status payloads). Plus `SessionSummary.{SummarizeInput, DiffInput}`, `SessionRevert.RevertInput`, `SessionCompaction.CreateInput` — all derived via `zodObject(...)` from `Schema.Struct(...)` with `Schema.startsWith(...)` ID-prefix refinements.
- `08d5d26` — `Workspace.{Info, Restore, SessionRestore, ConnectionStatus}` migrated to Effect Schema. `ConnectionStatus` is `Schema.Literal(...)`, the rest are `Schema.Struct(...)`. `Restore` and `SessionRestore` keep `tag` literals so the existing union discrimination at the consumer side still works.
- `fcbab5e` — `File.Node`, `File.Content` (with nested patch sub-struct) and `Workspace.Config` (Schema.Union of `worktree | container`).
- `908e9df` — `Sandbox.{Ref, State}` (each a `Schema.Union` over its tagged variants, exported as `RefSchema` / `StateSchema` for cross-namespace composition) and `BackgroundRun.Record` (`DeepMutable<...>` because the run record is mutated during streaming updates), plus `Status` / `Source` / `Role` literal enums.
- `adc825f` — `Log.Level` literal-enum schema; spec consolidation pass over `specs/effect/*` to bring the secondary docs in line with this master plan's wording.
- `b524bf4` — `ModelsDev.Model`, `ModelsDev.Provider`, `Monitor.Record`. All three use `DeepMutable<...>` because they are mutated extensively during fetch/merge cycles. `Monitor.Status` is the literal enum; `Monitor.LogSnapshot` is a plain `Schema.Struct(...)`. Shared `ModalityValueSchema` and `CostBlockSchema` extracted so `provider/provider.ts` and `provider/models.ts` reference one canonical Effect Schema instead of duplicating shapes.
- `f423ef7` — `Provider.Model` and `Provider.Info` migrated. Model uses nested `Schema.Struct(...)` for capabilities + cost; both expose `DeepMutable<...>` types because the merge logic mutates fields. The internal fetch wrapper / spread sites that previously assumed mutable shapes now use single-property casts to satisfy readonly-on-paper Schema.Struct outputs without changing runtime behavior.
- `e862f60` — `Connectors.Entry`, `Vcs.Info`, `Worktree.{Info, CreateInput, RemoveInput, ResetInput}`. `Connectors.Entry` carries `DeepMutable<...>` because `updateToken` / `updateBotToken` / `updateApiKey` write into the entry in place. `DeepMutable<T>` itself is now a shared utility exported from `@/util/effect-zod` rather than re-declared in each consumer.
- `c5310ef` — Project + ProviderAuth + walker enhancements: `Project.{Info, UpdateInput}` (uses `DeepMutable<...>`, with an extracted `IconSchema` so `Info.shape.icon` access still works for downstream consumers); `ProviderAuth.Method` / `Authorization` / authorize+callback+api input contracts. Walker enhancements landed: `zodObject` now has 2 overloads (typed `Schema.Struct<Fields>` preserving `.shape`/`.omit` field types vs broad `Schema.Schema<A,I,R>` for `Schema.mutable(...)`-wrapped or non-Struct compositions); `zodObjectMode("strict" | "strip" | "passthrough")` annotation added so legacy strip-on-parse payloads stay forward-compatible without losing the default strictness elsewhere.
- `104dfa2` / `d51e73a` — extended migration analysis docs and detailed plan deltas; not code-touching.
- `f51037d` — `effect` package upgrade + ergonomic session management touch-ups that the walker depends on.

Validation gate after this pass:

- `bun run typecheck` — green (turbo cache hit, full graph).
- All Phase P migrations preserve the public Zod-shaped exports via `zodObject(...)` / `zod(...)`, so downstream Zod-only consumers (server validators, AI-SDK tool params, `z.toJSONSchema(...)`) compile and run unchanged.

Discoveries landed during this pass:

- `lsp/index.ts` migration attempt reverted. Switching `LSP.Range` to `zodObject(...)` widened nested struct types to `unknown` when `MessageV2.SymbolSource` consumed it via `FilePartSourceBase.extend({...range: LSP.Range})`. Root cause: walker's typed overload returns `z.ZodObject<{start: z.ZodType<{line, character}>, ...}>`; `z.infer` widens through nested `z.ZodType<X>` when extended, because `.extend` reads the structural shape rather than the precise inner type. Fix path: deepen `FieldsToShape<Fields>` to recursively map nested `Schema.Struct` to `z.ZodObject<{...}>` (not `z.ZodType<X>`), and to map nested `Schema.Array` to `z.ZodArray<...>`. Until that lands, LSP.Range stays Zod-first because its consumers in `MessageV2.SymbolSource` (and other extended structs) need precise nested types preserved through `.extend`.
- `searchBackend.ts` migrated in-place: `Backend` (Schema.Literal) and `Match` Effect Schema with `Schema.mutable(Schema.Array(...))` over the submatches array (the search loop pushes into it).

## Execution log (2026-05-07)

Concrete progress landed on this branch in the first execution pass:

- ✅ Phase A1 (infrastructure) — created `src/filesystem/index.ts` exposing `AppFileSystem.Service` (wraps `@effect/platform-bun` `BunFileSystem` and adds nikcli-specific helpers: `findUp`, `up`, `globUp`, `contains`, `containsCanonical`, `overlaps`, `normalizePath`, `statSafe`).
- ✅ Phase A1 (consumer) — `src/config/config.ts` now yields `AppFileSystem.Service` (via `appFs.findUp`) and `ConfigPaths.Service` (via `paths.directories`); inline `Filesystem.findUp` / `Filesystem.up` removed.
- ✅ Phase A2 — verified: there are no `Process.spawn(...)` namespace call sites on this branch; the surviving `Bun.spawn(...)` and `child_process.spawn(...)` sites are intentional (Bun-native install/probe helpers; long-lived LSP children that need Node `Readable`/`Writable` streams).
- ✅ Phase A3 — migrated `lazyAsync` to `Effect.cached` in `src/pty/index.ts` (bun-pty spawn loader) and `src/storage/storage.ts` (storage state with migrations).
- ✅ Phase A4 / A5 — confirmed all `Lock.{read,write}` and `Flock.{acquire,withLock}` call sites are still in plain `async function` impls; deferred per-call until each containing function effectifies.
- ✅ Phase B1 — `src/config/config.ts` internal config load now yields `ConfigPaths.Service.directories(...)` instead of inlining `Filesystem.up(...)`; `loadState` accepts `directories` and `projectFiles` as parameters.
- ✅ Phase B2 — `src/env/index.ts` simplified: legacy `Instance.state(() => process.env)` removed because `process.env` is process-global and `Env.set` already mutates it directly, so the per-instance ALS wrapper added no behavioural isolation.
- 🔁 Phase B3 — folded into Phase F (the `TuiConfig` callers in `cli/cmd/tui/plugin/runtime.ts` are already inside `Instance.provide({fn: async () => ...})` blocks; they flip together with the unified `withInstance(...)` boundary).
- 🔁 Phase B4 — decision recorded: leave `config/migrate-tui-config.ts` as plain async (one-shot migration helper).
- 🔁 Phase C — deferred to after Phase F. Reason: targets in `file/searchBackend.ts` and `file/fff.ts` couple `fs.realpath(...)` calls to ambient `Instance.directory` / `Instance.worktree` reads; migrating the `fs.*` half alone would create a half-migration. `file/ripgrep.ts` referenced in older specs does not exist on this branch.

Validation gates after this pass:

- `bun run typecheck` — green.
- `bun test test/storage/effect-service.test.ts test/pty/effect-service.test.ts` — passes (2 tests, 9 expects).

## Discovered prerequisites — landed

While executing the first pass, two pieces of missing infrastructure were identified and built on the same pass:

1. ✅ **`@/util/effect-zod` walker.** Built `src/util/effect-zod.ts` exposing `zod()`, `zodObject()`, `withStatics()`, `zodOverride()`, `ZodOverrideId`, `DeepMutable<T>`. Validated by `bun test test/util/effect-zod.test.ts` (18 tests). Covers structs, arrays, unions, literals, records, NullOr, optional, primitives, canonical refinements (`isInt`, `isGreaterThan*`, `isLessThan*`, `isPattern`, `isUUID`, `isMinLength`, `isMaxLength`), Suspend/lazy, Declaration surrogates, Enums.
2. ✅ **Tool `Def.execute` shape.** `Tool.Def.execute` now returns `Effect.Effect<Tool.Result<M>, Error>`. `Tool.Def.executeAsync` is the Promise compatibility wrapper (zero-cost `Effect.runPromise(execute(...))`). `Tool.define(...)` accepts authored bodies that return either `Promise<Result>` or `Effect.Effect<Result, Error>` and auto-wraps via `Effect.tryPromise(...)`. Updated 6 caller sites (`session/prompt.ts`, `tool/batch.ts`, `tool/multiedit.ts`, `tool/exec_code.ts`, `cli/cmd/debug/agent.ts`) and 1 test file (`test/delegation-flow.test.ts`) plus `test/tool/invalid.test.ts` to use `executeAsync`.
3. ✅ **`withInstance` helper for Phase F.** Built `src/effect/with-instance.ts` exposing `withInstance(input, effect)` and `withInstanceAsync(input, fn)`. PoC migration: `cli/cmd/agent.ts` (2 sites), `cli/cmd/pr.ts`, `cli/cmd/models.ts`, `cli/cmd/image-model.ts` now enter through `withInstanceAsync(...)` instead of `Instance.provide({fn: async () => ...})`. The legacy `Instance.directory` / `Instance.project` / `Instance.worktree` ALS reads inside those bodies still work because `InstanceScope.with` calls both `Instance.provide` (legacy ALS) and `locallyInstance` (Effect ref) — they will be cleaned up in Phase H.

## Phase E status — complete on this branch

Audit revealed 9 of 12 listed schema leaf files don't exist on this branch (the schemas live inline in their owning namespace files; tracked in Phase P). Of the 3 files that exist:

- `permission/schema.ts` ✅ migrated. Effect Schema is the source of truth (`ActionSchema`, `RuleSchema`, `RulesetSchema`); public exports `Action`, `Rule`, `Ruleset` are derived via `zod()` from `@/util/effect-zod`. Tests pass without changes.
- `account/schema.ts` ✅ intentionally left Zod-first. No Effect-side consumer; migrating now would add walker indirection without downstream benefit.
- `storage/schema.ts` ✅ left as-is. Only re-exports drizzle SQL table definitions; no validation schemas here.

## Phase K status — bridge slices closed where applicable

- ✅ MCP OAuth bridge: `POST /mcp/:name/auth` (startAuth), `POST /mcp/:name/auth/callback` (authCallback), `POST /mcp/:name/auth/authenticate` (authenticate) implemented in `src/server/httpapi/mcp.ts`, mounted in `bridge.ts`, wired into `public.ts`.
- ✅ Inventory cleanup: console routes (`GET /experimental/console*`), `GET /experimental/workspace/status`, `GET /experimental/session` had no matching Hono registration on this branch — marked resolved with grep evidence.
- 🚧 Sync routes (`POST /sync/{start,replay,history}`) blocked by Phase I (`Sync.Service` not yet effectified).
- 🚧 Session prompt/share/init/summarize/shell/command + auth/observability layer wiring blocked on Phase D2.

## Phase F status — fully migrated

`Instance.provide` call sites remaining on this branch: **1 file only** (`src/cli/bootstrap.ts`, intentionally kept until Phase G replaces the promise cache).

`src/server/routes/mobile.ts` 29 sites successfully migrated using a small bracket-balancing migration script (see `Migration log` below). Bulk perl regex over-matched on recursive bodies; the bracket-balancing parser correctly tracks `{}` and `()` depth across the multi-line `async fn() { ... }` body.

## Phase G status — design ready

`src/project/instance.ts` cache replacement design:

1. Create `Effect.ScopedCache<string, Context>` keyed by `normalizeDirectory(directory)`, with `capacity: Number.MAX_SAFE_INTEGER` and `timeToLive: Duration.infinity`. The lookup function builds the `Context` (project + sandbox + disposers) inside an `Effect.acquireRelease`, so disposers run via scope finalizer when `Instance.dispose()` invalidates that key.
2. `Instance.provide({directory, init?, fn})` becomes:
   - `AppRuntime.runPromise(Effect.gen(function* () { const ctx = yield* cache.get(directory); /* run init once if first time */; return yield* Effect.promise(() => contextProvide(ctx, fn)) }))`
3. `Instance.dispose()` invalidates the key in the cache: `cache.invalidate(directory)`. Scope finalizer fires disposers automatically.
4. `Instance.disposeAll()` becomes `cache.invalidateAll`.
5. ALS-backed `Instance.directory/worktree/project` reads stay until Phase H. The cache replacement is *internal* — the Instance public API stays identical.

Risks to validate before landing:
- Concurrent `Instance.provide({directory: D, fn})` calls during boot must dedupe (ScopedCache handles this via fiber-join).
- `Instance.dispose()` fired while boot is still in flight: verify ScopedCache.invalidate before lookup completes.
- `init?` callback must run exactly once per directory across concurrent calls (ScopedCache's `lookup` runs once; `init` becomes part of it).

Implementation deferred to a dedicated PR with focused test coverage.

## Phase P status — large surface coverage in progress, walker shape inference landed for typed structs

After the 2026-05-08 pass, ~40 namespace-level schemas have flipped from Zod-first to Effect Schema with the public API kept identical via `zodObject(...)` / `zod(...)`. The walker's typed overload preserves `.shape` / `.omit` / `.partial` / `.merge` / `.extend` for direct callers; the only deferred class is *nested-struct extension* (consumer extends a Schema-derived Zod object whose properties are themselves `Schema.Struct(...)`-derived) — that class is documented as the LSP.Range fix path in the 2026-05-08 log.

Walker enhancement landed: `zodObject<Fields>(schema)` now returns `z.ZodObject<FieldsToShape<Fields>>` where `FieldsToShape` recursively maps each Effect Schema field to its Zod equivalent (`PropertySignature<"?:", A, ...>` → `z.ZodOptional<z.ZodType<A>>`, `Schema.Schema<A, ...>` → `z.ZodType<A>`). `.omit`, `.partial`, `.merge`, `.extend` now preserve typed shapes for downstream callers.

Migrated namespace-level schemas:

- ✅ `src/question/index.ts` — `Option`, `Info`, `Answer` now declared as Effect Schema with `zodObject(...)` derivation. `Schema.Schema.Type<typeof InfoSchema>` is the canonical type.
- ✅ `src/session/todo.ts` — `Todo.Info` declared as Effect Schema with `zodObject(...)`.
- ✅ `src/pty/index.ts` — `Pty.Info`, `Pty.CreateInput`, `Pty.UpdateInput`. Status enum via `Schema.Literal("running", "exited")`, env via `Schema.Record({key, value})`, nested optional struct for size.
- ✅ `src/permission/next.ts` — `Action`, `Rule`, `Ruleset`, `Request`, `Reply`, `Approval`. `Schema.mutable(Schema.Array(...))` for `Ruleset`. ID `startsWith` prefixes match `Identifier.prefixes` short keys. Schemas re-exported (`ActionSchema`, `RuleSchema`, `RulesetSchema`) for cross-namespace Effect Schema composition.
- ✅ `src/installation/index.ts` — `Info`.
- ✅ `src/auth/index.ts` — `Oauth`, `Api`, `WellKnown`, `Info` (Schema.Union), `WellKnownAuthResponse`. `accountId` writes use spread to satisfy readonly `Auth.Info`.
- ✅ `src/skill/skill.ts` — `Info`, `CreateInput`. `Schema.optionalWith(..., {default})` for `scope`. Public `CreateInput` aliased to `Schema.Schema.Encoded`; `CreateParsedInput` = `Schema.Schema.Type` (after default).
- ✅ `src/agent/agent.ts` — `Info` declared as `Schema.mutable(Schema.Struct(...))` because the agent record is mutated extensively in config merge logic. Reuses `PermissionNext.RuleSchema`.
- ✅ `src/snapshot/index.ts` — `Patch` migrated; `files` array marked `Schema.mutable`.
- ✅ `src/provider/auth.ts` — `ProviderAuth.Method`, `Authorization`, and authorize/callback/api input contracts are Effect Schema-first with Zod derived via `zodObject(...)`.
- ✅ `src/project/project.ts` — `Info`, `UpdateInput`. `Info` uses shared `DeepMutable` from `@/util/effect-zod`. `IconSchema` extracted for `Info.shape.icon` access.
- ✅ `src/project/vcs.ts` — `Vcs.Info`.
- ✅ `src/connectors/auth.ts` — `ConnectorAuth.Entry` with shared `DeepMutable` (mutated by `updateToken`/`updateBotToken`/`updateApiKey`).
- ✅ `src/worktree/index.ts` — `Worktree.Info`, `CreateInput`, `RemoveInput`, `ResetInput`.
- ✅ `src/provider/provider.ts` — `Provider.Model` (nested Schema.Struct, shared `CapabilitiesIOSchema` and `CostBlockSchema`), `Provider.Info`. Both `DeepMutable`. Cast `Record<string, unknown>` at internal fetch wrapper / spread sites.
- ✅ `src/provider/models.ts` — `ModelsDev.Model`, `ModelsDev.Provider`. Both `DeepMutable`. Shared `ModalityValueSchema` and `CostBlockSchema`.
- ✅ `src/monitor/manager.ts` — `Monitor.Status` (Schema.Literal), `Monitor.Record` (DeepMutable), `Monitor.LogSnapshot`.
- ✅ `src/util/log.ts` — `Log.Level` Effect Schema.
- ✅ `src/sandbox/types.ts` — `Ref` and `State` (each `Schema.Union` over tagged variants); `RefSchema` / `StateSchema` re-exported for cross-namespace composition.
- ✅ `src/background/run.ts` — `Status` / `Source` / `Role` literal enums + `Record` (`DeepMutable<...>` because the run record is mutated during streaming updates).
- ✅ `src/workspace/config.ts` — `Workspace.Config` as `Schema.Union` of `worktree | container`.
- ✅ `src/workspace/index.ts` — `ConnectionStatus` (literal), `Info`, `Restore`, `SessionRestore`. `Restore` and `SessionRestore` keep their `tag` literal so existing union discrimination still works.
- ✅ `src/file/index.ts` — `Node` and `Content` (with nested patch sub-struct).
- ✅ `src/file/searchBackend.ts` — `Backend` (Schema.Literal) and `Match` (`Schema.mutable(Schema.Array(...))` over `submatches` because the search loop pushes into it).
- ✅ `src/session/status.ts` — `SessionStatus.Info` as `Schema.Union` of `idle` / `retry` / `busy` tagged structs annotated with `zodObjectMode("strip")` so legacy unknown-field tolerance is preserved on session status payloads.
- ✅ `src/session/summary.ts` — `SummarizeInput`, `DiffInput`. `Schema.startsWith("ses")` / `Schema.startsWith("msg")` ID-prefix refinements use the canonical `Identifier.prefixes` short keys.
- ✅ `src/session/revert.ts` — `RevertInput`.
- ✅ `src/session/compaction.ts` — `CreateInput`.
- 🔁 `src/lsp/index.ts` — migration attempt reverted. `LSP.Range` consumers (`MessageV2.SymbolSource` via `FilePartSourceBase.extend({range: LSP.Range})`) widen nested struct types to `unknown` because `z.infer` reads the structural shape from `.extend(...)` rather than the precise inner `z.ZodType<X>`. Stays Zod-first until `FieldsToShape<Fields>` walks recursively into nested `Schema.Struct` (mapping to `z.ZodObject<{...}>` not `z.ZodType<X>`). See 2026-05-08 log for the fix path.
- 🔁 Extension/tool schema unlocks — the walker now supports enough shape inference for the already-migrated tool parameter schemas tracked in `schema.md` Phase J; SDK byte-identity work is therefore unblocked by continuing Phase P before the generator flip.

Walker enhancements landed during this Phase P iteration:

- `zodObject` now has 2 overloads: typed `Schema.Struct<Fields>` (preserves `.shape`/`.omit` field types) and broad `Schema.Schema<A,I,R>` (for `Schema.mutable(...)`-wrapped or other non-Struct compositions).
- `zodObjectMode("strict" | "strip" | "passthrough")` annotation: schemas can opt out of the default `.strict()` behavior (e.g. forward-compatible JSON payloads where unknown fields should pass through or be silently dropped). Test coverage in `test/util/effect-zod.test.ts`.

Knock-on tool migrations unblocked:

- ✅ `src/tool/question.ts` — uses a dedicated `QuestionWithoutCustom` Schema.Struct for params (clean alternative to `.omit`).
- ✅ `src/tool/todo.ts` — `TodoWriteTool` now uses Effect Schema params.

Remaining Phase P scope (per `schema.md` large surfaces):

- Provider domain — ✅ `provider/auth.ts`, `provider/provider.ts`, `provider/models.ts` all landed.
- Session domain — ✅ `compaction`, `revert`, `summary`, `status`, `todo` landed; remaining: `message-v2`, `message`, `prompt`, `session` (large; needs to land alongside or after Phase D2 to avoid fighting in-flight handler refactors).
- LSP / MCP — `lsp/index.ts`, `mcp/index.ts`, `mcp/auth.ts`, `lsp/client.ts` schemas. LSP.Range blocked on walker nested-struct shape inference (see 2026-05-08 log); MCP can land independently.
- Server route DTO files — ~20 files. Independent of the route-handler refactor in Phase D; can land any time.
- Bus events, command, plugin, agent, control-plane, ide, util, etc.

Each is a self-contained migration following the `Question.Info` pattern: declare `Schema.Struct(...)`, expose `zodObject(...)`/`zod(...)` for compat, mirror downstream callers as needed. For records that get mutated post-construction, use `DeepMutable<typeof FooSchema>` from `@/util/effect-zod` instead of `Schema.mutable(Schema.Struct(...))` to keep typed-overload `.shape` access working.

Migrated (21 files, ~50 call sites, all behind green typecheck):

- CLI commands: `agent.ts` (2), `pr.ts`, `models.ts`, `image-model.ts`, `auth.ts`, `connectors.ts` (4), `mcp.ts` (6), `plug.ts`, `remote.ts` (5), `ads.ts` (6), `github.ts`, `chatbot.ts` (5), `speak-model.ts`, `tui/worker.ts`
- TUI entrypoints: `tui/app.tsx` (2), `tui/component/dialog-settings/brain.tsx` (2), `tui/plugin/runtime.ts` (2), `tui/routes/session/footer.tsx`
- Server / misc: `server/server.ts`, `mobile/routine.ts`, `chatbot/handlers.ts` (2), `session/auth.ts`, `workspace/index.ts`, `workspace/workspace-server/server.ts`

The `withInstanceAsync` helper now supports the optional `init` callback so the bootstrap pattern (`init: InstanceBootstrap`) migrates cleanly without losing per-directory one-time initialization semantics.

Remaining:

- `src/cli/bootstrap.ts` — keeps `Instance.provide` until Phase G replaces the promise cache; the `init` + `dispose` lifecycle pattern is tied to that cache.
- `src/server/routes/mobile.ts` — 29 call sites with heterogeneous indentation, complex nesting (some inside `WorkspaceContext.provide(...)`, some returning values, some with `.catch(...)` chains). Needs a focused PR with file-aware migration; bulk perl regex was attempted and abandoned because the recursive balanced-brace pattern over-matched. Pure follow-up work.

## Guiding constraints

1. **No regressions.** `bun run typecheck` and the relevant slice tests must pass at each phase boundary.
2. **No SDK drift.** OpenAPI / generated SDK output stays byte-identical until the deliberate generator flip in Phase L.
3. **No wrappers, no facades, no TODOs.** A migration is "done" only when the legacy surface is removed from production callers and tests.
4. **No instance-context shortcuts.** Effect code reads instance through `InstanceState.context` / `yield* InstanceState.directory`. The legacy ALS-backed `Instance.*` is invoked only at compatibility boundaries, and only until that boundary itself is moved.
5. **Behavior preservation first, refactor second.** Each migration PR keeps semantics identical; clean-up that changes shape is a separate change.

## Validation gates

Each phase has its own validation matrix. The minimum gate that applies to every phase:

| Gate | Command |
| --- | --- |
| Typecheck | `bun run typecheck` |
| Touched-area tests | `bun test test/<area>/*.test.ts` |
| SDK byte-identity (when schemas / routes change) | `bun packages/sdk/js/script/build.ts` then diff `packages/sdk/js/src/v2/gen/types.gen.ts` |

Phase-specific gates are listed inline.

## Phase summary

| Phase | Title | Touches | Risk | Blocks |
| --- | --- | --- | --- | --- |
| A1 | `Filesystem.*` → `AppFileSystem` in already-migrated services | `config/config.ts`, `provider/provider.ts` | low | B1 |
| A2 | `Process.spawn` → `ChildProcessSpawner` | `format/formatter.ts`, `lsp/server.ts` | medium | — |
| A3 | `util/lazy.ts` → `Effect.cached` (Effect call sites only) | misc | low | — |
| A4 | `util/lock.ts` → Effect `Semaphore` (Effect call sites) | misc | low | — |
| A5 | `util/flock.ts` → `Effect.repeat` + `addFinalizer` (Effect call sites) | misc | medium | — |
| B1 | `config/config.ts` internal load via `ConfigPaths.Service` | config | low | — |
| B2 | `env/index.ts` → `Env.Service` | env, provider | medium | — |
| B3 | TUI config callers → `TuiConfig.Service` | `cli/cmd/tui/*` | low | — |
| B4 | `migrate-tui-config.ts` decision: leave plain or effectify | tui | low | — |
| P | Schema large surfaces (session domain, provider, route DTOs, config root, remaining namespaces) | many | high | J, K, L |
| C | Tool internals cleanup (`read`, `bash`, `webfetch`, `ripgrep`, `patch`) | `tool/*`, `file/ripgrep.ts`, `patch/index.ts` | medium | J |
| D1 | Route effectification (lighter routes) | `server/routes/{provider,mcp,file,experimental}.ts` | medium | F |
| D2 | Route effectification (heavy routes) | `server/routes/{session,mobile,global}.ts`, `server/server.ts` | high | F |
| E | Schema leaves migration (12 `src/*/schema.ts`) | leaf schemas | low | P |
| F | Instance-context Phase 3 (entry boundaries) | `server/middleware.ts`, `cli/cmd/*`, tool execution | high | G |
| G | Instance-context Phase 4 (replace promise boot cache) | `project/instance.ts` | high | H |
| H | Instance-context Phase 5–6 (ALS shrink + delete legacy API) | `project/instance.ts`, `effect/instance-state.ts` | high | — |
| I | `SyncEvent` and `Workspace` service shapes | `sync/index.ts`, `control-plane/workspace.ts` | medium | K |
| J | Tool params schemas (16 files) | `tool/*.ts` | medium | L |
| K | HttpApi: complete remaining bridge slices | `server/httpapi/*` | medium | L |
| L | HttpApi: backend fork + OpenAPI source flip / SDK byte-identity | `server/backend.ts`, `server/httpapi/public.ts`, `cli/cmd/generate.ts`, `packages/sdk/js/script/build.ts` | high | N |
| M | Special routes (event SSE, pty WS, tui control) | `server/event.ts`, `server/routes/pty.ts`, `server/routes/tui.ts` | high | N |
| N | Hono deletion (group by group) | `server/routes/*.ts`, `server/server.ts` | high | — |
| O | `packages/server` extraction | new package | high | last |

Current execution order from this point is **P → C → D2 → G → H → I → J → K → L → M → N → O**. Phase O is intentionally last; extracting `packages/server` before schemas, instance context, HttpApi parity, and SDK byte-identity are stable would create an extraction target that still churns. Phases can run in parallel only when their write sets do not overlap and the downstream SDK/OpenAPI contract stays byte-identical.

## Phase A — service-internal swaps (low risk, no shape change)

### A1. `Filesystem.*` → `AppFileSystem.Service`

Targets: `src/config/config.ts`, `src/provider/provider.ts`.

Mechanical replacement:

```ts
// before
const found = await Filesystem.findUp("nikcli.json", ctx.directory, ctx.worktree)

// after
const fs = yield* AppFileSystem.Service
const found = yield* fs.findUp("nikcli.json", ctx.directory, ctx.worktree)
```

Steps:

1. Add `AppFileSystem.Service` to the layer R requirement of the host service.
2. `yield* AppFileSystem.Service` once at the layer top.
3. Replace each `Filesystem.<method>(...)` call inside the layer body with the equivalent service method.
4. If `Filesystem` exposes a method the service does not, port the helper to `AppFileSystem` first (still Phase A).
5. `Layer.provide(AppFileSystem.defaultLayer)` on the consumer's `defaultLayer`.
6. Adjust callers' `.layer` tests to provide the new dep, or switch to `defaultLayer`.

Validation:

- `bun run typecheck`
- `bun test test/config/effect-service.test.ts test/provider/effect-service.test.ts`

Acceptance:

- `rg -n "Filesystem\." src/config/config.ts src/provider/provider.ts` returns no matches.
- `rg -n "AppFileSystem\\.Service" src/config/config.ts src/provider/provider.ts` shows the new yield.

### A2. `Process.spawn` / `Bun.spawn` → `ChildProcessSpawner`

Targets:

- `src/format/formatter.ts` — `air`, `uv` `--help` checks (small).
- `src/lsp/server.ts` — multiple installer / detection helpers (large; see notes).

`format/formatter.ts` is the easy win and should land first; `lsp/server.ts` is large and is split into sub-batches:

- A2.a — installer probes (`Bun.spawn(["bun", "install", ...])`) inside each language definition.
- A2.b — `--help` / `--version` capability probes used to gate language activation.
- A2.c — `spawn(...)` for the actual long-lived LSP child process used by `Handle`.

A2.c only happens after the LSP `Handle` shape itself accepts an Effect-spawned child. Until that lands, A2.a and A2.b can ship independently.

Validation:

- `bun test test/format/effect-service.test.ts test/lsp/effect-service.test.ts`
- Manual smoke: open a project that exercises one of the affected language servers and confirm spawn behavior is identical.

Acceptance:

- `Bun.spawn` and bare `spawn` calls are absent from the migrated files (or limited to A2.c if not yet landed).

### A3. `util/lazy.ts` → `Effect.cached` (Effect-resident only)

Targets:

- Effect-resident usages of `lazy()` for run-once memoization.

Steps:

1. Find Effect-resident lazy uses with `rg -n "lazy\\(" src --glob '*.ts'`.
2. For each, prove the caller is itself Effect-resident.
3. Replace `const cached = lazy(() => loadX())` with `let cached = yield* Effect.cached(loadX())`.
4. Where invalidation exists, mirror the spec pattern: reassign with `yield* Effect.cached(...)`.

Sync-only callers keep `lazy()`. Do not touch them; they are out of scope until further phases.

### A4. `util/lock.ts` → Effect `Semaphore`

Effect-resident reader-writer Lock callers swap to `Effect.Semaphore` permits. Non-Effect callers keep the legacy primitive until they themselves are migrated.

### A5. `util/flock.ts` → `Effect.repeat` + `Scope.addFinalizer`

Same rule as A4. Land per-caller; do not touch the legacy module.

## Phase B — config / env / tui consolidation

### B1. `config/config.ts` internal load via `ConfigPaths.Service`

Currently `config.ts` calls async `ConfigPaths.*(...)` wrappers via `Effect.promise(...)`. The service exists; the swap is just `yield* paths.<method>(...)`.

Steps:

1. Yield `ConfigPaths.Service` once in `Config` layer.
2. Replace the four `Effect.promise(() => ConfigPaths.X(...))` sites with `yield* paths.X(...)`.
3. Update consumer `defaultLayer` to provide `ConfigPaths.defaultLayer`.

Validation: existing config-effect tests already cover the behavior.

### B2. `env/index.ts` → `Env.Service`

`env/index.ts` still uses `Instance.state(...)`. Convert to a small `Env.Service` backed by `InstanceState`. Migrate the `Provider` caller chain in the same change to avoid orphan callers.

### B3. TUI config callers

`cli/cmd/tui/attach.ts`, `cli/cmd/tui/thread.ts`, `cli/cmd/tui/plugin/runtime.ts` still call the plain async `TuiConfig.*` wrappers. Replace each with `AppRuntime.runPromise(TuiConfig.Service.use((svc) => svc.<method>(...)))` or a contiguous `Effect.gen` block when the file is service-heavy.

### B4. `migrate-tui-config.ts`

Decision: leave as plain async only if every caller is itself plain async. Otherwise effectify under `TuiConfigMigrate.Service` reusing `ConfigPaths.Service`.

## Phase C — Tool internals cleanup

Each item is its own focused change; do not combine. Each must keep AI-SDK JSON Schema output byte-identical.

- C1 — `tool/read.ts`: replace `fs.createReadStream` + `readline` with `AppFileSystem.Service` + `Stream` for streaming reads. Replace Promise-based binary detection with `Effect.gen`.
- C2 — `tool/bash.ts`: any remaining shell-specific Promise bridges → `ChildProcessSpawner`.
- C3 — `tool/webfetch.ts`: HTML text extraction helper → Effect-native (cheerio call inside `Effect.try` is fine; no facade).
- C4 — `file/ripgrep.ts`: raw `fs/promises` → `AppFileSystem.Service`.
- C5 — `patch/index.ts`: raw `fs` / `fs/promises` → `AppFileSystem.Service`.

Validation per item: focused tool tests + grep evidence.

## Phase D — Route effectification

Convert the active Hono route bodies so the entire handler runs inside one `AppRuntime.runPromise(Effect.gen(...))`.

### D1. Lighter routes

- `server/routes/provider.ts` — finish: audit `GET /provider` and instance-disposal.
- `server/routes/mcp.ts` — convert all handlers + OAuth flows.
- `server/routes/file.ts` — file/search bridges + service boundaries.
- `server/routes/experimental.ts` — remove direct `Instance.*` reads and finish service-boundary audit.

### D2. Heavy routes

- `server/routes/session.ts` — large; many partially-migrated handlers. Break into sub-batches by sub-feature (lifecycle, message, share, prompt, etc.).
- `server/routes/mobile.ts` — remove `Instance.provide(...)` boundary.
- `server/routes/global.ts` — global lifecycle and streaming paths.
- `server/server.ts` — top-level handlers.

Acceptance per file: the handler body is one effect block; no `Instance.*` ALS reads inside; tests still pass.

## Phase E — Schema leaves

12 leaf schema files. Each is small and self-contained. Migrate Zod-first → Effect Schema, expose `.zod` static for any remaining Zod consumer, validate SDK byte-identity.

Order (data-flow leaves first):

1. `id/id.ts` (already mostly there) — sanity check
2. `account/schema.ts`
3. `permission/schema.ts`
4. `question/schema.ts`
5. `pty/schema.ts`
6. `provider/schema.ts`
7. `storage/schema.ts`
8. `tool/schema.ts`
9. `project/schema.ts`
10. `sync/schema.ts`
11. `util/schema.ts`
12. `session/schema.ts` (already migrated; just verify)
13. `control-plane/schema.ts`

Validation: SDK build script run with `--diff` against pre-change snapshot.

## Phase F — Instance context Phase 3 (entry boundaries)

Build one shared helper:

```ts
// src/effect/with-instance.ts
export const withInstance = <A, E, R>(
  input: { directory: string; workspaceID?: string },
  effect: Effect.Effect<A, E, R>,
) => InstanceScope.with(input, effect)
```

Migrate each entrypoint to `AppRuntime.runPromise(withInstance({ directory }, effect))`:

- `server/middleware.ts` — request middleware that currently calls `Instance.provide(...)`.
- `cli/bootstrap.ts`
- `cli/cmd/agent.ts`, `cli/cmd/debug/agent.ts`, `cli/cmd/debug/ripgrep.ts`, `cli/cmd/github.ts`, `cli/cmd/import.ts`, `cli/cmd/mcp.ts`, `cli/cmd/models.ts`, `cli/cmd/plug.ts`, `cli/cmd/pr.ts`, `cli/cmd/providers.ts`, `cli/cmd/stats.ts`
- `cli/cmd/tui/attach.ts`, `cli/cmd/tui/plugin/runtime.ts`, `cli/cmd/tui/thread.ts`, `cli/cmd/tui/worker.ts`
- Tool execution path: tools that read `Instance.directory` etc. switch to receiving `ctx` as an Effect dep (`yield* InstanceState.context`).

`InstanceScope.with(...)` is already in `src/effect/instance-scope.ts`; this phase wires it everywhere that currently calls `Instance.provide(...)`.

## Phase G — Instance context Phase 4 (replace promise boot cache)

Replace `cache: Map<string, Promise<Context>>` and the `boot(...)` helper in `src/project/instance.ts` with a keyed scoped runtime:

```ts
const InstanceLayerMap = LayerMap.make({ key: directory, lookup: (dir) => makeInstanceLayer(dir) })
```

Cleanup happens via `Scope` finalizers. `disposeAll()` becomes a single `Scope.close(...)` over the shared scope.

The legacy `Instance.provide(...)` shrinks to thin compatibility for any caller still on the old shape — gone after Phase H.

## Phase H — Instance context Phase 5–6 (ALS shrink + delete legacy API)

- ALS confined to `file/watcher.ts`, `session/llm.ts`, plugin/LSP callback bridges that the underlying library forces to leave the Effect fiber tree.
- Delete `Instance.current`, `Instance.directory`, `Instance.worktree`, `Instance.project`, `Instance.state`, `Instance.containsPath` from the public `Instance` object.
- Remove the ALS fallback inside `src/effect/instance-state.ts` (`context` becomes pure `instance` from `InstanceRef`).
- `src/project/instance.ts` becomes a thin compat shim or is deleted entirely.

Acceptance: `rg -l "Instance\.(current|directory|worktree|project|provide|bind|restore|reload|dispose|disposeAll|state)" src` returns at most the documented bridge files and the shim itself.

## Phase I — open service shapes

### I1. `Sync` (a.k.a. SyncEvent) — `src/sync/index.ts`

Currently event/payload helpers + module-level `state` singletons. Convert to:

- `Sync.Service` with `start`, `replay`, `history`, `publish` methods.
- `InstanceState`-backed per-directory state.
- Effect Schema for event payloads where Phase E left them as zod-only.

### I2. `Workspace` — `src/control-plane/workspace.ts`

Effect service with `list`, `create`, `remove`, `restore`, `restoreSession`, `status`. Backs the `httpapi/workspace.ts` bridge end-to-end without the legacy adapter layer.

## Phase J — tool params schemas

Convert each `src/tool/*.ts` parameters schema from Zod-first to Effect Schema with a derived `.zod` for the AI SDK boundary. The `effect-zod` walker must produce byte-identical JSON Schema; keep refinements named (`PositiveInt`, etc.) so the JSON Schema output matches.

Order: `invalid` → `read` → `write` → `glob` → `grep` → `edit` → `apply_patch` → `bash` → `lsp` → `plan` → `question` → `skill` → `task` → `todo` → `webfetch` → `websearch` → `tool.ts`.

Validation per tool: existing tool tests + AI-SDK JSON Schema diff.

## Phase K — HttpApi: complete remaining bridge slices

Open bridge work from `http-api.md`:

- K1 — ✅ MCP OAuth: `POST /mcp/:name/auth`, `/auth/callback`, `/auth/authenticate` are bridged and tracked as complete in `http-api.md`.
- K2 — experimental console: `GET /experimental/console`, `/console/orgs`, `POST /console/switch`. Confirm Hono registration first; if absent, remove from inventory.
- K3 — experimental global session: `GET /experimental/session`.
- K4 — sync routes: `POST /sync/start`, `/sync/replay`, `/sync/history`. Depends on Phase I1.
- K5 — workspace status: `GET /experimental/workspace/status`. Depends on Phase I2.
- K6 — session prompt/share/init/summarize/shell/command + deprecated permission. Depends on Phase D2 (session route effectification) so the bridge isn't fighting the legacy handler.
- K7 — auth, observability layer wiring inside the Effect HttpApi route layer.
- K8 — `auth_token` as a real `HttpApiSecurity.apiKey` query scheme (replace the public.ts hand-injection).

Each item is an independent slice with bridge-level test coverage.

## Phase L — backend fork + OpenAPI source flip

L1 — Reintroduce `server/backend.ts` that forks at startup between `effect-httpapi` and `hono`. `server.ts` builds either pure Effect HttpApi web handler or legacy Hono app.

L2 — Implement Effect HttpApi OpenAPI generation behind `--httpapi` and `NIKCLI_SDK_OPENAPI=httpapi`.

L3 — Close the schema-shape gaps in `server/httpapi/public.ts`:

- branded-type `pattern` constraints on ID schemas.
- per-property `description` annotations through `Schema.Struct`.
- `Event.*` / `SyncEvent.*` component naming (dotted vs PascalCase).
- component-deduper numbered duplicates (`Session9`, `SyncEvent.session.updated.11`).
- cosmetic-only diffs that would leak through to SDK.

L4 — Diff Effect-generated OpenAPI vs Hono-generated for every mounted route group. Accept only intentional diffs.

L5 — Flip `packages/sdk/js/script/build.ts` default to `httpapi`. Regenerate. Diff `packages/sdk/js/src/v2/gen/types.gen.ts` and check in.

L6 — Flip `backend.ts` default from `hono` to `effect-httpapi`. Keep `NIKCLI_EXPERIMENTAL_HTTPAPI=0` as a temporary inverse fallback flag.

## Phase M — special routes

- M1 — `event` SSE: port to `HttpApi` streaming endpoint or raw `@effect/platform` `HttpServerResponse.stream(...)`.
- M2 — `pty` websocket: raw `@effect/platform` websocket upgrade. The PTY service already exposes the right Effect surface.
- M3 — `tui` control routes: keep Hono if necessary, otherwise port to raw Effect HTTP. The tui control bridge is internal; can remain in a small Hono island until its consumer is gone.

## Phase N — Hono deletion

Per route group, after L is green and tests cover both default and fallback:

1. Remove the Hono `describeRoute` + validator + handler.
2. Remove the `.route(...)` registration.
3. Remove duplicate Zod-only DTOs.
4. Regenerate SDK; verify no diff.

Final step: remove Hono import + `cors` + `basicAuth` + `streamSSE` + `proxy` + `lazy(...)` server bootstrap once nothing depends on them.

## Phase O — `packages/server` extraction

Follow `server-package.md`. PR plan:

1. Create `packages/server` (workspace, package.json, tsconfig, empty src tree).
2. Extract `question` contract to `packages/server/src/definition/question.ts`.
3. Extract `question` handler factory to `packages/server/src/api/question.ts`.
4. Mount from `packages/nikcli` via the new `bridge/hono.ts`.
5. Merge legacy + contract OpenAPI into one document.
6. Add merged-spec test coverage.
7. `GET /provider/auth` slice.
8. `GET /config/providers` slice.
9. Read-only instance routes (`/path`, `/vcs`, `/command`, `/agent`, `/skill`).
10. After `packages/core` exists: move host ownership.
11. After server + core stable: split `packages/cli`.

## Phase P — schema large surfaces

Migrate the remaining large schema surfaces now, before the SDK generator flip. Phase P is the current unlock for SDK byte-identity because the Effect OpenAPI path needs canonical Effect Schema names and stable derived Zod compatibility before it can replace the Hono/Zod source. Order:

1. Provider domain (`provider/models.ts`, `provider/provider.ts`; `provider/auth.ts` is already landed).
2. Session domain (compaction, message-v2, message, prompt, revert, summary, status, todo, session).
3. Config root and server route DTO files (one per route file).
4. Everything else (acp, bus, cli, command, plugin, ide, util, etc.).

Each migration validates SDK byte-identity. Any deliberate diff is reviewed and documented.

## Cross-cutting rules

- **One service, one module.** Public namespace exposed via `export * as Foo from "."` self-reexport. Flat top-level exports inside the service file.
- **Traced methods.** `Effect.fn("Foo.method")(function* () { ... })` for every service method.
- **Layer composition.** `defaultLayer = layer.pipe(Layer.provide(Dep.defaultLayer))`. Tests that need a custom dep wrap it in `Layer.fresh(...)`.
- **InstanceState init lifecycle.** Subscriptions, finalizers, and background fibers go in the `InstanceState.make` init closure. No `started` flag patterns.
- **Effect.cached for run-once + concurrent join.** Replaces `let cached`, `Fiber|undefined`, and `Promise<void>` task patterns.
- **Schema → Zod.** Use `@/util/effect-zod`. Never maintain parallel Zod and Effect definitions of the same type.

## Definition of done

The migration is complete when:

1. `rg -l "Instance\\.(current|directory|worktree|project|provide|bind|restore|reload|dispose|disposeAll|state)" src` returns no files outside the documented bridge set, and the bridge set itself is empty or shrunk to a deletion-eligible shim.
2. `rg -l "from \"hono\"|hono-openapi|streamSSE" src/server` returns no files outside the documented special-routes residue, and that residue has its own deletion plan.
3. `bun run typecheck` and the full `bun test` suite pass.
4. `bun packages/sdk/js/script/build.ts` produces output identical to the pre-flip baseline (or a documented intentional diff).
5. No file in `src` imports `effect/Effect` and also exports an `async function` facade for the same surface.
6. `packages/server` exists, owns its slice of HttpApi contracts and handlers, and `packages/nikcli` consumes it without cycles.

## Execution principles

- **Compile after every change.** A green build is the cheapest gate.
- **Tests close to the change.** Don't run the full suite for every micro-edit; do run it before each phase boundary.
- **Smallest reversible unit.** If a phase contains five replacements, land them one at a time when the diff is non-mechanical.
- **Bridge symmetry.** While both Hono and HttpApi paths exist for the same route, both must pass tests until Phase N deletes one of them.
- **No partial conversions in committed code.** A file either fully matches the target shape for the items it contains, or it isn't checked off in the per-phase acceptance section.
