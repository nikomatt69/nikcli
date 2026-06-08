/**
 * Loops — management dialogs: manager list, per-loop actions, the stage editor,
 * the run-history hub, and the creation wizard. Built on the internal
 * DialogSelect/DialogPrompt components (available to internal feature plugins,
 * mirroring system/plugins.tsx).
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import * as Store from "./store"
import * as Runner from "./runner"
import { LoopApi, type LoopDefinition } from "./sdk"

export function toneColor(theme: TuiPluginApi["theme"]["current"], tone: Runner.LoopTone): RGBA {
  switch (tone) {
    case "running":
      return theme.warning
    case "error":
      return theme.error
    case "ok":
      return theme.success
    default:
      return theme.textMuted
  }
}

/** A one-line summary of a loop's pipeline. */
function stagesSummary(def: Store.LoopDefinition): string {
  if (def.stages.length === 1) return def.stages[0].objective
  return def.stages.map((s) => s.name).join(" → ")
}

function footer(api: TuiPluginApi, def: Store.LoopDefinition) {
  const rt = Runner.runtimeOf(def.id)
  const info = Runner.statusInfo(def, rt)
  const stats = Store.loopStats(Store.loadHistory(api.kv, def.id))
  const success = stats.total > 0 ? ` · ${Math.round(stats.successRate * 100)}% of ${stats.total}` : ""
  return (
    <span style={{ fg: toneColor(api.theme.current, info.tone) }}>
      {info.label}
      {success}
    </span>
  )
}

type ManagerValue = { kind: "new" } | { kind: "loop"; id: string }

function loopOptions(api: TuiPluginApi): DialogSelectOption<ManagerValue>[] {
  const loops = Store.loadAll(api.kv)
  const rows: DialogSelectOption<ManagerValue>[] = loops.map((def) => ({
    title: def.name,
    value: { kind: "loop", id: def.id } as ManagerValue,
    description: `${def.stages.length} stage${def.stages.length === 1 ? "" : "s"} · ${stagesSummary(def)}`,
    category: "Loops",
    footer: footer(api, def),
  }))
  rows.push({
    title: "＋ New loop",
    value: { kind: "new" },
    description: "Define a staged pipeline and a trigger",
    category: "Actions",
  })
  return rows
}

export function openManager(api: TuiPluginApi): void {
  // Selecting a loop opens its actions submenu. We avoid single-letter quick
  // keybinds: DialogSelect matches keybinds on every keystroke regardless of
  // filter focus, so a bare letter could fire while typing in the search box.
  api.ui.dialog.replace(() => (
    <DialogSelect<ManagerValue>
      title="Loops"
      placeholder="Search loops…"
      options={loopOptions(api)}
      onSelect={(opt) => {
        if (opt.value.kind === "new") {
          openWizard(api)
          return
        }
        const def = Store.getById(api.kv, opt.value.id)
        if (def) openActions(api, def)
      }}
    />
  ))
}

function reload(api: TuiPluginApi, id: string): Store.LoopDefinition | undefined {
  return Store.getById(api.kv, id)
}

function openActions(api: TuiPluginApi, def: Store.LoopDefinition): void {
  const rt = Runner.runtimeOf(def.id)
  type Action =
    | "run"
    | "abort"
    | "pause"
    | "resume"
    | "toggle"
    | "stages"
    | "schedule"
    | "runcap"
    | "history"
    | "delete"
    | "back"
  const stats = Store.loopStats(Store.loadHistory(api.kv, def.id))
  const options: DialogSelectOption<Action>[] = []
  if (rt.status === "running") {
    options.push({
      title: "Abort run",
      value: "abort",
      description: "Stop the current run, keep the schedule",
    })
  } else {
    options.push({
      title: "Run now",
      value: "run",
      description: "Run the pipeline immediately",
    })
  }
  if (rt.status === "paused")
    options.push({
      title: "Resume",
      value: "resume",
      description: "Resume scheduling",
    })
  else if (def.trigger.kind === "interval")
    options.push({
      title: "Pause",
      value: "pause",
      description: "Stop the timer until resumed",
    })
  options.push(
    {
      title: def.enabled ? "Disable" : "Enable",
      value: "toggle",
      description: def.enabled ? "Stop triggering this loop" : "Allow this loop to trigger",
    },
    {
      title: "Edit stages",
      value: "stages",
      description: `${def.stages.length} stage${def.stages.length === 1 ? "" : "s"} · ${stagesSummary(def)}`,
    },
    {
      title: "Edit schedule",
      value: "schedule",
      description: def.trigger.kind === "interval" ? `every ${Store.formatDuration(def.trigger.everyMs)}` : "manual",
    },
    {
      title: "Edit run cap",
      value: "runcap",
      description:
        def.maxRuns !== undefined ? `stop after ${def.maxRuns} run${def.maxRuns === 1 ? "" : "s"}` : "unlimited",
    },
    {
      title: "History & stats",
      value: "history",
      description:
        stats.total === 0
          ? "no runs yet"
          : `${stats.ok}/${stats.total} ok · ${Math.round(stats.successRate * 100)}% · +${stats.additions}/-${stats.deletions}`,
    },
    { title: "Delete", value: "delete", description: "Remove this loop" },
    { title: "← Back", value: "back", description: "Return to the loop list" },
  )

  api.ui.dialog.replace(() => (
    <DialogSelect<Action>
      title={def.name}
      options={options}
      onSelect={(opt) => {
        switch (opt.value) {
          case "run":
            void Runner.runOnce(api, def, { manual: true })
            api.ui.toast({
              variant: "info",
              message: `Running "${def.name}"…`,
            })
            openManager(api)
            break
          case "abort":
            void Runner.abortRun(api, def.id)
            api.ui.toast({
              variant: "info",
              message: `Aborting "${def.name}"…`,
            })
            openManager(api)
            break
          case "pause":
            void Runner.pause(api, def)
            openManager(api)
            break
          case "resume":
            void Runner.resume(api, def)
            openManager(api)
            break
          case "toggle": {
            void Runner.setDefinitionEnabled(api, def.id, !def.enabled).then((next) => {
              if (next) void Runner.syncAll(api)
              openManager(api)
            })
            break
          }
          case "stages":
            openStages(api, def)
            break
          case "schedule":
            editSchedule(api, def)
            break
          case "runcap":
            editRunCap(api, def)
            break
          case "history":
            openHistory(api, def)
            break
          case "delete":
            confirmDelete(api, def)
            break
          case "back":
            openManager(api)
            break
        }
      }}
    />
  ))
}

function confirmDelete(api: TuiPluginApi, def: Store.LoopDefinition): void {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Delete "${def.name}"?`}
      message="This stops the loop and removes its definition."
      onConfirm={() => {
        void Runner.removeDefinition(api, def.id).then((ok) => {
          if (ok) {
            api.ui.toast({
              variant: "success",
              message: `Deleted "${def.name}"`,
            })
          } else {
            api.ui.toast({
              variant: "error",
              message: `Failed to delete "${def.name}"`,
            })
          }
          openManager(api)
        })
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

function editSchedule(api: TuiPluginApi, def: Store.LoopDefinition): void {
  const value = def.trigger.kind === "interval" ? Store.formatDuration(def.trigger.everyMs) : ""
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Edit schedule"
      placeholder="e.g. 10m, 1h — leave empty for manual"
      value={value}
      onConfirm={(raw) => {
        const text = raw.trim()
        let trigger: Store.LoopTrigger = { kind: "manual" }
        if (text) {
          try {
            const everyMs = Store.parseDuration(text)
            if (everyMs < Store.MIN_INTERVAL_MS) {
              throw new Error(`Interval must be at least ${Store.formatDuration(Store.MIN_INTERVAL_MS)}`)
            }
            trigger = { kind: "interval", everyMs }
          } catch (error) {
            api.ui.toast({
              variant: "error",
              message: error instanceof Error ? error.message : String(error),
            })
            editSchedule(api, def)
            return
          }
        }
        Store.upsert(api.kv, { ...def, trigger })
        void Runner.persist(api, { ...def, trigger }).then((saved) => {
          api.ui.toast({ variant: "success", message: "Schedule updated" })
          openActions(api, saved)
        })
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

function editRunCap(api: TuiPluginApi, def: Store.LoopDefinition): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Edit run cap"
      placeholder="Max number of runs — leave empty for unlimited"
      value={def.maxRuns !== undefined ? String(def.maxRuns) : ""}
      onConfirm={(raw) => {
        const text = raw.trim()
        let maxRuns: number | undefined
        if (text) {
          const parsed = Number(text)
          if (!Number.isInteger(parsed) || parsed <= 0) {
            api.ui.toast({
              variant: "error",
              message: "Run cap must be a positive integer",
            })
            editRunCap(api, def)
            return
          }
          maxRuns = parsed
        }
        const next = {
          ...def,
          ...(maxRuns !== undefined ? { maxRuns } : { maxRuns: undefined }),
        }
        Store.upsert(api.kv, next)
        void Runner.persist(api, next).then((saved) => {
          api.ui.toast({
            variant: "success",
            message: maxRuns ? `Run cap set to ${maxRuns}` : "Run cap removed",
          })
          openActions(api, saved)
        })
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

// ── Model & agent pickers ─────────────────────────────────────────────────────

/** Resolve a "providerID/modelID" reference to a friendly label, or "default model". */
export function modelLabel(api: TuiPluginApi, model?: string): string {
  if (!model) return "default model"
  const slash = model.indexOf("/")
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const provider = api.state.provider.find((p) => p.id === providerID)
  return provider?.models[modelID]?.name ?? modelID
}

/** Model picker built from the providers; `onPick` gets "providerID/modelID" or undefined. */
function pickModel(api: TuiPluginApi, current: string | undefined, onPick: (model: string | undefined) => void): void {
  const options: DialogSelectOption<string>[] = [
    {
      value: "__default__",
      title: "Use default model",
      description: "Inherit the session's default model",
      category: "Action",
    },
  ]
  for (const provider of api.state.provider) {
    for (const [modelID, info] of Object.entries(provider.models)) {
      if (info.status === "deprecated") continue
      const value = `${provider.id}/${modelID}`
      options.push({
        value,
        title: info.name ?? modelID,
        description: value === current ? "(current)" : undefined,
        category: provider.name,
      })
    }
  }
  api.ui.dialog.replace(() => (
    <DialogSelect<string>
      title="Select model"
      placeholder="Search models…"
      current={current ?? "__default__"}
      options={options}
      onSelect={(opt) => onPick(opt.value === "__default__" ? undefined : opt.value)}
    />
  ))
}

/** Agent picker fetched from the server; `onPick` gets the chosen agent name. */
function pickAgent(api: TuiPluginApi, current: string | undefined, onPick: (agent: string) => void): void {
  api.client.app
    .agents({})
    .then((res) => {
      const list = (res.data ?? []).filter((a) => a.mode !== "subagent" && !a.hidden)
      const options: DialogSelectOption<string>[] =
        list.length === 0
          ? [
              {
                value: Store.DEFAULT_AGENT,
                title: Store.DEFAULT_AGENT,
                category: "Agent",
              },
            ]
          : list.map((a) => ({
              value: a.name,
              title: a.name,
              description: a.name === current ? "(current)" : a.description,
              category: "Agents",
            }))
      api.ui.dialog.replace(() => (
        <DialogSelect<string>
          title="Select agent"
          placeholder="Search agents…"
          current={current}
          options={options}
          onSelect={(opt) => onPick(opt.value)}
        />
      ))
    })
    .catch(() => onPick(current ?? Store.DEFAULT_AGENT))
}

// ── Stage editor ──────────────────────────────────────────────────────────────

/** Collect a stage's fields (objective → agent → model → budget) then call onDone. */
function collectStage(
  api: TuiPluginApi,
  initial: Store.StageDraft,
  onDone: (stage: Store.StageDraft) => void,
  onCancel: () => void,
): void {
  const askObjective = (cur: Store.StageDraft) => {
    api.ui.dialog.replace(() => (
      <DialogPrompt
        title="Stage · objective"
        placeholder="e.g. explore the codebase and report findings"
        value={cur.objective ?? ""}
        onConfirm={(value) => {
          const objective = value.trim()
          const error = Store.validateStage({ objective })
          if (error) {
            api.ui.toast({ variant: "error", message: error })
            askObjective({ ...cur, objective })
            return
          }
          pickAgent(api, cur.agent, (agent) => askModel({ ...cur, objective, agent }))
        }}
        onCancel={onCancel}
      />
    ))
  }
  const askModel = (cur: Store.StageDraft) => {
    pickModel(api, cur.model, (model) => askBudget({ ...cur, model }))
  }
  const askBudget = (cur: Store.StageDraft) => {
    api.ui.dialog.replace(() => (
      <DialogPrompt
        title="Stage · token budget (optional)"
        placeholder="e.g. 200000 — leave empty for none"
        value={cur.tokenBudget ? String(cur.tokenBudget) : ""}
        onConfirm={(raw) => {
          const text = raw.trim()
          let tokenBudget: number | undefined
          if (text) {
            const parsed = Number(text)
            if (!Number.isInteger(parsed) || parsed <= 0) {
              api.ui.toast({
                variant: "error",
                message: "Token budget must be a positive integer",
              })
              askBudget(cur)
              return
            }
            tokenBudget = parsed
          }
          const stage: Store.StageDraft = {
            objective: cur.objective,
            agent: cur.agent,
            model: cur.model,
            tokenBudget,
          }
          const error = Store.validateStage(stage)
          if (error) {
            api.ui.toast({ variant: "error", message: error })
            onCancel()
            return
          }
          onDone(stage)
        }}
        onCancel={onCancel}
      />
    ))
  }
  askObjective(initial)
}

function stageDescription(api: TuiPluginApi, stage: Store.LoopStage): string {
  const budget = stage.tokenBudget ? ` · ${stage.tokenBudget} tok` : ""
  return `@${stage.agent} · ${modelLabel(api, stage.model)}${budget}`
}

function openStages(api: TuiPluginApi, def: Store.LoopDefinition): void {
  type StageValue = { kind: "stage"; index: number } | { kind: "add" } | { kind: "back" }
  const options: DialogSelectOption<StageValue>[] = def.stages.map((stage, index) => ({
    title: `${index + 1}. ${stage.name}`,
    value: { kind: "stage", index } as StageValue,
    description: stageDescription(api, stage),
    category: "Stages",
  }))
  options.push(
    {
      title: "＋ Add stage",
      value: { kind: "add" },
      description: "Append a step to the pipeline",
      category: "Actions",
    },
    {
      title: "← Back",
      value: { kind: "back" },
      description: "Return to actions",
      category: "Actions",
    },
  )

  api.ui.dialog.replace(() => (
    <DialogSelect<StageValue>
      title={`${def.name} · stages`}
      options={options}
      onSelect={(opt) => {
        if (opt.value.kind === "back") openActions(api, def)
        else if (opt.value.kind === "add") {
          collectStage(
            api,
            { objective: "" },
            (stage) => {
              const next = {
                ...def,
                stages: [...def.stages, Store.stageFromDraft(stage)],
              }
              Store.upsert(api.kv, next)
              void Runner.persist(api, next).then((saved) => {
                api.ui.toast({ variant: "success", message: "Stage added" })
                openStages(api, saved)
              })
            },
            () => openStages(api, def),
          )
        } else {
          stageActions(api, def, opt.value.index)
        }
      }}
    />
  ))
}

function stageActions(api: TuiPluginApi, def: Store.LoopDefinition, index: number): void {
  const stage = def.stages[index]
  if (!stage) {
    openStages(api, def)
    return
  }
  type Action = "edit" | "up" | "down" | "remove" | "back"
  const options: DialogSelectOption<Action>[] = [{ title: "Edit stage", value: "edit", description: stage.objective }]
  if (index > 0) options.push({ title: "Move up", value: "up", description: "Run earlier" })
  if (index < def.stages.length - 1)
    options.push({
      title: "Move down",
      value: "down",
      description: "Run later",
    })
  options.push(
    {
      title: "Remove stage",
      value: "remove",
      description: def.stages.length <= 1 ? "(a loop needs one stage)" : "Drop this step",
    },
    { title: "← Back", value: "back", description: "Return to stages" },
  )

  const save = (stages: Store.LoopStage[]) => {
    const next = { ...def, stages }
    Store.upsert(api.kv, next)
    // Fire-and-forget the server-side persist; the bus event will refresh
    // any reactive surface, and `openStages(api, next)` below uses the local
    // def for the immediate next step.
    void Runner.persist(api, next).catch(() => {})
    return next
  }

  api.ui.dialog.replace(() => (
    <DialogSelect<Action>
      title={`${def.name} · stage ${index + 1}`}
      options={options}
      onSelect={(opt) => {
        switch (opt.value) {
          case "edit":
            collectStage(
              api,
              { ...stage },
              (draft) => {
                const stages = [...def.stages]
                stages[index] = Store.stageFromDraft(draft)
                save(stages)
                api.ui.toast({ variant: "success", message: "Stage updated" })
                const fresh = reload(api, def.id)
                if (fresh) openStages(api, fresh)
              },
              () => stageActions(api, def, index),
            )
            break
          case "up": {
            const stages = [...def.stages]
            ;[stages[index - 1], stages[index]] = [stages[index], stages[index - 1]]
            openStages(api, save(stages))
            break
          }
          case "down": {
            const stages = [...def.stages]
            ;[stages[index + 1], stages[index]] = [stages[index], stages[index + 1]]
            openStages(api, save(stages))
            break
          }
          case "remove":
            if (def.stages.length <= 1) {
              api.ui.toast({
                variant: "error",
                message: "A loop needs at least one stage",
              })
              stageActions(api, def, index)
              return
            }
            openStages(api, save(def.stages.filter((_, i) => i !== index)))
            break
          case "back":
            openStages(api, def)
            break
        }
      }}
    />
  ))
}

// ── Run history & stats hub ──────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 60_000) return "just now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

function showRunDetail(api: TuiPluginApi, def: Store.LoopDefinition, run: Store.LoopRun | undefined): void {
  if (!run) {
    openHistory(api, def)
    return
  }
  const duration = Store.formatDuration(Math.max(0, run.endedAt - run.startedAt))
  const lines = [
    `Outcome:  ${run.ok ? "✓ ok" : "✗ error"}`,
    `When:     ${new Date(run.endedAt).toLocaleString()} (${relativeTime(run.endedAt)})`,
    `Duration: ${duration}`,
    `Diff:     +${run.additions} / -${run.deletions} across ${run.files} file${run.files === 1 ? "" : "s"}`,
  ]
  if (run.stages && run.stages.length > 0) {
    lines.push("", "Stages:")
    for (const s of run.stages) {
      lines.push(`  ${s.ok ? "✓" : "✗"} ${s.name}  +${s.additions}/-${s.deletions}${s.error ? `  · ${s.error}` : ""}`)
    }
  }
  if (run.error) lines.push("", `Error:    ${run.error}`)

  const sessionID = run.sessionID
  if (sessionID) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogConfirm
        title={`${def.name} · run detail`}
        message={`${lines.join("\n")}\n\nOpen the session for this run?`}
        onConfirm={() => {
          api.route.navigate("session", { sessionID })
          api.ui.dialog.clear()
        }}
        onCancel={() => openHistory(api, def)}
      />
    ))
    return
  }
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert
      title={`${def.name} · run detail`}
      message={lines.join("\n")}
      onConfirm={() => openHistory(api, def)}
    />
  ))
}

function openHistory(api: TuiPluginApi, def: Store.LoopDefinition): void {
  const runs = Store.loadHistory(api.kv, def.id)
  const stats = Store.loopStats(runs)
  const pct = stats.total === 0 ? "—" : `${Math.round(stats.successRate * 100)}%`
  const subtitle =
    stats.total === 0
      ? "no runs yet"
      : `${stats.ok}/${stats.total} ok · ${pct} · +${stats.additions}/-${stats.deletions}`

  type HistoryValue = { kind: "run"; index: number } | { kind: "clear" } | { kind: "back" }
  const options: DialogSelectOption<HistoryValue>[] = runs.map((run, index) => {
    const glyph = run.ok ? "✓" : "✗"
    const duration = Store.formatDuration(Math.max(0, run.endedAt - run.startedAt))
    const diff = run.additions || run.deletions ? ` · +${run.additions}/-${run.deletions} (${run.files}f)` : ""
    const stageCount = run.stages && run.stages.length > 0 ? ` · ${run.stages.length} stages` : ""
    return {
      title: `${glyph} ${relativeTime(run.endedAt)}`,
      value: { kind: "run", index } as HistoryValue,
      description: `${duration}${diff}${stageCount}${run.error ? ` · ${run.error}` : ""}`,
      category: "Runs",
      footer: (
        <span
          style={{
            fg: run.ok ? api.theme.current.success : api.theme.current.error,
          }}
        >
          {run.ok ? "ok" : "error"}
        </span>
      ),
    }
  })
  if (runs.length > 0) {
    options.push({
      title: "Clear history",
      value: { kind: "clear" },
      description: "Forget recorded runs",
      category: "Actions",
    })
  }
  options.push({
    title: "← Back",
    value: { kind: "back" },
    description: "Return to actions",
    category: "Actions",
  })

  api.ui.dialog.replace(() => (
    <DialogSelect<HistoryValue>
      title={`${def.name} · ${subtitle}`}
      options={options}
      onSelect={(opt) => {
        if (opt.value.kind === "clear") {
          Store.clearHistory(api.kv, def.id)
          api.ui.toast({ variant: "success", message: "History cleared" })
          openHistory(api, def)
        } else if (opt.value.kind === "back") {
          openActions(api, def)
        } else if (opt.value.kind === "run") {
          showRunDetail(api, def, runs[opt.value.index])
        }
      }}
    />
  ))
}

// ── Creation wizard ───────────────────────────────────────────────────────────

type WizardDraft = {
  name?: string
  intervalMs?: number
  maxRuns?: number
  stage: Store.StageDraft
}

export function openWizard(api: TuiPluginApi): void {
  askStarter(api)
}

/** First step: pick a starting point (blank / template / generate). */
function askStarter(api: TuiPluginApi): void {
  type Starter = "blank" | "template" | "generate" | "back"
  const options: DialogSelectOption<Starter>[] = [
    {
      title: "Blank pipeline",
      value: "blank",
      description: "Start with an empty objective and build it up",
      category: "Start",
    },
    {
      title: "From a template",
      value: "template",
      description: "Pre-built pipelines: babysit-pr, keep-tests-green, docs-sync, nightly-qa",
      category: "Start",
    },
    {
      title: "Generate from description",
      value: "generate",
      description: "Describe what you want and an AI will draft the pipeline",
      category: "Start",
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to the loop list",
      category: "Start",
    },
  ]
  api.ui.dialog.replace(() => (
    <DialogSelect<Starter>
      title="New loop · start with"
      options={options}
      onSelect={(opt) => {
        if (opt.value === "blank") askName(api, { stage: { objective: "" } })
        else if (opt.value === "template") openTemplateGallery(api)
        else if (opt.value === "generate") askGenerateDescription(api)
        else openManager(api)
      }}
    />
  ))
}

/** Template gallery — pick a template, then funnel into the rest of the wizard. */
function openTemplateGallery(api: TuiPluginApi): void {
  const templates = Store.LOOP_TEMPLATES
  type TemplateValue = { kind: "template"; index: number } | { kind: "back" }
  const options: DialogSelectOption<TemplateValue>[] = templates.map((t, index) => ({
    title: t.title,
    value: { kind: "template", index } as TemplateValue,
    description: t.description,
    category: "Templates",
  }))
  options.push({
    title: "← Back",
    value: { kind: "back" },
    description: "Return to starter options",
    category: "Start",
  })
  api.ui.dialog.replace(() => (
    <DialogSelect<TemplateValue>
      title="New loop · templates"
      options={options}
      onSelect={(opt) => {
        if (opt.value.kind === "back") {
          askStarter(api)
          return
        }
        const template = templates[opt.value.index]
        if (!template) return
        // Materialize the template into a draft and walk it through the wizard.
        const draft: WizardDraft = {
          ...(template.draft.name ? { name: template.draft.name } : {}),
          ...(template.draft.intervalMs !== undefined ? { intervalMs: template.draft.intervalMs } : {}),
          ...(template.draft.maxRuns !== undefined ? { maxRuns: template.draft.maxRuns } : {}),
          stage: {
            objective: template.draft.stages[0]?.objective ?? "",
            ...(template.draft.stages[0]?.name ? { name: template.draft.stages[0].name } : {}),
            ...(template.draft.stages[0]?.agent ? { agent: template.draft.stages[0].agent } : {}),
          },
        }
        // For multi-stage templates, drop the user into the wizard at the
        // first stage. The wizard currently collects a single stage; the
        // remaining stages are picked up via the stage editor after creation.
        api.ui.toast({
          variant: "info",
          message: `Template loaded — fill in stage details, then add the rest from the actions menu.`,
        })
        collectFirstStage(api, draft)
      }}
    />
  ))
}

/** Generate-from-description: prompt the user, then funnel the result into the wizard. */
function askGenerateDescription(api: TuiPluginApi): void {
  const api2 = new LoopApi(api.client)
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · describe what you want"
      placeholder="e.g. Watch CI on PR #1234 every 10m and fix any failing checks"
      description={() => (
        <text fg={api.theme.current.textMuted}>
          The AI will draft a multi-stage pipeline. You'll review before saving.
        </text>
      )}
      onConfirm={async (value) => {
        const description = value.trim()
        if (!description) {
          askStarter(api)
          return
        }
        api.ui.toast({
          variant: "info",
          message: "Asking the model to draft a pipeline…",
        })
        try {
          const def = await api2.generateFromDescription(description, {
            agent: "general",
          })
          // The generated LoopDefinition is fully formed; offer to save as-is or
          // open it in the stage editor. For now we just save and open the
          // stage editor so the user can tweak before it triggers.
          const saved = await new LoopApi(api.client).upsert(def)
          await Runner.syncAll(api)
          api.ui.toast({
            variant: "success",
            message: `Drafted "${saved.name}" — review stages before saving`,
          })
          openStages(api, saved)
        } catch (error) {
          api.ui.toast({
            variant: "error",
            message: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
          })
          askStarter(api)
        }
      }}
      onCancel={() => askStarter(api)}
    />
  ))
}

function askName(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · name (optional)"
      placeholder="Leave empty to derive from the first stage"
      value={draft.name ?? ""}
      onConfirm={(value) => askSchedule(api, { ...draft, name: value.trim() || undefined })}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function askSchedule(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · schedule (optional)"
      placeholder="e.g. 10m, 1h — leave empty to run manually"
      value={draft.intervalMs ? Store.formatDuration(draft.intervalMs) : ""}
      onConfirm={(raw) => {
        const text = raw.trim()
        if (!text) {
          // Manual loops have no temporal cap — skip the run-cap step.
          collectFirstStage(api, {
            ...draft,
            intervalMs: undefined,
            maxRuns: undefined,
          })
          return
        }
        try {
          const everyMs = Store.parseDuration(text)
          if (everyMs < Store.MIN_INTERVAL_MS) {
            throw new Error(`Interval must be at least ${Store.formatDuration(Store.MIN_INTERVAL_MS)}`)
          }
          askMaxRuns(api, { ...draft, intervalMs: everyMs })
        } catch (error) {
          api.ui.toast({
            variant: "error",
            message: error instanceof Error ? error.message : String(error),
          })
          askSchedule(api, draft)
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function askMaxRuns(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · run cap (optional)"
      placeholder="Stop after N runs — leave empty for unlimited"
      value={draft.maxRuns ? String(draft.maxRuns) : ""}
      onConfirm={(raw) => {
        const text = raw.trim()
        let maxRuns: number | undefined
        if (text) {
          const parsed = Number(text)
          if (!Number.isInteger(parsed) || parsed <= 0) {
            api.ui.toast({
              variant: "error",
              message: "Run cap must be a positive integer",
            })
            askMaxRuns(api, draft)
            return
          }
          maxRuns = parsed
        }
        collectFirstStage(api, { ...draft, maxRuns })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function collectFirstStage(api: TuiPluginApi, draft: WizardDraft): void {
  collectStage(
    api,
    draft.stage,
    (stage) => finalize(api, { ...draft, stage }),
    () => api.ui.dialog.clear(),
  )
}

function finalize(api: TuiPluginApi, draft: WizardDraft): void {
  try {
    const draftDef = Store.createDefinition({
      name: draft.name,
      intervalMs: draft.intervalMs,
      maxRuns: draft.maxRuns,
      stages: [draft.stage],
    })
    // Use the server-assigned id so subsequent calls reference the right
    // loop. The local cache is updated by Runner.persist before returning.
    void Runner.persist(api, draftDef).then((def) => {
      api.ui.toast({
        variant: "success",
        message: `Loop "${def.name}" created — add more stages or go back`,
      })
      // Drop the user into the stage editor so adding more pipeline steps is immediate.
      openStages(api, def)
    })
  } catch (error) {
    api.ui.toast({
      variant: "error",
      message: error instanceof Error ? error.message : String(error),
    })
    api.ui.dialog.clear()
  }
}
