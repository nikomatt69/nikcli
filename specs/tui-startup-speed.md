# TUI startup speed — architecture

> **Implementation status (this branch).** Landed the safe, individually
> verifiable wins: **Change 1** (background the bootstrap restore tail),
> **Change 3** (skip the up-to-1s theme wait when a mode is already
> persisted — strictly behavior-preserving), **Change 4** (pre-warm the
> worker bootstrap so it overlaps renderer init), and **Change 6** (preserve
> `models.json` across cache-version bumps). Each is flag-reversible
> (`NIKCLI_EAGER_BOOTSTRAP`, `NIKCLI_BLOCKING_THEME`, `NIKCLI_NO_WARM_WORKER`).
> **Deferred:** Change 2 (lazy command registration — large structural
> refactor of the yargs entry, higher regression surface for help/completion/
> dispatch) and Change 5 (defer render-thread sync work — low real impact:
> it runs *after* first paint and the brain scheduler is cheap). Both are
> documented below for a follow-up. Validated with `tsgo` typecheck (clean),
> oxlint (no new findings), and the affected unit/e2e tests (httpapi-bridge,
> cli index-help e2e, project) — all green.



Goal: make `nikcli` (the default `$0` TUI) reach **first interactive paint**
materially faster, **without** regressing behavior, leaking errors, or
changing semantics. Guardrails-first, flag-gated, measurable — consistent
with `specs/perf-roadmap.md`.

---

## 1. Lineage: how opencode boots the TUI (baseline)

nikcli is an opencode-derived monorepo and inherits opencode's modern TUI
architecture. The relevant shape:

- Entry is a Bun single-file executable (`bun build --compile`,
  `script/build.ts`). `src/index.ts` is the yargs entry; the default
  command `$0` is the TUI.
- The TUI command spawns a **Bun `Worker`** running the backend
  (`src/cli/cmd/tui/worker.ts`): an in-process HTTP/RPC server
  (`Server.App()` + `Rpc`). The UI process talks to it either over a direct
  RPC `fetch` shim (default) or a real HTTP server (when `--port`/`--hostname`
  is set).
- The UI is a **SolidJS app rendered to the terminal** via
  `@opentui/solid` + `@opentui/core` (`src/cli/cmd/tui/app.tsx`).
- Backend work is wrapped per-request in `withInstanceAsync({ init:
  InstanceBootstrap })`; the **first** request to a directory triggers
  `InstanceBootstrap` (`src/project/bootstrap.ts`).

Upstream opencode keeps this path lean: few CLI subcommands, a small
bootstrap. nikcli has added many subsystems (mission, loop, routine, brain,
monitor, delegation, goal, companion, mobile, remote, …). Each addition has
quietly inflated **two** hot paths: the eager command-import graph in the
main process, and the awaited tail of `InstanceBootstrap`. Those are the two
biggest regressions vs. the upstream baseline, and the core of this design.

---

## 2. nikcli's actual startup critical path (measured against the code)

First interactive paint of `nikcli` (no args → `TuiThreadCommand`, `$0`)
serializes through these stages:

### Stage A — main process module evaluation (`src/index.ts`)
`index.ts` eagerly `import`s **all 39 command modules** at top level. Every
command module imports the **full backend** at top level — e.g. `run.ts`
pulls `Server`, `Provider`, `Agent`, `Storage`, `SessionRepo`,
`MessageRepo`, `Instance`, `Config`, `ShareNext`, `effect`, … (`run.ts:6-25`).
Net effect: launching the TUI evaluates the top-level of nearly the entire
backend **in the UI process**, even though the TUI's real backend runs in the
worker and the UI never executes those command bodies. This is pure,
avoidable startup latency (module parse + top-level side effects), and it
grows with every new subcommand.

### Stage B — `initialize()` middleware (`src/global/index.ts`)
7× `fs.mkdir` (parallel, cheap) + a cache-version check. Note: bumping
`CACHE_VERSION` wipes the whole cache dir, including `models.json`
(`src/provider/models.ts:13`) — so the **first launch after an upgrade**
loses the models cache and can fall to a network fetch on a later path.

### Stage C — worker spawn (`thread.ts:handler` → `worker.ts`)
`new Worker(workerPath)` boots a second JS context that, at top level,
imports `Server`, `Instance`, `InstanceBootstrap` and its entire transitive
graph (LSP, plugins, effect, …) plus `Log.init`. Heavy, but runs in
parallel with Stage D once spawned — **if** we let it.

### Stage D — renderer init (`app.tsx:tui()`)
- `dynamic import("./app")` pulls `@opentui/solid`, `@opentui/core`,
  `solid-js`, **~60 dialog/route components**, and more backend modules
  (`Provider`, `Session`, `brain/scheduler`, `db/users`, …) — all top-level.
- `createCliRenderer(...)` enters the alt screen, then
  **`waitForThemeMode(1000)`** — a blocking wait of up to **1000 ms** for
  terminal background-color detection before the first frame
  (`app.tsx:131-133`).

### Stage E — data bootstrap gate (`context/sync.tsx:bootstrap()`)
`SyncProvider.onMount` fires 4 **blocking** RPC calls before the UI leaves
the `"loading"` state (`sync.tsx:592-610`): `config.providers`,
`provider.list`, `app.agents`, `config.get`. The **first** of these is what
triggers the worker's `InstanceBootstrap` — so Stage E's latency = first-RPC
round-trip **+ the entire awaited bootstrap tail** (Stage F).

### Stage F — `InstanceBootstrap` awaited tail (`src/project/bootstrap.ts`)
Most inits are correctly fire-and-forget via `background(...)` (share,
format, lsp, file-watcher, file, vcs, snapshot, truncate, todo). But the
**tail is awaited sequentially** before the first request resolves:
`await Plugin.init()` → `SessionV2.init()` → **`await Delegation.init()`** →
**`await Monitor.reconcile()`** → **`await LoopEngine.restore()`** →
**`await MissionOrchestrator.restore()`** → **`await
Routine.restoreSchedulers()`** (`bootstrap.ts:152-210`). The five bolded
calls are **nikcli-specific additions** and none is needed to paint the
first frame — yet every one blocks it.

### Stage G — UI `onMount` side work (`app.tsx:338-390`)
On the render thread: `UserDB.hasUsers()` (synchronous SQLite open +
implicit migration, `db/users.ts:358`) and `getActiveSessionSync()`
(sync file read), then `withInstanceAsync(... initBrainScheduler() ...)` —
which spins up a **second Instance in the UI process** and starts the brain
scheduler — before `TuiPluginRuntime.init()` flips `pluginsReady`
(`StartupLoading` overlay stays up until then).

**Summary of the critical chain:**
`(A heavy import) → (C worker import) → (D 1000 ms theme wait) →
(E first RPC) → (F awaited mission/loop/routine/monitor/delegation restore)
→ paint`, with `(G sync SQLite + 2nd instance + brain)` piled onto the same
render thread.

---

## 3. Bottlenecks ranked by impact × safety

| # | Bottleneck | Where | Impact | Risk to fix |
|---|-----------|-------|--------|-------------|
| 1 | Awaited bootstrap tail (delegation/monitor/loop/mission/routine restore) blocks first RPC | `bootstrap.ts:188-210` | **High** | **Low** |
| 2 | Eager import of 39 commands → whole backend evaluated in UI process | `index.ts`, `run.ts:6-25` | **High** | **Low** |
| 3 | `waitForThemeMode(1000)` blocks first frame | `app.tsx:131-133` | **Med-High** | **Low** |
| 4 | Worker bootstrap serialized *after* renderer instead of warmed in parallel | `thread.ts` handler order | **Med** | **Low** |
| 5 | Sync SQLite (`UserDB.hasUsers`) + 2nd Instance + brain scheduler on render thread | `app.tsx:338-366` | **Med** | **Med** |
| 6 | Cache wipe on `CACHE_VERSION` bump drops `models.json` | `global/index.ts`, `models.ts` | **Low-Med** | **Low** |

---

## 4. Proposed architecture

Five independent, individually-revertable changes. Each is flag-guarded
where behavior could shift, and each preserves existing error funnels
(`Log.Default`, `background()` `.catch`, `ErrorBoundary`).

### Change 1 — Background the bootstrap tail (highest ROI)
Move the five nikcli-specific restore/reconcile calls off the awaited path
into the existing `background(service, promise)` helper, exactly like
`share`/`lsp`/`snapshot` already are. `background()` already swallows
rejections into `Log.Default.warn`, so no new unhandled-rejection surface.

- Keep `await Plugin.init()` awaited — plugin-contributed commands/agents
  must exist before the first `app.agents`/`command.list` response, else we
  regress correctness.
- `SessionV2.init()` stays (cheap, synchronous projector wiring).
- Background: `Delegation.init`, `Monitor.reconcile`, `LoopEngine.restore`,
  `MissionOrchestrator.restore`, `Routine.restoreSchedulers`.
- Guard: `Flag.NIKCLI_EAGER_BOOTSTRAP=1` restores the old awaited order for
  bisecting any "X wasn't ready immediately" report.

Correctness note: these subsystems are event/poll-driven after init; nothing
in the first paint reads their in-memory state synchronously. A mission/loop
that was "running" still gets demoted/reconciled — just a few hundred ms
later, off the paint path.

### Change 2 — Lazy command registration in the entry
Stop importing 39 command modules eagerly. yargs supports lazy command
modules; wrap each non-TUI command so its module is `import()`-ed only when
that command is actually invoked. Two viable shapes:

- **A (minimal):** keep `index.ts` structure but replace heavy
  `.command(X)` with thin lazy descriptors (`command`, `describe`,
  `builder/handler` that `await import("./cmd/x")` on demand). The `$0` TUI
  path then imports only `thread.ts` + its graph.
- **B (cleaner):** a small registry that maps command name → loader; the
  middleware resolves the matched command lazily.

This removes the whole backend's top-level eval from the common path. No
behavior change: a subcommand still loads exactly what it needs the moment
it runs. Guard with `Flag.NIKCLI_EAGER_COMMANDS=1` (eager) for parity tests
and shell-completion, which enumerates command metadata (keep descriptions
static so `completion` needs no module load).

### Change 3 — Non-blocking theme detection
Replace the up-to-1000 ms `waitForThemeMode(1000)` gate with: start with a
default mode (persisted last-known mode from KV, else `"dark"`), render
immediately, and apply the detected mode reactively when
`getPalette`/theme-mode detection resolves. `ThemeProvider` is already
reactive (`mode` is a signal-backed prop), so a late mode swap is a cheap
re-style, not a re-mount.

- Guard: `Flag.NIKCLI_BLOCKING_THEME=1` keeps the synchronous wait.
- Regression guard: persist detected mode to KV so the *next* launch starts
  correct with zero flash; cap any first-launch flash to one frame.

### Change 4 — Warm the worker before the renderer
Reorder `thread.ts:handler` so the expensive worker bootstrap overlaps
renderer creation instead of starting only when `SyncProvider` fires its
first RPC. Concretely: immediately after `new Worker(...)`, kick a cheap,
idempotent RPC (e.g. `config.get` for `cwd`) that forces `Instance.provide`
+ `InstanceBootstrap` to begin, *while* `createCliRenderer` and `import(
"./app")` run. By the time Stage E's blocking requests fire, bootstrap is
already in flight (or done). No semantic change — same calls, earlier start.

- Implementation detail: the warm-up call must be the same instance-keyed
  path the real requests use, so it dedupes (one bootstrap, not two).
- Guard: `Flag.NIKCLI_NO_WARM_WORKER=1`.

### Change 5 — Defer render-thread sync work
Take `UserDB.hasUsers()` / `getActiveSessionSync()` and `initBrainScheduler()`
off the first-paint render frame:

- Run the first-run/login probe inside the existing async IIFE but **after**
  yielding one frame (or move the SQLite read behind a worker RPC so the open
  happens in the backend context that already owns the DB). Onboarding/login
  dialogs are already async overlays — gating them one tick later is
  invisible.
- `initBrainScheduler()` moves to `background()` (it's a scheduler, not a
  paint dependency), eliminating the **second** UI-process Instance creation
  on the hot path. If brain must run in-UI, start it lazily on first idle.
- Guard: `Flag.NIKCLI_EAGER_BRAIN=1`.

### Change 6 (cleanup) — Preserve `models.json` across cache-version bumps
When wiping cache on `CACHE_VERSION` change, **preserve** `models.json` (or
move models cache out of the version-wiped dir). Prevents a post-upgrade
cold launch from degrading to a network model fetch. Pure win, no flag.

---

## 5. Regression & error-propagation safeguards

- **No new unhandled rejections.** Every newly-backgrounded promise goes
  through `background()` / `.catch(Log.Default.warn)`; the TUI keeps its
  `ErrorBoundary` and `process.on("unhandledRejection")` funnels.
- **Ordering correctness.** Only init calls with no synchronous first-paint
  reader are backgrounded. `Plugin.init` (commands/agents) stays awaited.
- **Single bootstrap invariant.** Change 4's warm-up uses the same
  instance-keyed `withInstanceAsync` path → `InstanceBootstrap` still runs
  exactly once per directory.
- **Every behavior-affecting change is flag-reversible** for `git bisect`
  and field debugging.
- **Lazy commands keep `--help`/completion intact** by keeping command
  `describe` metadata static (no module load to render help).

---

## 6. Measurement plan (prove it, don't assume it)

Add a tiny, dev-only phase timer (mirrors `Log.Default.info("nikcli", …)`)
emitting marks at: process start, post-`initialize`, worker-spawned,
renderer-created, first-frame, `sync.status==="partial"`,
`sync.status==="complete"`, `pluginsReady`. Gate behind `--print-logs` /
`Installation.isLocal()`.

- **Primary metric:** wall-clock to first interactive frame and to
  `status:"partial"`, median of N cold runs (`NIKCLI_DATA_DIR` pointed at a
  fresh dir to simulate cold).
- **Secondary:** time to `status:"complete"`, `pluginsReady`, peak RSS.
- **Method:** baseline on `live-main`, then land changes 1→6 one PR at a
  time, recording the delta per change. Expected dominant wins from #1 and
  #2; #3 removes a fixed up-to-1s tax on slow terminals.
- **Guardrail test:** a smoke run asserting a backgrounded subsystem
  (e.g. a restored loop / scheduled routine) still fires within a bounded
  window after paint, so deferral never silently drops functionality.

---

## 7. Suggested sequencing (small, safe PRs)

1. **PR1 — measurement harness** (no behavior change; establishes baseline).
2. **PR2 — Change 1** (background bootstrap tail) — biggest win, lowest risk.
3. **PR3 — Change 4** (warm worker) — compounds with PR2.
4. **PR4 — Change 3** (non-blocking theme) — removes the fixed 1s tax.
5. **PR5 — Change 2** (lazy commands) — structural, larger diff, isolate it.
6. **PR6 — Change 5 + Change 6** (defer render-thread sync; models cache).

Each PR ships its flag and a before/after number from PR1's harness.
