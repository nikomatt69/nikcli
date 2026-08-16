# Effect dependency injection: instance scoping, runtime, and HTTP serving

Research notes on how nikcli keys per-instance Effect state, bootstraps instances, exposes
services as `Layer`s, and serves the HTTP API over Effect `HttpApi`. All paths are relative
to `packages/nikcli/` and all line references are rough ranges from the code as read.

---

## 1. InstanceContext definition and per-instance runtime keying

**`src/effect/instance-ref.ts`** defines the shape that represents "the current instance" to
an Effect fiber.

- `InstanceContext` is a plain interface with three fields — `directory`, `worktree`, and
  `project: Project.Info` (`instance-ref.ts:4-8`).
- It is wrapped in an Effect service tag `InstanceRef` via
  `Context.Service<InstanceRef, InstanceContext>()("@nikcli/InstanceRef")`
  (`instance-ref.ts:14`). A sibling `WorkspaceRef` carries `WorkspaceContext` (`{ id?: string }`,
  `instance-ref.ts:10-15`).
- Accessors: `currentInstance = Effect.serviceOption(InstanceRef)` and
  `currentWorkspace = Effect.serviceOption(WorkspaceRef)` (`instance-ref.ts:17-18`).
- `instance` (`instance-ref.ts:20-25`) unwraps the option and fails with
  `"No active nikcli instance in Effect context"` when no service is present.
- `locallyInstance` / `locallyWorkspace` (`instance-ref.ts:29-41`) use
  `Effect.provideService` to inject the value into a scoped region, with the return type
  narrowed to `Exclude<R, InstanceRef>` — i.e. they _satisfy_ the requirement instead of
  threading it out.

The **runtime itself is keyed per layer and per environment** in `src/effect/runtime.ts`:

- `runtimes` is a `WeakMap<Layer, Map<string, ManagedRuntime>>` (`runtime.ts:8`).
- `runtimeScope()` (`runtime.ts:47-50`) returns `"default"`, or in test mode a string keyed
  by `NIKCLI_TEST_HOME` + `NIKCLI_DB`, so separate test databases get separate runtimes.
- `runtimeFor(layer)` (`runtime.ts:52-65`) looks up (or lazily creates) the
  `ManagedRuntime` for that `(layer, scope)` pair, then `runPromiseWithLayer` runs through
  it (`runtime.ts:67-72`).

Separately, the legacy ALS-based instance store is keyed by **directory** in
`src/project/instance.ts`:

- `context = Context.create<Context>("instance")` (an AsyncLocalStorage) and
  `cache = new Map<string, Promise<Context>>()` (`instance.ts:21-22`), keyed by the
  normalized directory.

---

## 2. withInstanceAsync / InstanceBootstrap bootstrap flow

**`src/effect/with-instance.ts:44-79`** — `withInstanceAsync` is the plain-async entry point
that replaces `Instance.provide({ directory, init, fn })`.

- If `init` is supplied, it calls `Instance.provide({ directory, init, fn })`
  (`with-instance.ts:48-52`), where `fn` rebuilds an `InstanceContext` from the ALS getters
  `Instance.directory` / `.worktree` / `.project` (`with-instance.ts:53-57`), wraps the body
  in `Effect.tryPromise`, and injects it with `locallyInstance` (plus `locallyWorkspace` when
  `workspaceID` is set) (`with-instance.ts:58-64`).
- It runs via `AppRuntime.runPromiseExit` and rethrows non-success exits with
  `Cause.squash(exit.cause)` (`with-instance.ts:65-68`).
- With no `init`, it simply delegates to `withInstance` → `InstanceScope.with`
  (`with-instance.ts:72-78`); `withInstance` (`with-instance.ts:26-28`) is
  `AppRuntime.runPromise(InstanceScope.with(input, effect))`.

**`src/project/instance.ts:42-84`** — `Instance.provide` is where the per-directory context
is actually created and cached.

- Normalizes the directory with `realpathSync` (falling back to `path.resolve`)
  (`instance.ts:34-40`, `instance.ts:44`).
- Caches a single in-flight promise per directory (`instance.ts:45-46`, `instance.ts:66-67`).
- The creation promise runs `Project.Service.fromDirectory(directory)` via `runService`
  (`instance.ts:49-54`) to get `{ project, sandbox }`, builds the `Context` including a
  `disposers` set (`instance.ts:55-60`), and runs `input.init?.()` once inside the ALS scope
  (`instance.ts:61-63`).
- On creation failure the cache entry is deleted so a later call can retry
  (`instance.ts:70-79`).

**`src/project/bootstrap.ts:50-249`** — `InstanceBootstrap` is the one-time per-directory
`init` hook passed to `withInstanceAsync` (see `server-router.ts:47` and `:229`).

- Blocks on plugin init (`bootstrap.ts:52-57`) and LSP init (`bootstrap.ts:80-85`).
- Fire-and-forget `background(...)` inits for share, format, file-watcher, file, vcs,
  snapshot, truncate, and todo (`bootstrap.ts:58-152`), each rejecting into a log warning
  (`bootstrap.ts:44-48`).
- Installs sync projectors and the session v2 projection (`bootstrap.ts:155-170`), then
  awaits `Delegation.init`, `Monitor.reconcile`, `LoopEngine.restore`,
  `MissionOrchestrator.restore`, and `Routine.restoreSchedulers`
  (`bootstrap.ts:171-190`).
- Arms the brain scheduler (`bootstrap.ts:197-201`), starts config hot-reload by registering
  a disposer for `InstanceReload.watch()` (`bootstrap.ts:206-213`), registers the session
  sync bridge and remote sync (`bootstrap.ts:219-237`), and subscribes to
  `Command.Event.Executed` to mark the project initialized on `INIT`
  (`bootstrap.ts:239-248`).

---

## 3. Role of each `src/effect/` file and how they relate

Barrel: `src/effect/index.ts:1-6` re-exports `InstanceState`, `instance-ref`,
`instance-scope`, `runtime`, `run-service`, and `with-instance`.

- **`instance-ref.ts`** — the _types and service tags_. Defines `InstanceContext` /
  `WorkspaceContext`, the `InstanceRef` / `WorkspaceRef` context services, the accessor
  effects (`currentInstance`, `instance`, `workspace`), and the `locallyInstance` /
  `locallyWorkspace` injectors (`instance-ref.ts:4-41`).
- **`instance-scope.ts`** — `InstanceScope.with(input, effect)` bridges an Effect into the
  ALS scope of `input.directory`. It runs inside `Instance.provide` and forks the inner
  effect onto `AppRuntime`, preserving the full `Exit` (typed failures, defects,
  interruption) and interrupting the inner fiber when the caller is interrupted
  (`instance-scope.ts:11-68`). It composes `locallyInstance`/`locallyWorkspace` from
  `instance-ref` (`instance-scope.ts:40-42`).
- **`instance-state.ts`** — per-instance `ScopedCache` over the `InstanceContext`. Exports
  `context` (with an ALS fallback), `directory`/`worktree`/`project` derived effects, and
  `make`/`get`/`invalidateReloadable` for hot-reload-aware per-instance caches
  (`instance-state.ts:5-73`). It consumes `instance` from `instance-ref`.
- **`run-service.ts`** — `runService(module, effect, wrap?)` runs an effect against a
  module's `defaultLayer` (`run-service.ts:8-16`), delegating to `runPromiseWithLayer` from
  `runtime`. Used by `Project` (`project/instance.ts:9-13`) and the bootstrap helpers
  (`bootstrap.ts:26-40`).
- **`runtime.ts`** — the `ManagedRuntime` factory and memoization layer. `makeRuntime`
  merges `LogRedirect` + `Observability.layer` into every runtime (`runtime.ts:37-43`);
  `AppRuntime` is the empty-layer runtime (`runtime.ts:45`); `runtimeFor` memoizes per
  layer+scope (`runtime.ts:52-65`); `runPromiseWithLayer` / `runPromiseExitWithLayer` /
  `runPromise` run through those runtimes (`runtime.ts:67-98`); `withCurrentInstance`
  re-injects `InstanceRef` from the ALS when a fiber lacks it (`runtime.ts:81-94`).
- **`with-instance.ts`** — the outermost entry boundary for _plain async_ callers (CLI, TUI
  bootstrap, server middleware). It adapts `InstanceScope.with` to `Promise` and keeps the
  legacy `Instance.provide({ init, fn })` shape alive (`with-instance.ts:26-79`).

Relation: `with-instance` → `instance-scope` → `instance-ref` (injection) + `runtime`
(execution). `instance-state` builds caches on top of `instance-ref`. `run-service` is a
thin convenience over `runtime`. Everything funnels execution through `runtime.ts`.

---

## 4. Services provided via Effect layers (concrete `Layer` examples)

The dominant pattern is `Context.Service` tag + `Layer.succeed(Service, Service.of({...}))`,
with implementation functions wrapped in `Effect.tryPromise`.

- **`src/project/project.ts:117`** declares the tag:
  `class Service extends Context.Service<Service, Interface>()("Project.Service")`.
  The layer is `Layer.succeed(Service, Service.of({ fromDirectory, discover, ... }))`
  (`project.ts:551-566`), each method an `Effect.tryPromise` over an `*Impl` function, and
  `defaultLayer = layer` (`project.ts:568`).
- **`src/session/index.ts:888`** declares `Session.Service`; the layer is
  `Layer.succeed(Service, Service.of({...}))` (`session/index.ts:906-1098`) where almost
  every method first reads `InstanceState.context` and passes `ctx` into the `*Impl`
  function (e.g. `create` at `:909-929`, `get` at `:961-969`). `defaultLayer = layer`
  (`session/index.ts:1100`).
- **`src/config/config.ts:2212-2250`** uses the _effectful_ variant `Layer.effect`, because
  the service needs dependencies: it reads `ConfigPaths.Service` and
  `AppFileSystem.Service`, builds a scoped state via `makeScopedState`, and defines `get` /
  `update` / `updateGlobal` as `Effect.fn` that read `InstanceState.get(scopedState)` and
  invalidate the scoped cache on update (`config.ts:2215-2231`). The `defaultLayer` then
  provides those two dependencies: `layer.pipe(Layer.provide(ConfigPaths.defaultLayer),
Layer.provide(AppFileSystem.defaultLayer))` (`config.ts:2252-2255`).
- **`src/server/httpapi/public.ts:349-380`** composes the whole HTTP API from many handler
  lives: `ApiLive.pipe(Layer.provide(Layer.mergeAll(...)))`, with each group's live layer
  providing its own dependencies, e.g. `ProjectHandlersLive.pipe(Layer.provide(ProjectCopy.defaultLayer))`
  (`public.ts:366`), `QuestionHandlersLive.pipe(Layer.provide(Question.defaultLayer))`
  (`public.ts:369`), and `SessionHandlersLive.pipe(Layer.provide(SessionHttpApi.DependenciesLive))`
  (`public.ts:374`).

---

## 5. HTTP server usage (Server.listenEffect, Server.fetch) and the test escape hatch

**`src/server/server.ts`** exposes both the raw `Bun.serve` path and the Effect `HttpServer`
path, sharing the same request pipeline.

- `pipeline()` lazily builds and memoizes a `ServerRouter.Fetch` from `ServerRouter.make`
  with a `fallback`, CORS whitelist, and auth flags (`server.ts:52-59`).
- `fetch(request)` runs the pipeline (`server.ts:61-63`); this is the in-process entry point
  used by clients and by the Effect server.
- `listen(opts)` drives `Bun.serve` directly (`server.ts:69-160`).
- `listenEffect(opts)` (`server.ts:162-198`) builds `BunHttpServer.layer`, wraps
  `fetch(request.source)` as an `HttpServerRequest` handler, and serves it via
  `ManagedRuntime.make(HttpServer.serve(app).pipe(Layer.provideMerge(serverLayer)))`
  (`server.ts:173-184`); it returns `{ hostname, port, url, stop: () => runtime.dispose() }`
  (`server.ts:190-197`).

**`src/server/server-router.ts`** is the shared router/instance middleware.

- `context(request)` resolves `directory` from query/header/cwd, a session ID from the path,
  and a workspace (`server-router.ts:60-78`).
- `dispatch` (`server-router.ts:195-251`) handles instance-less paths globally, resolves the
  instance, and wraps everything in `withInstanceAsync({ directory, workspaceID, init:
InstanceBootstrap }, ...)` (`server-router.ts:226-250`) — so the whole per-instance request
  body runs in instance scope with bootstrap as the one-time `init`. Raw public routes,
  `HttpApiBridge`, and the fallback are all dispatched inside that scope.
- `make` (`server-router.ts:253-282`) adds body-limit, CORS preflight, auth, and `mapError`
  (`server-router.ts:137-189`, which maps `__http` markers, `Session.BusyError` → 409, and
  the literal `"NotFoundError"` wire name → 404).

**`src/server/httpapi/bridge.ts`** is the schema-encoded `HttpApi` bridge.

- `testAuthOverride` + `overrideAuth` (`bridge.ts:25-28`) is a test seam because `Flag` is
  captured at module-load time and can't be flipped by the test runner.
- `layer = Layer.mergeAll(PublicHttpApi.layer.provide(BunHttpServer.layerHttpServices,
BunFileSystem.layer, BunPath.layer), LogRedirect)` (`bridge.ts:317-322`), and
  `webHandler = HttpRouter.toWebHandler(layer, { memoMap: sharedMemoMap }).handler`
  (`bridge.ts:325-327`).
- `handleGlobal` (`bridge.ts:342-357`) serves instance-less routes with no instance context;
  `handle` (`bridge.ts:359-397`) serves instance routes and injects `InstanceRef` from the
  ALS via `Context.make(InstanceRef, { directory, worktree, project })`
  (`bridge.ts:389-396`). Raw streaming/SSE/webhook specials bypass the router
  (`bridge.ts:363-380`).

**Test escape hatch:**

- `test/helpers/sqlite.ts:49-90` — `withIsolatedDatabase` points `NIKCLI_TEST_HOME` at a
  fresh temp dir and sets `NIKCLI_DB` to a private `data/nikcli.db`, disables project config,
  and restores the previous env (plus closes the DB and removes the temp dir) in `finally`.
  The `skip` option (`sqlite.ts:33-40`, `:53-58`) bypasses isolation for tests that need the
  global database.
- `test/helpers/tool-context.ts:71-134` — `makeToolContext` hand-rolls a `Tool.Context`
  with deterministic IDs and stub `ask`/`metadata`/`progress` recorders (with a `denyAsk`
  mode), and `withProjectDirectory` (`tool-context.ts:132-134`) wraps a body in
  `Instance.provide({ directory, fn })` so tool bodies can read `Instance.directory`.

---

## 6. Notable patterns: ManagedRuntime lifecycle, scoping, cleanup, per-instance teardown

- **`src/effect/runtime.ts` — runtime lifecycle.** `makeRuntime` builds every runtime from
  `Layer.mergeAll(layer, LogRedirect, Observability.layer)` with a shared memo map so one
  exporter/HttpClient is reused (`runtime.ts:37-43`). `AppRuntime = makeRuntime(Layer.empty)`
  is the global default (`runtime.ts:45`). `runtimeFor` memoizes runtimes per layer and, in
  test mode, per `NIKCLI_TEST_HOME`/`NIKCLI_DB` (`runtime.ts:47-65`), giving per-instance
  (test) isolation without a process boundary. `withCurrentInstance` re-provides
  `InstanceRef` from the ALS if the fiber doesn't already carry it (`runtime.ts:81-94`).
- **`src/effect/instance-scope.ts:12-68` — structured scoping.** `InstanceScope.with` uses
  `Effect.callback` + a forked fiber so the inner effect's full `Exit` (defects, typed
  failures) is replayed into the caller, and interruption propagates both directions: the
  canceler interrupts the inner fiber and awaits its finalizers (`instance-scope.ts:61-66`).
- **`src/effect/instance-state.ts:19-69` — per-instance, reload-aware caching.** A global
  `reloadable` set tracks `ScopedCache`s keyed by directory (`instance-state.ts:29`,
  `:35-49`); `invalidateReloadable` invalidates each entry and drops caches whose scope has
  already closed (`instance-state.ts:58-68`). `get` scopes the cache fetch to the current
  instance's directory (`instance-state.ts:71-73`).
- **`src/project/state.ts:12-66` — per-instance teardown.** `State.create` keys entries by a
  `root()` string (the instance directory) and memoizes by the `init` function identity
  (`state.ts:12-29`). `State.dispose(key)` runs each entry's `dispose` (guarded by a 10s
  "taking too long" warning timer), then clears the map only _after_ all disposal tasks
  settle (`state.ts:31-66`). `Instance.dispose` (`project/instance.ts:124-153`) publishes
  `Bus.InstanceDisposed`, runs `State.dispose(directory)` plus all registered `disposers`
  via `Promise.allSettled`, then deletes the directory's cache entry; `disposeAll`
  (`instance.ts:154-165`) iterates the whole cache.
