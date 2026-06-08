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

- **Phase 1 — MVP**: `LoopDefinition` persistence; `/loops` manager + wizard;
  `interval` trigger + `manual`; engine drives `/goal` on `ralph`; iteration via
  the existing goal loop; `BackgroundRun` tracking. Self-contained plugin +
  `src/loop/`. No core changes beyond the `"loop"` source literal.
- **Phase 2 — Live UX**: sidebar panel with real-time status from the event bus;
  pause/resume/abort controls; "Promote active goal to loop".
- **Phase 3 — Power**: `event` triggers; `requireApproval` + cost guardrails;
  `maxRuns` temporal cap surfaced in UI.
- **Phase 4 — Meta**: "Generate loop from description" (AI-authored loops) and a
  template library (`babysit-pr`, `keep-tests-green`, `docs-sync`, `nightly-qa`).

---

## 9. Implementation notes (v1 — shipped)

The v1 ships as a **self-contained internal TUI plugin** with **zero core changes**,
which gives the strongest possible "no regressions" guarantee (purely additive).

Files:

- `src/cli/cmd/tui/feature-plugins/loops/store.ts` — `LoopDefinition` model, duration
  parsing/formatting, draft validation, and KV-backed CRUD with corrupt-data
  sanitization. Pure (no OpenTUI/Solid imports) and unit-tested.
- `src/cli/cmd/tui/feature-plugins/loops/runner.ts` — the runtime engine: interval
  timers, single-flight + global concurrency back-pressure, run-cap enforcement,
  reactive status store, and lifecycle teardown. Drives runs via
  `client.session.command({ command: "goal", arguments: objective })`.
- `src/cli/cmd/tui/feature-plugins/loops/dialogs.tsx` — `/loops` manager (list +
  quick keybinds run/toggle/delete), per-loop actions menu, and the chained
  creation wizard (objective → name → schedule → budget).
- `src/cli/cmd/tui/feature-plugins/loops/index.tsx` — plugin module: `/loops`
  command (alias `/loop`), `New loop` palette entry, and a live sidebar panel.
- Registered in `src/cli/cmd/tui/plugin/internal.ts`.
- `test/tui/loops-store.test.ts` — unit tests for the pure store logic.

**Why TUI-plugin rather than a core engine.** The `Scheduler`/`BackgroundRun`
primitives live in the core (server) process, while the TUI is a separate process
that talks to the server over the SDK client. Driving a core `LoopEngine` from the
TUI would require new server routes + SDK regeneration — a large, regression-prone,
hard-to-verify surface. Routing the whole feature through the documented plugin
`api` instead keeps it additive and verifiable, and still reuses the real
autonomous engine: the **Goal system** runs server-side exactly as for an
interactive `/goal`, so each loop run is a genuine until-done autonomous run.

**Known v1 limitation.** Interval triggers are driven by in-TUI timers, so scheduled
loops run while the TUI session is open (manual runs and the Goal-driven iteration
are unaffected). Headless, always-on scheduling is the natural Phase 2/3 upgrade:
move the trigger into the core `Scheduler` behind server routes, persisting
definitions in `Storage` and re-arming via `InstanceBootstrap` (alongside
`BackgroundRun.reconcileInterrupted`).

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
