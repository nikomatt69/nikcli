# Catalog / Config / Plugin Lifecycle

| Field  | Value                                                                               |
| ------ | ----------------------------------------------------------------------------------- |
| Status | **Accepted and implemented**                                                        |
| Scope  | `src/effect/instance-state.ts`, `src/project/reload.ts`, `src/provider/provider.ts` |

The question this records: when provider, model, config, or plugin inputs change while an instance is open, what rebuilds, and who decides?

nikcli's answer is **per-instance caches with three invalidation channels** — a broad file-driven one, the same channel reached synchronously by the request that made the change, and a narrow provider-specific one — rather than a service reload graph or a transform pipeline.

## The Inputs That Change

| Input              | Changes when                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| Config documents   | A `nikcli.json` (global, worktree, or directory) is edited                  |
| Config directories | A file lands in a `.nikcli` directory (agents, commands, tools)             |
| models.dev catalog | The background refresh in `provider/models.ts` completes                    |
| Credentials        | `nikcli auth`, the TUI connect dialog, or an OAuth callback runs            |
| Plugins            | A plugin is installed, enabled, or hot-reloaded                             |
| Policy             | Provider availability changes (see [provider policy](./provider-policy.md)) |

## The Shape That Was Chosen

### 1. State is per instance, built lazily, and finalized on invalidation

`InstanceState.make(init, { reloadable })` allocates a `ScopedCache` keyed by instance directory, with infinite capacity and TTL. A service's state is built on first access for that directory and torn down by its own finalizers when invalidated.

`reloadable: true` is **opt-in**, and the opt-out cases are the interesting ones. The source names two:

- `format/index.ts` used to own the auto-format bus subscription. Formatting is now invoked explicitly, so that cache is reloadable.
- Runtime tool registrations from sdk-next. Those exist nowhere else, so they live in a **separate non-reloadable cache** in `tool/registry.ts`. The config-dir and `plugin.tool` list next to them is reloadable.

The rule that falls out: **a cache may be reloadable only if it can be rebuilt from files.** State that owns a live resource or accumulates runtime-only registrations must not be. A service that has both splits them.

### 2. Broad invalidation is file-driven and announced

`InstanceReload.watch()` watches the config surface of the instance: the global `nikcli.json`, the directory and worktree `nikcli.json`, and every config directory. It watches **parent directories rather than files**, because editors and `Config.update` replace files atomically (write + rename), which ends a file watch.

Changes debounce for 300ms, then `reload(files)`:

1. Publishes `instance.reload.started`.
2. Runs `InstanceState.invalidateReloadable(directory)` — every reloadable cache for that directory only.
3. Publishes `instance.reloaded` with a duration.

Both events reach clients over SSE, so the TUI and desktop refetch config, agents, and commands instead of polling or restarting.

Reloads serialize per directory: concurrent triggers chain behind the in-flight one rather than interleaving invalidations. A cache whose owning scope has already closed is dropped from the registry instead of failing the reload — a disposed runtime must not poison later reloads.

**The same channel is reachable synchronously from a request**, through `Instance.invalidate(directory?)`. A handler that has just written the config surface — `POST /config/update`, and the two provider auth mutations — does not want to wait ~300ms for the watcher to notice its own write, and it must not tear the instance down to force a rebuild. `Instance.invalidate` runs `InstanceState.invalidateReloadable` directly: reloadable caches rebuild lazily on the next read, while the cache entry, the registered disposers, the non-reloadable state cells, and every live subscription survive, so the request that triggered it keeps a working instance. With no argument it reads the ambient instance scope like `dispose`; with a directory it can be addressed by key from outside a scope.

It is deliberately quieter than the watcher path: no `instance.reload.started` / `instance.reloaded` pair, because the caller is a request that returns its own result to the client that caused the change. If a future call site needs clients to refetch, it should publish the reload events itself rather than making this verb announce.

**This is not `dispose`.** `dispose` is teardown — it runs disposers, drops all state, and evicts the entry — and the three handlers above used it as invalidation until 2026-08-25 because there was nothing else, leaving each request holding an instance the cache no longer knew about. Invalidation drops derived state; teardown ends a life. Do not substitute one for the other.

### 3. Narrow invalidation is explicit and provider-specific

`Provider.refresh()` invalidates only the cached provider state for the current instance. It is called after every write that changes auth or `config.provider.*`: the auth command, the TUI connect dialog, the provider HTTP routes, and `server/extra.ts`.

This channel exists because credential changes are not file-surface changes the watcher sees, and because rebuilding the whole instance for a single OAuth callback would tear down unrelated state. The documented failure it prevents is concrete: without it, a freshly connected provider stays invisible until the process restarts.

### 4. models.dev refresh is a background task, not an invalidation

`ModelsDev.refresh()` runs on a timer and updates its own cache. It does not trigger an instance reload. A provider list assembled before the refresh keeps serving until something else invalidates it, which is acceptable because the catalog changes on the order of days and the staleness is never user-visible mid-turn.

## Alternatives Rejected

**Config transforms with a full service reload.** Let plugins mutate a `Draft<Config.Info>`, then reload every config-derived service. Rejected because a transform can touch any field, so no granular subset is provably sufficient — every derived service must reload on every transform. That is exactly the tear-down of live subscriptions and runtime registrations that the reloadable opt-in exists to prevent.

**A dedicated catalog service with its own transform pipeline.** Cleaner in principle: provider/model inputs get their own replayable transform chain, independent of config. Rejected for nikcli because the catalog is not the only thing plugins and auth affect, so it would add a second lifecycle without removing the first — and `Provider.refresh()` already gives the narrow path at a fraction of the cost.

**Watching files with no reload, requiring a restart.** This was the pre-existing behavior. Rejected because config edits are frequent during agent authoring, and a restart loses live sessions.

## Invariants

- Invalidation is scoped to one instance directory. One project's reload never disturbs another's.
- Bus subscriptions, live sessions, loop engines, and schedulers survive a reload by construction — they are not in reloadable caches.
- Every reload is observable: `instance.reload.started` and `instance.reloaded` bracket it on the bus.
- A new reloadable cache must justify itself against the rule in §1. If in doubt, it is not reloadable.
