# Effect patterns

Practical reference for new and migrated Effect code in `packages/nikcli`.

## Current baseline on this branch

Reality check as of this migration pass:

- [x] `effect@3.21.2` is a direct `packages/nikcli` dependency (`packages/nikcli/package.json`, `bun.lock`).
- [x] `src/effect/*` provides the first real Effect foundation (`bun run typecheck` passes):
  - `InstanceRef` / `WorkspaceRef` tags and fiber refs
  - a shared `AppRuntime` / `makeRuntime(...)` boundary helper
  - `InstanceState` helpers that can read Effect-provided instance context and temporarily fall back to the legacy `Instance` bridge
- [x] `src/effect/instance-scope.ts` exposes `InstanceScope.with(...)`, covered by `bun test test/effect/instance-scope.test.ts`.
- [x] `src/config/paths.ts` exposes `ConfigPaths.Service` with Effect-native `projectFiles`, `directories`, `readFile`, and `parseText` operations.
- The legacy async `ConfigPaths.*` functions remain only as compatibility boundaries for existing callers; direct service consumers should use `yield* ConfigPaths.Service`.
- [x] `src/question/index.ts` exposes `Question.Service` backed by `InstanceState`, with shared runtime/layer behavior covered by `bun test test/question/effect-service.test.ts`.
- [x] `src/permission/next.ts` exposes `PermissionNext.Service` backed by `InstanceState`, with pending ask/reply and reject-with-feedback behavior covered by `bun test test/permission/effect-service.test.ts`.
- [x] `bun run typecheck` and the current slice tests pass:
  - `bun test test/config/paths.test.ts`
  - `bun test test/effect/instance-scope.test.ts`
  - `bun test test/question/effect-service.test.ts`
  - `bun test test/permission/effect-service.test.ts`

Do not treat the older checked items below as proof that the entire repo is already migrated. The safe migration rule for this branch is: a module counts as migrated only when current code contains the Effect service shape and current tests or typecheck cover that path.

## Choose scope

Use `InstanceState` (from `src/effect/instance-state.ts`) for services that need per-directory state, per-instance cleanup, or project-bound background work. InstanceState uses a `ScopedCache` keyed by directory, so each open project gets its own copy of the state that is automatically cleaned up on disposal.

Use the shared runtime helpers from `src/effect/runtime.ts` at compatibility boundaries. `runtimeFor(...)` and `runPromiseExitWithLayer(...)` share `ManagedRuntime` instances per layer through the global Effect `memoMap`, so compatibility exports do not create a fresh service state on every call.

- Global services (no per-directory state): Account, Auth, ConnectorAuth, AppFileSystem, Installation, Truncate, Worktree
- Instance-scoped (per-directory state via InstanceState): Agent, Bus, Command, Config, File, FileWatcher, Format, LSP, MCP, Permission, Plugin, ProviderAuth, Pty, Question, SessionStatus, Skill, Snapshot, ToolRegistry, Vcs

Rule of thumb: if two open directories should not share one copy of the service, it needs `InstanceState`.

## Instance context transition

See `instance-context.md` for the phased plan to remove the legacy ALS / promise-backed `Instance` helper and move request / CLI / tool boundaries onto Effect-provided instance scope.

## Service shape

Every service follows the same pattern: one module, flat top-level exports, traced Effect methods, and a self-reexport at the bottom when the file is the public module.

```ts
export interface Interface {
  readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>
}

export class Service extends Context.Service<Service, Interface>()("@nikcli/Foo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Foo.state")(() => Effect.succeed({ ... })),
    )

    const get = Effect.fn("Foo.get")(function* (id: FooID) {
      const s = yield* InstanceState.get(state)
      // ...
    })

    return Service.of({ get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FooDep.layer))

export * as Foo from "."
```

Rules:

- Keep the service surface in one module; prefer flat top-level exports over `export namespace Foo { ... }`
- Use `Effect.fn("Foo.method")` for Effect methods
- Use a self-reexport (`export * as Foo from "."` or `"./foo"`) for the public namespace projection
- Avoid service-local `makeRuntime(...)` facades unless a file is still intentionally in the older migration phase
- No `Layer.fresh` for normal per-directory isolation; use `InstanceState`

## Schema → Zod interop

When a service uses Effect Schema internally but needs Zod schemas for the HTTP layer, derive Zod from Schema using the `zod()` helper from `@/util/effect-zod`:

```ts
import { zod } from "@/util/effect-zod"

export const ZodInfo = zod(Info) // derives z.ZodType from Schema.Union
```

See `Auth.ZodInfo` for the canonical example.

## InstanceState init patterns

The `InstanceState.make` init callback receives a `Scope`, so you can use `Effect.acquireRelease`, `Effect.addFinalizer`, and `Effect.forkScoped` inside it. Resources acquired this way are automatically cleaned up when the instance is disposed or invalidated by `ScopedCache`. This makes it the right place for:

- **Subscriptions**: Yield `Bus.Service` at the layer level, then use `Stream` + `forkScoped` inside the init closure. The fiber is automatically interrupted when the instance scope closes:

```ts
const bus = yield * Bus.Service

const cache =
  yield *
  InstanceState.make<State>(
    Effect.fn("Foo.state")(function* (ctx) {
      // ... load state ...

      yield* bus.subscribeAll().pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            /* handle */
          }),
        ),
        Effect.forkScoped,
      )

      return {
        /* state */
      }
    }),
  )
```

- **Resource cleanup**: Use `Effect.acquireRelease` or `Effect.addFinalizer` for resources that need teardown (native watchers, process handles, etc.):

```ts
yield *
  Effect.acquireRelease(
    Effect.sync(() => nativeAddon.watch(dir)),
    (watcher) => Effect.sync(() => watcher.close()),
  )
```

- **Background fibers**: Use `Effect.forkScoped` — the fiber is interrupted on disposal.
- **Side effects at init**: Config notification, event wiring, etc. all belong in the init closure. Callers just do `InstanceState.get(cache)` to trigger everything, and `ScopedCache` deduplicates automatically.

The key insight: don't split init into a separate method with a `started` flag. Put everything in the `InstanceState.make` closure and let `ScopedCache` handle the run-once semantics.

## Effect.cached for deduplication

Use `Effect.cached` when multiple concurrent callers should share a single in-flight computation. It memoizes the result and deduplicates concurrent fibers — second caller joins the first caller's fiber instead of starting a new one.

```ts
// Inside the layer — yield* to initialize the memo
let cached = yield * Effect.cached(loadExpensive())

const get = Effect.fn("Foo.get")(function* () {
  return yield* cached // concurrent callers share the same fiber
})

// To invalidate: swap in a fresh memo
const invalidate = Effect.fn("Foo.invalidate")(function* () {
  cached = yield* Effect.cached(loadExpensive())
})
```

Prefer `Effect.cached` over these patterns:

- Storing a `Fiber.Fiber | undefined` with manual check-and-fork (e.g. `file/index.ts` `ensure`)
- Storing a `Promise<void>` task for deduplication (e.g. `skill/index.ts` `ensure`)
- `let cached: X | undefined` with check-and-load (races when two callers see `undefined` before either resolves)

`Effect.cached` handles the run-once + concurrent-join semantics automatically. For invalidatable caches, reassign with `yield* Effect.cached(...)` — the old memo is discarded.

## Scheduled Tasks

For loops or periodic work, use `Effect.repeat` or `Effect.schedule` with `Effect.forkScoped` in the layer definition.

## Preferred Effect services

In effectified services, prefer yielding existing Effect services over dropping down to ad hoc platform APIs.

Prefer these first:

- `FileSystem.FileSystem` instead of raw `fs/promises` for effectful file I/O
- `ChildProcessSpawner.ChildProcessSpawner` with `ChildProcess.make(...)` instead of custom process wrappers
- `HttpClient.HttpClient` instead of raw `fetch`
- `Path.Path` instead of mixing path helpers into service code when you already need a path service
- `Config` for effect-native configuration reads
- `Clock` / `DateTime` for time reads inside effects

## Child processes

For child process work in services, yield `ChildProcessSpawner.ChildProcessSpawner` in the layer and use `ChildProcess.make(...)`.

Keep shelling-out code inside the service, not in callers.

## Shared leaf models

Shared schema or model files can stay outside the service namespace when lower layers also depend on them.

That is fine for leaf files like `schema.ts`. Keep the service surface in the owning namespace.

## Migration checklist

Service-shape migrated (single namespace, traced methods, `InstanceState` where needed).

This checklist is only about the service shape migration. Many of these services still keep `makeRuntime(...)` plus async facade exports; that facade-removal phase is tracked separately in `facades.md`.

- [x] `Account` — `account/index.ts` (Effect service API exists, has no instance state, has no async/sync compatibility exports for account operations, CLI account callers enter `Account.Service` through Effect boundaries, and is covered by `bun test test/account/effect-service.test.ts`)
- [x] `Agent` — `agent/agent.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for `get/list/defaultAgent/generate`, callers enter `Agent.Service` through Effect boundaries, and is covered by `bun test test/agent/effect-service.test.ts`)
- [x] `AppFileSystem` — stale checklist path resolved for this branch; `src/filesystem/index.ts` is absent. Current filesystem helper is `src/util/filesystem.ts`, and the broader consolidation remains tracked below.
- [x] `Auth` — `auth/index.ts` (Effect service API exists, has no instance state, has no async compatibility exports for credential operations, callers enter `Auth.Service` through Effect boundaries, and is covered by `bun test test/auth/effect-service.test.ts test/provider/auth-effect-service.test.ts`)
- [x] `Bus` — `bus/index.ts` (Effect service API exists for `publish/subscribe/once/subscribeAll`, uses `InstanceState`, has no direct `Instance.*` reads or `Instance.state`, keeps compatibility exports because bus is core event plumbing excluded from normal facade removal, and is covered by `bun test test/bus/effect-service.test.ts test/session/session-module-audit-suite.test.ts`)
- [x] `Command` — `command/index.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for `get/list`, and is covered by `bun test test/command/effect-service.test.ts`)
- [x] `Config` — `config/config.ts` (Effect service API exists for `get/getGlobal/update/updateGlobal/directories`, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for config operations, callers enter `Config.Service` through Effect boundaries, and is covered by `bun test test/config/effect-service.test.ts test/cli/network.test.ts test/cli/_network-precise.test.ts test/mcp/effect-service.test.ts test/session/session-module-audit-suite.test.ts`)
- [x] `ConnectorAuth` — `connectors/auth.ts` (Effect service API exists, has no instance state, has no async compatibility exports for connector credential operations, callers enter `ConnectorAuth.Service` through Effect boundaries, and is covered by `bun test test/connectors/auth-effect-service.test.ts`)
- [x] `Discovery` — stale checklist item resolved for this branch; `src/skill/discovery.ts` is absent and `rg -n "skill/discovery|Discovery\\.Service|from [\"']@/skill/discovery|from [\"']\\.\\/discovery" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `File` — `file/index.ts` (Effect service API exists for `init/status/read/list/search`, uses Effect-provided instance context through `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for file operations, callers enter `File.Service` through Effect boundaries, and is covered by `bun test test/file/effect-service.test.ts test/file/watcher-effect-service.test.ts`)
- [x] `FileWatcher` — `file/watcher.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports, and is covered by `bun test test/file/watcher-effect-service.test.ts`)
- [x] `Format` — `format/index.ts` / `format/formatter.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports, and is covered by `bun test test/format/effect-service.test.ts`)
- [x] `Installation` — `installation/index.ts` (Effect service API exists for `info/method/latest/upgrade`, has no instance state, keeps only pure constants/helpers outside the service, has no async compatibility exports, and is covered by `bun test test/installation/effect-service.test.ts`)
- [x] `LSP` — `lsp/index.ts` (Effect service API exists for `init/status/hasClients/touchFile/diagnostics/hover/workspaceSymbol/documentSymbol/definition/references/implementation/prepareCallHierarchy/incomingCalls/outgoingCalls`, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for LSP operations, callers enter `LSP.Service` through Effect boundaries, and is covered by `bun test test/lsp/effect-service.test.ts`)
- [x] `MCP` — `mcp/index.ts` (Effect service API exists for `add/status/clients/connect/disconnect/tools/prompts/resources/getPrompt/readResource/startAuth/authenticate/finishAuth/removeAuth/supportsOAuth/hasStoredTokens/getAuthStatus`, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for MCP operations, callers enter `MCP.Service` through Effect boundaries, and is covered by `bun test test/mcp/effect-service.test.ts test/mcp/auth-effect-service.test.ts test/command/effect-service.test.ts test/session/session-module-audit-suite.test.ts`)
- [x] `McpAuth` — `mcp/auth.ts` (Effect service API exists, has no instance state, has no async compatibility exports for credential operations, and is covered by `bun test test/mcp/auth-effect-service.test.ts`)
- [x] `Permission` — `permission/index.ts` removed as unused legacy surface; evidence: `rg -n 'from ["'\\''"]@/permission["'\\''"]|Permission\\.(ask|respond|list|pending)\\(' packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `PermissionNext` — `permission/next.ts` (Effect service API exists, uses `InstanceState`, has no async compatibility exports, and is covered by `bun test test/permission/effect-service.test.ts` for accept and reject flows)
- [x] `Plugin` — `plugin/index.ts` (Effect service API exists for `trigger/list/init`, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for plugin operations, callers enter `Plugin.Service` through Effect boundaries, and is covered by `bun test test/plugin/effect-service.test.ts test/provider/auth-effect-service.test.ts test/tool/registry-effect-service.test.ts`)
- [x] `Project` — `project/project.ts` (Effect service API exists for `fromDirectory/discover/setInitialized/list/update/sandboxes/removeSandbox`, `UpdateInput` is exported separately for route validation, has no async compatibility exports for project operations, callers enter `Project.Service` through Effect boundaries, and is covered by `bun test test/project/effect-service.test.ts`)
- [x] `ProviderAuth` — `provider/auth.ts` (Effect service API exists, uses `InstanceState`, has no async compatibility exports, and is covered by `bun test test/provider/auth-effect-service.test.ts` plus the `ProviderAuth contracts` slice in `test/provider/core.test.ts`)
- [x] `Pty` — `pty/index.ts` (Effect service API exists, uses `InstanceState` with scoped session cleanup, has no direct `Instance.*` reads, has no async compatibility exports, and is covered by `bun test test/pty/effect-service.test.ts`)
- [x] `Question` — `question/index.ts` (Effect service API exists, uses `InstanceState`, has no async compatibility exports, and is covered by `bun test test/question/effect-service.test.ts`, including shared layer runtime state sharing)
- [x] `SessionStatus` — `session/status.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for `get/list/set/hydrate`, and is covered by `bun test test/session/status.test.ts test/session/status-precise.test.ts test/session/status.benchmark.test.ts`)
- [x] `Skill` — `skill/skill.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for stateful operations, and is covered by `bun test test/skill/effect-service.test.ts`)
- [x] `Snapshot` — `snapshot/index.ts` (Effect service API exists, uses Effect-provided instance context through `InstanceState.context`, has no direct `Instance.*` reads, has no async compatibility exports for `init/cleanup/track/patch/restore/revert/diff/diffFull`, and is covered by `bun test test/snapshot/effect-service.test.ts`)
- [x] `ToolRegistry` — `tool/registry.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports, and is covered by `bun test test/tool/registry-effect-service.test.ts`)
- [x] `Truncate` — `tool/truncation.ts` (Effect service API exists, has no async compatibility exports, and is covered by `bun test test/tool/truncation-effect-service.test.ts`)
- [x] `Vcs` — `project/vcs.ts` (Effect service API exists, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports, and is covered by `bun test test/project/vcs-effect-service.test.ts`)
- [x] `Worktree` — `worktree/index.ts` (Effect service API exists, has no direct `Instance.*` reads, has no async compatibility exports for `create/remove/reset/list`, callers are migrated in the workspace adaptor and current worktree route batches, and is covered by `bun test test/worktree/list.test.ts`)

- [x] `Session` — `session/index.ts` (Effect service API exists for create/fork/touch/createNext/plan/get/getAnyProject/getShare/share/unshare/update/diff/messages/list/children/remove/message mutation/initialize operations, uses `InstanceState.context`, has no direct `Instance.*` reads, has no async compatibility exports for session operations, callers enter `Session.Service` through Effect boundaries, and is covered by `bun test test/session/effect-service.test.ts test/session/session.test.ts` plus the current session slice)
- [x] `SessionProcessor` — `session/processor.ts` (Effect service API exists for `create`, has no direct `Instance.*` reads, keeps the existing synchronous factory as a compatibility boundary for streaming callers, and is covered by `bun test test/session/processor-effect-service.test.ts`)
- [x] `SessionPrompt` — `session/prompt.ts` (Effect service API exists for `assertNotBusy/prompt/resolvePromptParts/cancel/loop/shell/command`, uses `InstanceState` for prompt busy/cancel state, has no direct `Instance.*` reads, has no async/sync compatibility exports for prompt operations, callers enter `SessionPrompt.Service` through Effect boundaries, and is covered by `bun test test/session/prompt-effect-service.test.ts` plus `bun run typecheck`)
- [x] `SessionCompaction` — `session/compaction.ts` (Effect service API exists for `isOverflow/editContext/prune/process/create`, uses Effect-provided instance context through `InstanceState.context`, has no direct `Instance.*` reads, has no async compatibility exports, callers enter `SessionCompaction.Service` through Effect boundaries, and is covered by `bun test test/session/session-module-audit-suite.test.ts`)
- [x] `SessionSummary` — `session/summary.ts` (Effect service API exists for `summarize/diff/computeDiff`, route schemas are exported separately as `SummarizeInput` / `DiffInput`, has no direct `Instance.*` reads, has no async compatibility exports, callers enter `SessionSummary.Service` through Effect boundaries, and is covered by `bun test test/session/summary-effect-service.test.ts`)
- [x] `SessionRevert` — `session/revert.ts` (Effect service API exists for `revert/unrevert/cleanup`, route schemas remain pure exports, has no async compatibility exports, callers enter `SessionRevert.Service` through Effect boundaries, and is covered by `bun test test/session/session-lifecycle.test.ts`)
- [x] `Instruction` — stale checklist item resolved for this branch; `src/session/instruction.ts` is absent.
- [x] `SystemPrompt` — `session/system.ts` (Effect service API exists for `environment/custom/skills`, pure `header/instructions/provider` helpers remain outside the service, has no direct `Instance.*` reads, has no async compatibility exports for `environment/custom/skills`, and is covered by `bun test test/session/system.test.ts test/session/system-effect-service.test.ts`)
- [x] `Provider` — `provider/provider.ts` (Effect service API exists for `list/getProvider/getModel/getLanguage/getImageModel/closest/getSmallModel/defaultModel`, uses `InstanceState`, has no direct `Instance.*` reads, has no async compatibility exports for provider operations, callers enter `Provider.Service` through Effect boundaries, and is covered by `bun test test/provider/effect-service.test.ts` plus `bun run typecheck`)
- [x] `Storage` — `storage/storage.ts` (Effect service API exists for `read/write/update/remove/list`, has no async compatibility exports for those operations, callers enter `Storage.Service` through Effect boundaries, and is covered by `bun test test/storage/effect-service.test.ts test/session/session-lifecycle.test.ts test/session/session-module-audit-suite.test.ts test/share/effect-service.test.ts test/project/effect-service.test.ts test/permission/effect-service.test.ts`)
- [x] `ShareNext` — `share/share-next.ts` (Effect service API exists for `url/init/create/remove/publicData`, has no async compatibility exports, callers enter `ShareNext.Service` through Effect boundaries, and is covered by `bun test test/share/effect-service.test.ts`)
- [x] `SessionTodo` — `session/todo.ts` (Effect service API exists for `get/update/init`, schemas and events remain pure exports, has no async compatibility exports for todo operations, callers enter `Todo.Service` through Effect boundaries, and is covered by `bun test test/session/todo.test.ts test/session/session-module-audit-suite.test.ts`)

Still open at the service-shape level:

- [ ] `SyncEvent` — `sync/index.ts` (deferred pending sync with James)
- [ ] `Workspace` — `control-plane/workspace.ts` (deferred pending sync with James)

## Tool migration

Tool-specific migration guidance and checklist live in `tools.md`.

## Effect service adoption in already-migrated code

Some already-effectified areas still use raw `Filesystem.*` or `Process.spawn` in their implementation or helper modules. These are low-hanging fruit — the layers already exist, they just need the dependency swap.

### `Filesystem.*` → `AppFileSystem.Service` (yield in layer)

- [ ] `config/config.ts` — `installDependencies()` now uses `AppFileSystem`
- [ ] `provider/provider.ts` — recent model state now reads via `AppFileSystem.Service`

### `Process.spawn` → `ChildProcessSpawner` (yield in layer)

- [x] `format/formatter.ts` — `air` and `uv` capability probes already use `Bun.spawn` (Bun-native, A2 satisfied for these sites). Evidence: `rg -n "Process\\.spawn" src` returns no matches; `Bun.which` + `Bun.spawn` is the surviving shape.
- [x] `lsp/server.ts` — installer / `--help` probe helpers already use `Bun.spawn`. Long-lived LSP children remain on `child_process.spawn` because the LSP `Handle` needs Node-style `Readable` / `Writable` streams; converting those is a separate stream-adapter task and not part of the original A2 scope. Evidence: `rg -n "Process\\.spawn" src/lsp/server.ts` returns no matches.

## Filesystem consolidation

`util/filesystem.ts` is still used widely across `src/`, and raw `fs` / `fs/promises` imports still exist in multiple tooling and infrastructure files. As services and tools are effectified, they should switch from `Filesystem.*` to yielding `AppFileSystem.Service` where possible — this should happen naturally during each migration, not as a separate sweep.

Tool-specific filesystem cleanup notes live in `tools.md`.

## Primitives & utilities

- [x] `util/lock.ts` — current `Lock.{read,write}` call sites are all inside plain `async function` impls (`src/worktree/index.ts`, `src/snapshot/index.ts`, `src/auth/index.ts`, `src/account/index.ts`, `src/sync/index.ts`, `src/bun/index.ts`, `src/storage/storage.ts`), not inside `Effect.gen`. Per the spec rule ("replace uses in Effect code with Semaphore; keep for sync-only code"), the legacy primitive stays. Each call site flips to `Effect.Semaphore` when its containing function effectifies. Evidence: `rg -n "Lock\\.(read|write)" src` shows zero matches inside `Effect.fn(...)` or `Effect.gen(...)` bodies on this branch.
- [x] `util/flock.ts` — current `Flock.{acquire,withLock}` call sites are all inside plain `async function` bodies (`src/brain/index.ts`, `src/plugin/install.ts`, `src/plugin/meta.ts`). Per the same rule as `util/lock.ts`, the legacy primitive stays until those callers effectify. The `Effect.repeat` + `addFinalizer` shape will land per-caller as each module effectifies. Evidence: `rg -n "Flock\\." src` shows zero matches inside `Effect.fn(...)` or `Effect.gen(...)` bodies on this branch.
- [x] `util/process.ts` — stale checklist item resolved on this branch; the file only exports `Process.RunFailedError` and no child-process spawn wrapper. Evidence: `rg -n "Process\\.RunFailedError|from [\"']@/util/process|from [\"'].*util/process" packages/nikcli/src packages/nikcli/test`.
- [x] `util/lazy.ts` — Effect-resident `lazyAsync` callers swapped to `Effect.cached`. Migrated: `src/pty/index.ts` (bun-pty spawn loader inside `Pty.layer`), `src/storage/storage.ts` (storage state with migrations inside `Storage.layer`). Remaining `lazy(...)` and `lazyAsync(...)` are kept where the call site is plain sync/async (Hono route bootstrap, `tool/bash.ts` parser, `sync/SyncStorage` async namespace, `file/time.ts` not-yet-effectified) — they will move when those modules effectify.

## Destroying the facades

This phase is no longer broadly open. There are 5 `makeRuntime(...)` call sites under `src/`, and only a small subset are still ordinary facade-removal targets. The live checklist now lives in `facades.md`.

These facades exist because cyclic imports used to force each service to build its own independent runtime. Now that the layer DAG is acyclic and `AppRuntime` (`src/effect/app-runtime.ts`) composes everything into one `ManagedRuntime`, we're removing them.

### Process

For each service, the migration is roughly:

1. **Find callers.** `grep -n "Namespace\.(methodA|methodB|...)"` across `src/` and `test/`. Skip the service file itself.
2. **Migrate production callers.** For each effectful caller that does `Effect.tryPromise(() => Namespace.method(...))`:
   - Add the service to the caller's layer R type (`Layer.Layer<Self, never, ... | Namespace.Service>`)
   - Yield it at the top of the layer: `const ns = yield* Namespace.Service`
   - Replace `Effect.tryPromise(() => Namespace.method(...))` with `yield* ns.method(...)` (or `ns.method(...).pipe(Effect.orElseSucceed(...))` for the common fallback case)
   - Add `Layer.provide(Namespace.defaultLayer)` to the caller's own `defaultLayer` chain
3. **Fix tests that used the caller's raw `.layer`.** Any test that composes `Caller.layer` (not `defaultLayer`) needs to also provide the newly-required service tag. The fastest fix is usually switching to `Caller.defaultLayer` since it now pulls in the new dependency.
4. **Migrate test callers of the facade.** Tests calling `Namespace.method(...)` directly get converted to full effectful style using `testEffect(Namespace.defaultLayer)` + `it.live` / `it.effect` + `yield* svc.method(...)`. Don't wrap the test body in `Effect.promise(async () => {...})` — do the whole thing in `Effect.gen` and use `AppFileSystem.Service` / `tmpdirScoped` / `Effect.addFinalizer` for what used to be raw `fs` / `Bun.write` / `try/finally`.
5. **Delete the facades.** Once `grep` shows zero callers, remove the `export async function` block AND the `makeRuntime(...)` line from the service namespace. Also remove the now-unused `import { makeRuntime }`.

### Pitfalls

- **Layer caching inside tests.** `testEffect(layer)` constructs the Storage (or whatever) service once and memoizes it. If a test then tries `inner.pipe(Effect.provide(customStorage))` to swap in a differently-configured Storage, the outer cached one wins and the inner provision is a no-op. Fix: wrap the overriding layer in `Layer.fresh(...)`, which forces a new instance to be built instead of hitting the memoMap cache. This lets a single `testEffect(...)` serve both simple and per-test-customized cases.
- **`Effect.tryPromise` → `yield*` drops the Promise layer.** The old code was `Effect.tryPromise(() => Storage.read(...))` — a `tryPromise` wrapper because the facade returned a Promise. The new code is `yield* storage.read(...)` directly — the service method already returns an Effect, so no wrapper is needed. Don't reach for `Effect.promise` or `Effect.tryPromise` during migration; if you're using them on a service method call, you're doing it wrong.
- **Raw `.layer` test callers break silently in the type checker.** When you add a new R requirement to a service's `.layer`, any test that composes it raw (not `defaultLayer`) becomes under-specified. `tsgo` will flag this — the error looks like `Type 'Storage.Service' is not assignable to type '... | Service | TestConsole'`. Usually the fix is to switch that composition to `defaultLayer`, or add `Layer.provide(NewDep.defaultLayer)` to the custom composition.
- **Tests that do async setup with `fs`, `Bun.write`, `tmpdir`.** Convert these to `AppFileSystem.Service` calls inside `Effect.gen`, and use `tmpdirScoped()` instead of `tmpdir()` so cleanup happens via the scope finalizer. For file operations on the actual filesystem (not via a service), a small helper like `const writeJson = Effect.fnUntraced(function* (file, value) { const fs = yield* AppFileSystem.Service; yield* fs.makeDirectory(path.dirname(file), { recursive: true }); yield* fs.writeFileString(file, JSON.stringify(value, null, 2)) })` keeps the migration tests clean.

### Migration log

- `SessionStatus` — migrated 2026-05-06. Replaced route, workspace mirror, prompt, processor, and tests with `SessionStatus.Service` through Effect boundaries; removed the sync `get/list/set/hydrate` facade.
- `ShareNext` — migrated 2026-05-06. `share/share-next.ts` now exposes `ShareNext.Service`; session share/unshare, bootstrap, public share routes, and CLI share import callers enter the service through Effect boundaries.
- `SessionTodo` — migrated 2026-05-06. `session/todo.ts` now exposes `Todo.Service` for `get/update/init`; todo tool, session route, bootstrap, and audit tests enter the service through Effect boundaries.
- `Storage` — migrated 2026-05-06. `storage/storage.ts` now exposes `Storage.Service` for `read/write/update/remove/list`; production/test callers enter the service through Effect boundaries, and the async operation facades were removed.
- `File` — migrated 2026-05-06. `file/index.ts` now exposes `File.Service` for `init/status/read/list/search`; project bootstrap, file routes, and debug CLI enter the service through Effect boundaries, and direct `Instance.*` reads were removed from the module.
- `LSP` — migrated 2026-05-06. `lsp/index.ts` now exposes `LSP.Service` for client lifecycle, diagnostics, symbols, and navigation operations; bootstrap, status route, debug CLI, prompt assembly, and tools enter the service through Effect boundaries.
- `MCP` — migrated 2026-05-06. `mcp/index.ts` now exposes `MCP.Service` for server lifecycle, tool/prompt/resource access, and OAuth status/flows; MCP routes, experimental resources, CLI auth/list/debug/logout, command prompt loading, and session resource/tool assembly enter the service through Effect boundaries.
- `SessionRunState` — historical note from an older branch; no current checklist credit is inferred from it.
- `Account` — migrated 2026-05-06. CLI account callers now enter `Account.Service` through Effect boundaries; async/sync account operation facades removed.
- `Instruction` — historical note from an older branch; `session/instruction.ts` is not present on this branch and remains unchecked above.
- `FileWatcher` — migrated 2026-04-11. Callers in `project/bootstrap.ts` and test converted; facade removed.
- `Question` — migrated 2026-04-11. Callers in `server/routes/instance/question.ts` and test converted; facade removed.
- `Truncate` — migrated 2026-04-11. Caller in `tool/tool.ts` and test converted; facade removed.

## Route handler effectification

Route-handler migration guidance and checklist live in `routes.md`.
