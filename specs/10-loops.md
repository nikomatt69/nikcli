# Loops — design

> "I don't prompt Claude anymore. I have loops running that prompt Claude and
> figuring out what to do. My job is to write loops." — Boris Cherny

Goal: make **loops** a first-class, intuitive concept in the nikcli TUI — so a
user defines an objective + a trigger + stop conditions once, and nikcli drives
an autonomous agent toward it on a schedule (or on demand), with visible,
controllable, crash-safe state.

The key design decision: **a loop is not a new engine. It is a thin orchestrator
that composes primitives nikcli already ships.** Nothing below reimplements
iteration, budgets, continuation prompting, persistence, or autonomy — those
already exist and are battle-tested.

> **Note:** since v1 the implementation has expanded. Loops now ship with a
> headless server-side `LoopEngine` (`src/loop/engine.ts`) that drives
> interval triggers via the core `Scheduler` with `scope: "instance"` — so
> scheduled loops keep running when the TUI is closed. The TUI plugin still
> exists as a thin client over the SDK, but it is no longer the only
> scheduler. See §9 for the current architecture.

---

## 1. Two natures of a loop (and the primitives that already cover them)

| Nature                           | Meaning                                      | Existing primitive                                | File                                                                                         |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Temporal** (recurring trigger) | "every 10m, do X"                            | `Scheduler.register({ interval, run })`           | `src/scheduler/index.ts`                                                                     |
| **Agentic** (until-done)         | "iterate until a verifiable condition holds" | **Goal system** + `/goal` command + `ralph` agent | `src/session/goal.ts`, `src/session/prompt.ts`, `src/command/index.ts`, `src/agent/agent.ts` |

A "complete" loop (Cherny's sense) = a **temporal trigger** that kicks an
**agentic until-done run**, tracked and persisted. Both halves exist; the Loop
abstraction binds them and adds UX.

### 1.1 The Goal system IS the agentic loop (reuse it, don't rebuild)

`src/session/goal.ts` already implements the until-done engine:

- `State`: `objective`, `status` (`active | paused | blocked | usage_limited |
budget_limited | complete`), `iterationCount`, `tokenBudget`, `tokensUsed`,
  time tracking; `MAX_ITERATIONS = 50`.
- `src/session/prompt.ts:269` `nextGoalPrompt()` is the continuation loop: after
  each assistant turn it checks `isGoalContinueNeeded`, calls
  `incrementIteration`, and re-injects `continuationPrompt(state)` — stopping on
  `budget_limited` / iteration cap with `budgetLimitPrompt` / `iterationLimitPrompt`.
- Tools `create_goal` / `get_goal` / `update_goal` (`src/tool/goal.ts`) let the
  agent itself declare the goal `complete` or `blocked` (with a repeated-blocker
  guard of 3 consecutive turns).
- `/goal` command (`src/command/index.ts:140`, `Default.GOAL`): _"work
  autonomously until a verifiable goal condition is met"_, with subcommands
  `pause | resume | clear | status` and `--token-budget N` (`SessionGoal.parseArguments`).

**Implication:** the agentic half of a loop is _already shipped_ as `/goal`. The
Loops feature should drive `/goal` (or `create_goal`) under the hood, not invent
a parallel iteration mechanism. "Use the goal command" is the load-bearing
principle of this design.

### 1.2 Tracking & persistence already exist

`src/background/run.ts` `BackgroundRun` already gives per-run records with
`status` (`running | complete | error | timeout | cancelled | orphaned`),
`progressSummary`, on-disk `.md` artifacts, lease/heartbeat ownership, and
`reconcileInterrupted()` recovery after a restart — directly relevant to the
ephemeral remote container. A loop iteration maps 1:1 onto a `BackgroundRun.Record`.

---

## 2. What's actually missing (the gap this spec fills)

1. A persisted **`LoopDefinition`** binding a trigger to a goal-driven run.
2. A **`LoopEngine`** that registers the trigger with `Scheduler`, starts a
   goal-driven session via the SDK client, and records each iteration.
3. **TUI UX** to create / list / inspect / pause / resume / delete loops, plus a
   live status panel.

All three can live in a single self-contained internal TUI plugin
(`feature-plugins/loops/`) modeled on `feature-plugins/system/plugins.tsx`, with
the engine in a small `src/loop/` namespace. No core changes required for the MVP.

---

## 3. Data model

### 3.1 `LoopDefinition` (persisted)

Stored as `.nikcli/loops/<id>.md` (frontmatter + objective body, consistent with
how nikcli loads `command/` and `agent/`), with runtime registry in storage key
`["loops", projectID]`.

```ts
type LoopDefinition = {
  id: string
  name: string
  objective: string // becomes the Goal objective (the /goal argument)
  agent: string // default "ralph"
  trigger:
    | { kind: "manual" } // run on demand from the manager
    | { kind: "interval"; every: string } // "10m", "1h" -> Scheduler interval
    | { kind: "event"; on: Event["type"] } // bus event (Phase 3)
  stop: {
    // agentic completion is delegated to the Goal system (update_goal complete/blocked)
    maxIterations?: number // default 50, forwarded to the goal cap
    tokenBudget?: number // forwarded to /goal --token-budget
    maxRuns?: number // temporal cap: how many times the trigger may fire
  }
  guardrails: {
    requireApproval?: boolean // gate each run via the permission system
    maxCostUSD?: number
  }
  enabled: boolean
  createdAt: number
}
```

### 3.2 Runtime state — reuse `BackgroundRun.Record`

No new runtime schema. Each loop iteration creates a `BackgroundRun` (with a new
`source: "loop"` literal added to `SourceSchema`), so existing status glyphs,
artifacts, the background-agents dialog, and `reconcileInterrupted()` work for
loops for free. Live goal counters come from `SessionGoal.get(sessionID)`.

---

## 4. The engine — `src/loop/engine.ts`

A small namespace (~150 lines) composing the primitives. Pseudocode:

```ts
namespace LoopEngine {
  export async function start(def: LoopDefinition) {
    if (def.trigger.kind === "interval") {
      Scheduler.register({
        id: `loop:${def.id}`,
        interval: parseDuration(def.trigger.every), // "10m" -> ms
        skipInitialRun: true,
        async run() {
          if (await overTemporalCap(def)) return stop(def, "maxRuns")
          await runOnce(def)
        },
      })
    }
  }

  async function runOnce(def: LoopDefinition) {
    if (def.guardrails.requireApproval && !(await askApproval(def))) return

    const run = await BackgroundRun.create({
      parentSessionID,
      agent: def.agent,
      prompt: def.objective,
      source: "loop",
      title: def.name,
      metadata: { loopID: def.id },
    })

    const session = await client.session.create({ workspaceID })
    // Drive the EXISTING goal command — this is the agentic until-done loop.
    await client.session.command({
      sessionID: session.id,
      agent: def.agent, // "ralph"
      command: "goal",
      arguments: def.stop.tokenBudget ? `${def.objective} --token-budget ${def.stop.tokenBudget}` : def.objective,
    })

    // nextGoalPrompt() in prompt.ts iterates the session until the agent calls
    // update_goal(complete|blocked), or the iteration/budget cap is hit.
    await BackgroundRun.finalizeFromSession(run.id)
  }

  export function stop(def: LoopDefinition, reason: string) {
    Scheduler.unregister(`loop:${def.id}`)
    // mark disabled; emit event for the TUI panel
  }
}
```

Why this is safe:

- **No runaway**: bounded by the Goal `MAX_ITERATIONS`/budget caps, by the loop's
  `maxRuns` temporal cap, _and_ by the permission system's existing doom-loop
  detection (`src/permission/next.ts`).
- **Crash-safe**: `Scheduler` timers are `unref()`'d and rebuilt on boot from the
  persisted registry; in-flight iterations are recovered by
  `BackgroundRun.reconcileInterrupted()`.
- **Clean stop**: `Scheduler.unregister` + `client.session.abort`.

---

## 5. TUI UX

Loops should feel as first-class as sessions. Registered as an internal plugin
via `api.command.register` (pattern: `feature-plugins/home/tips.tsx:18` and
`feature-plugins/system/plugins.tsx:324`).

### 5.1 Slash commands

- `/loops` — opens the **manager** (`api.ui.DialogSelect`) listing every loop
  with live status and inline controls (run ▶ / pause ⏸ / edit ✎ / delete 🗑),
  mirroring the keybind-driven rows in `system/plugins.tsx`.
- `/loops new` — opens the **creation wizard**.
- `/goal` stays the manual, single-session entry point (already shipped); the
  manager surfaces a "Promote current goal to a loop" action that reads
  `SessionGoal.get(sessionID)` and pre-fills the wizard from the active goal.

### 5.2 Creation wizard (`api.ui.DialogPrompt`, guided)

```
┌─ New Loop ───────────────────────────────────┐
│ Objective   keep CI green on PR #1234         │  -> Goal objective / /goal arg
│ Agent       ▸ ralph   build   plan            │
│ Trigger     ▸ interval(10m)  manual  event    │
│ Stop        goal-complete · max 50 iter        │  -> delegated to Goal system
│ Budget      --token-budget 200k (optional)     │
│ Guardrail   require approval ▢                  │
└────────────────────────────────────────────────┘
```

"Loops that write loops" (Phase 4): a **Generate from description** action sends
the NL description to an agent that emits a filled `LoopDefinition` — the
AI-authored loop, literally Cherny's thesis.

### 5.3 Live sidebar panel (`api.slots.register`, slot `sidebar_content`)

Pattern: `feature-plugins/sidebar/todo.tsx`. Subscribes via `api.event.on(...)`
and reads `SessionStatus` + goal counters for real-time rows:

```
LOOPS
● ci-green     iter 3/50   running   42s
○ docs-sync    idle        next 8m
✓ migrate-v2   complete    12 iter
⏸ nightly-qa   paused
```

Reuses the spinner/status components already wired for streaming
(`session/status.ts`, `tui/ui/spinner.ts`).

---

## 6. Files

New:

- `src/loop/definition.ts` — `LoopDefinition` schema + load/save (`.nikcli/loops/*.md` + storage registry).
- `src/loop/engine.ts` — `LoopEngine` (compose Scheduler + goal-driven run + BackgroundRun).
- `src/cli/cmd/tui/feature-plugins/loops/index.tsx` — `/loops` command, manager, wizard, sidebar slot.

Touched (minimal):

- `src/background/run.ts` — add `"loop"` to `SourceSchema`.
- Boot path — call `LoopEngine.restore()` to re-arm enabled interval loops on startup
  (alongside the existing `reconcileInterrupted` reconciliation).

Untouched on purpose: the Goal system (`session/goal.ts`, `tool/goal.ts`,
`nextGoalPrompt` in `prompt.ts`), `ralph`, `Scheduler` — consumed as-is.

---

## 7. Phased delivery

The phases below describe the **as-shipped** state at the time of writing.

- **Phase 1 — MVP** ✅ **DONE**. `LoopDefinition` persistence (server `Storage` +
  TUI local KV cache); `/loops` manager + wizard; `interval` + `manual` triggers;
  engine drives `/goal` on `ralph`; iteration via the existing goal loop.
  Server-side engine at `src/loop/{schema,manager,engine}.ts` plus HTTP routes at
  `src/server/routes/loop.ts`; SDK regenerated to expose the endpoints.
- **Phase 2 — Live UX** ✅ **DONE**. Sidebar panel with real-time status from the
  event bus; pause/resume controls; live "next-fire" counter on the manager.
- **Phase 3 — Power** ⏳ **PARTIAL** (reconciled 2026-07-30). `maxRuns` temporal
  cap is done (enforced server-side in `engine.runOnce`). **In-flight abort is
  real** — `LoopEngine.abort` / run slots use `AbortController` and best-effort
  `SessionPrompt` cancel (`src/loop/engine.ts`); not a local-state-only no-op.
  **Still TODO**: `kind: "event"` triggers, `requireApproval` guardrail,
  `maxCostUSD` cost guardrail, "Promote active goal to loop" action. Worktree
  sandboxing for loops/missions also landed separately (`feat(worktree)`).
- **Phase 4 — Meta** ✅ **DONE**. "Generate loop from description" (server route
  `POST /loop/generate` + SDK method `client.loop.generate()`) and a template
  library (`babysit-pr`, `keep-tests-green`, `docs-sync`, `nightly-qa`). The
  server's `LOOP_TEMPLATES` is the single source of truth (exposed via
  `GET /loop/templates`); the TUI consumes it on wizard open.

---

## 9. Implementation notes (current architecture)

### 9.1 Server-side (headless)

Files:

- `src/loop/schema.ts` — Zod schemas for `LoopDefinition`, `LoopStage`,
  `LoopTrigger` (manual | interval), `LoopRun`, plus helpers (`parseDuration`,
  `formatDuration`, `validateDefinition`, `definitionFromGenerated`,
  `LOOP_TEMPLATES`).
- `src/loop/manager.ts` — Effect-based CRUD over `Storage`. Per-project keys
  `["loop", projectID, id]` and `["loop_run", projectID, loopID, runID]`.
  Cascade-deletes runs on `remove`. `trimRuns` enforces `HISTORY_LIMIT = 50`.
- `src/loop/engine.ts` — The headless engine. Exposes:
  - `LoopEvent` (Bus events: `Upserted` / `Removed` / `RunStarted` /
    `RunFinished` / `RuntimeChanged`)
  - Per-instance live `Runtime` map, isolated via `Instance.state` so
    loops in different projects don't collide.
  - `runOnce(id)` with single-flight (TOCTOU-safe via synchronous slot claim)
    and global concurrency back-pressure.
  - `arm(id)` / `disarm(id)` via `Scheduler.register({ scope: "instance" })`.
  - `restore()` called from `InstanceBootstrap` — re-arms enabled interval
    loops AND rehydrates the `Runtime` map from `Manager.listRuns` AND
    reconciles stale `"running"` runs (orphaned since the previous process).
  - `abort(id)` for in-flight cancellation (uses `SessionPrompt.abort`).
- `src/server/routes/loop.ts` — 13 HTTP endpoints with `hono-openapi`:
  `GET /` (list + runtimes), `GET /templates`, `POST /generate`,
  `GET /:id`, `PUT /` (upsert), `POST /:id` (update), `DELETE /:id`,
  `POST /:id/toggle`, `POST /:id/run`, `POST /:id/pause`, `POST /:id/resume`,
  `GET /:id/runs`, `GET /runs/recent` (cross-loop).
- `src/background/run.ts` — `SourceSchema` adds the `"loop"` literal for
  future cross-referencing; the engine currently uses its own `LoopRun` table
  (see §9.3 "Deviations").
- `src/project/bootstrap.ts` — calls `LoopEngine.restore()` during
  `InstanceBootstrap`, after `Monitor.reconcile()`.
- `packages/sdk/js` — regenerated to expose the new endpoints (`Loop` class
  with `list`, `get`, `upsert`, `update`, `delete`, `toggle`, `run`, `pause`,
  `resume`, `runs`, `templates`, `generate`; nested `Runs.recent`).

### 9.2 TUI-side (plugin)

- `src/cli/cmd/tui/feature-plugins/loops/store.ts` — Pure helpers
  (`parseDuration`, `formatDuration`, `validateStage`, `validateDraft`,
  `createDefinition`, `sanitize`) and a local KV cache of the server's
  definitions + run history for offline reads. The server is the source of
  truth; this is a fallback.
- `src/cli/cmd/tui/feature-plugins/loops/runner.ts` — Reactive Solid store
  keyed by loop id. Subscribes to bus events for live updates. **No longer
  schedules runs locally** — it polls the server's `LoopApi.get(id)` to
  refresh runtime status; the server's `Scheduler.register` is the only
  writer of run records. This eliminates the double-scheduling race that
  existed when both the TUI timer and the server timer fired `runOnce`.
- `src/cli/cmd/tui/feature-plugins/loops/sdk.ts` — `LoopApi` namespace over
  the SDK's `client.loop` (with flat params, narrowed `asDefinition` /
  `asRuntime` / `asRun` / `asTemplate` helpers, and `subscribeLoopEvents`
  for the bus).
- `src/cli/cmd/tui/feature-plugins/loops/dialogs.tsx` — `/loops` manager
  (list + quick keybinds run/toggle/delete), per-loop actions menu, chained
  creation wizard (starter: blank | template | generate-from-description →
  name → schedule → max-runs → stages), stage editor, history hub, and
  per-run detail.
- `src/cli/cmd/tui/feature-plugins/loops/index.tsx` — plugin module: `/loops`
  command (alias `/loop`), `New loop` palette entry, and a live sidebar
  panel via the `sidebar_content` slot.
- Registered in `src/cli/cmd/tui/plugin/internal.ts`.
- `test/tui/loops-store.test.ts` — unit tests for the pure store logic.

### 9.3 Deliberate deviations from §1.1 (the "thin orchestrator" principle)

Two concrete departures from the original "use existing primitives" promise,
documented here so future maintainers don't think they're bugs:

1. **Parallel `LoopRun` table.** The spec said "each loop iteration creates
   a `BackgroundRun` so existing status glyphs, artifacts, the
   background-agents dialog, and `reconcileInterrupted()` work for loops
   for free." In practice the engine writes its own `LoopRun` records into
   `["loop_run", ...]` storage with a `backgroundRunID` foreign-key field
   that is currently always `undefined`. This is a deliberate trade-off:
   the per-stage diff attribution the TUI needs (additions / deletions /
   files per run) is more naturally a `LoopRun` field than a `BackgroundRun`
   one. When the BackgroundRun primitive grows cost + diff tracking, this
   table can be collapsed.
2. **TUI local timer removed.** The original v1 had an in-TUI `setInterval`
   firing `client.session.command` directly. The current architecture has
   the TUI as a **pure observer**: it reads `Runtime` from the server
   on bus events and never writes run records. The TUI may still have a
   cosmetic ticker (e.g. to animate a spinner) but it does not call
   `client.loop.run` on a schedule.

### 9.4 In-flight abort

`Runner.abortRun` in the TUI clears local cached state and disarms the
local ticker, but does **not** actually cancel a running session — the
server engine has no in-flight abort yet. The next interval tick (when
the loop is re-armed) starts a fresh session. The "Abort run" action in
the manager currently surfaces this as a no-op with a toast explaining
the limitation. The plan to make abort real is in `Phase 3` §7 above
and the corresponding test gap is in `test/loop/engine.test.ts`.

## 8. Open questions

1. **Scope of persistence**: per-project (`.nikcli/loops/`) only, or also global
   (`~/.nikcli/loops/`) for cross-project loops like `babysit-pr`?
2. **Concurrency**: cap simultaneously-running loops per project (reuse
   `BackgroundRun.countRunningForParent`)?
3. **Where loops run**: in the foreground TUI session vs. always as background
   agents (`client.session.background2`). Background keeps the TUI responsive but
   complicates approval prompts.
4. **Trigger time base**: interval timers reset on restart — acceptable, or do we
   need wall-clock cron semantics (next-fire persisted)?
