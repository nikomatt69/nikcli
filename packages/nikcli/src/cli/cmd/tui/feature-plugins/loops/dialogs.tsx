/**
 * Loops — management dialogs: manager list, per-loop actions, and the creation
 * wizard. Built on the internal DialogSelect/DialogPrompt components (available
 * to internal feature plugins, mirroring system/plugins.tsx).
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import * as Store from "./store"
import * as Runner from "./runner"

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
    description: def.objective,
    category: "Loops",
    footer: footer(api, def),
  }))
  rows.push({
    title: "＋ New loop",
    value: { kind: "new" },
    description: "Define an objective and a trigger",
    category: "Actions",
  })
  return rows
}

export function openManager(api: TuiPluginApi): void {
  // Selecting a loop opens its actions submenu (run/pause/toggle/edit/delete).
  // We deliberately avoid single-letter quick keybinds here: DialogSelect matches
  // keybinds on every keystroke without checking filter focus, so a bare "d"/"r"
  // would fire while the user is typing in the search box (e.g. an accidental
  // delete). Routing through the submenu also keeps deletion behind a confirm.
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

function openActions(api: TuiPluginApi, def: Store.LoopDefinition): void {
  const rt = Runner.runtimeOf(def.id)
  type Action =
    | "run"
    | "pause"
    | "resume"
    | "toggle"
    | "objective"
    | "schedule"
    | "model"
    | "history"
    | "delete"
    | "back"
  const stats = Store.loopStats(Store.loadHistory(api.kv, def.id))
  const options: DialogSelectOption<Action>[] = [
    { title: "Run now", value: "run", description: "Kick one autonomous goal run immediately" },
  ]
  if (rt.status === "paused") options.push({ title: "Resume", value: "resume", description: "Resume scheduling" })
  else if (def.trigger.kind === "interval")
    options.push({ title: "Pause", value: "pause", description: "Stop the timer until resumed" })
  options.push(
    {
      title: def.enabled ? "Disable" : "Enable",
      value: "toggle",
      description: def.enabled ? "Stop triggering this loop" : "Allow this loop to trigger",
    },
    { title: "Edit objective", value: "objective", description: def.objective },
    {
      title: "Edit schedule",
      value: "schedule",
      description: def.trigger.kind === "interval" ? `every ${Store.formatDuration(def.trigger.everyMs)}` : "manual",
    },
    { title: "Edit model", value: "model", description: modelLabel(api, def.model) },
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
            api.ui.toast({ variant: "info", message: `Running "${def.name}"…` })
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
            const next = Store.setEnabled(api.kv, def.id, !def.enabled)
            if (next) Runner.syncAll(api)
            openManager(api)
            break
          }
          case "objective":
            editObjective(api, def)
            break
          case "schedule":
            editSchedule(api, def)
            break
          case "model":
            editModel(api, def)
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
        void Runner.stop(api, def.id)
        Store.removeById(api.kv, def.id)
        Store.clearHistory(api.kv, def.id)
        Runner.syncAll(api)
        api.ui.toast({ variant: "success", message: `Deleted "${def.name}"` })
        openManager(api)
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

function editObjective(api: TuiPluginApi, def: Store.LoopDefinition): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Edit objective"
      placeholder="What should this loop accomplish?"
      value={def.objective}
      onConfirm={(value) => {
        const objective = value.trim()
        if (!objective) {
          api.ui.toast({ variant: "error", message: "Objective is required" })
          editObjective(api, def)
          return
        }
        Store.upsert(api.kv, { ...def, objective })
        Runner.syncAll(api)
        api.ui.toast({ variant: "success", message: "Objective updated" })
        openManager(api)
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
            const draftError = Store.validateDraft({ objective: def.objective, intervalMs: everyMs })
            if (draftError) throw new Error(draftError)
            trigger = { kind: "interval", everyMs }
          } catch (error) {
            api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
            editSchedule(api, def)
            return
          }
        }
        Store.upsert(api.kv, { ...def, trigger })
        Runner.syncAll(api)
        api.ui.toast({ variant: "success", message: "Schedule updated" })
        openManager(api)
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

// ── Model selection (mirrors the advisor model picker) ──────────────────────

/** Resolve a "providerID/modelID" reference to a friendly label, or "default model". */
export function modelLabel(api: TuiPluginApi, model?: string): string {
  if (!model) return "default model"
  const slash = model.indexOf("/")
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const provider = api.state.provider.find((p) => p.id === providerID)
  return provider?.models[modelID]?.name ?? modelID
}

/**
 * Open a model picker built from the available providers. Calls `onPick` with the
 * chosen "providerID/modelID", or undefined for the session default.
 */
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

function editModel(api: TuiPluginApi, def: Store.LoopDefinition): void {
  pickModel(api, def.model, (model) => {
    Store.upsert(api.kv, { ...def, ...(model ? { model } : { model: undefined }) })
    Runner.syncAll(api)
    api.ui.toast({ variant: "success", message: `Model set to ${modelLabel(api, model)}` })
    openManager(api)
  })
}

// ── Run history & stats hub ──────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 60_000) return "just now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
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
    return {
      title: `${glyph} ${relativeTime(run.endedAt)}`,
      value: { kind: "run", index } as HistoryValue,
      description: `${duration}${diff}${run.error ? ` · ${run.error}` : ""}`,
      category: "Runs",
      footer: (
        <span style={{ fg: run.ok ? api.theme.current.success : api.theme.current.error }}>{run.ok ? "ok" : "error"}</span>
      ),
    }
  })
  if (runs.length > 0) {
    options.push({ title: "Clear history", value: { kind: "clear" }, description: "Forget recorded runs", category: "Actions" })
  }
  options.push({ title: "← Back", value: { kind: "back" }, description: "Return to actions", category: "Actions" })

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
        }
      }}
    />
  ))
}

// ── Creation wizard (chained prompts) ───────────────────────────────────────

type WizardDraft = { objective?: string; name?: string; model?: string; intervalMs?: number; tokenBudget?: number }

export function openWizard(api: TuiPluginApi): void {
  askObjective(api, {})
}

function askObjective(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · objective"
      placeholder="e.g. keep CI green on PR #1234"
      value={draft.objective ?? ""}
      onConfirm={(value) => {
        const objective = value.trim()
        if (!objective) {
          api.ui.toast({ variant: "error", message: "Objective is required" })
          askObjective(api, draft)
          return
        }
        askName(api, { ...draft, objective })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function askName(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · name (optional)"
      placeholder="Leave empty to derive from the objective"
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
      onConfirm={(raw) => {
        const text = raw.trim()
        if (!text) {
          askBudget(api, { ...draft, intervalMs: undefined })
          return
        }
        try {
          const everyMs = Store.parseDuration(text)
          const error = Store.validateDraft({ objective: draft.objective ?? "", intervalMs: everyMs })
          if (error) throw new Error(error)
          askBudget(api, { ...draft, intervalMs: everyMs })
        } catch (error) {
          api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
          askSchedule(api, draft)
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function askBudget(api: TuiPluginApi, draft: WizardDraft): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New loop · token budget (optional)"
      placeholder="e.g. 200000 — leave empty for none"
      onConfirm={(raw) => {
        const text = raw.trim()
        let tokenBudget: number | undefined
        if (text) {
          const parsed = Number(text)
          if (!Number.isInteger(parsed) || parsed <= 0) {
            api.ui.toast({ variant: "error", message: "Token budget must be a positive integer" })
            askBudget(api, draft)
            return
          }
          tokenBudget = parsed
        }
        askModel(api, { ...draft, tokenBudget })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function askModel(api: TuiPluginApi, draft: WizardDraft): void {
  pickModel(api, draft.model, (model) => finalize(api, { ...draft, model }))
}

function finalize(api: TuiPluginApi, draft: WizardDraft): void {
  try {
    const def = Store.createDefinition({
      objective: draft.objective ?? "",
      name: draft.name,
      model: draft.model,
      intervalMs: draft.intervalMs,
      tokenBudget: draft.tokenBudget,
    })
    Store.upsert(api.kv, def)
    Runner.syncAll(api)
    api.ui.toast({ variant: "success", message: `Loop "${def.name}" created` })
    openManager(api)
  } catch (error) {
    api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
    api.ui.dialog.clear()
  }
}
