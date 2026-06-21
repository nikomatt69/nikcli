/**
 * Missions — TUI plugin: management dialogs.
 *
 * Mirrors `feature-plugins/loops/dialogs.tsx`. Three views:
 *   - `openManager` lists missions + offers "New mission" (template / LLM / blank)
 *   - `openActions` shows per-mission controls (start, pause, cancel, edit, delete)
 *   - `openHistory` lists recent executions with status + diff attribution
 *
 * The actual work (persistence, orchestration) is delegated to the server's
 * `MissionOrchestrator`; the dialogs only collect user intent and call the
 * reactive store's mutators.
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import * as Store from "./store"
import * as Runner from "./runner"
import { MissionApi, type MissionDefinition, type MissionFeature, type MissionRuntimeStatus } from "./sdk"

export function toneColor(theme: TuiPluginApi["theme"]["current"], tone: Runner.MissionTone): RGBA {
  switch (tone) {
    case "running":
      return theme.warning
    case "error":
      return theme.error
    case "ok":
      return theme.success
    case "frozen":
      return theme.textMuted
    default:
      return theme.textMuted
  }
}

function progressLine(def: Store.MissionDefinition): string {
  const p = Store.progressOf(def)
  const pct = p.totalFeatures === 0 ? 0 : Math.round((p.doneFeatures / p.totalFeatures) * 100)
  return `${p.doneFeatures}/${p.totalFeatures} features · ${p.doneMilestones}/${p.totalMilestones} milestones · ${pct}%`
}

function briefSummary(def: Store.MissionDefinition): string {
  return def.brief.length <= 80 ? def.brief : `${def.brief.slice(0, 79)}…`
}

// ── Model & agent pickers (mirrors feature-plugins/loops/dialogs.tsx) ──────────

/** Resolve a "providerID/modelID" reference to a friendly label, or "default model". */
function modelLabel(api: TuiPluginApi, model?: string): string {
  if (!model) return "default model"
  const slash = model.indexOf("/")
  if (slash <= 0) return model
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const provider = api.state.provider.find((p) => p.id === providerID)
  return provider?.models[modelID]?.name ?? modelID
}

/** Model picker built from the providers; `onPick` gets "providerID/modelID" or undefined. */
function pickModel(
  api: TuiPluginApi,
  title: string,
  current: string | undefined,
  onPick: (model: string | undefined) => void,
): void {
  const options: DialogSelectOption<string>[] = [
    {
      value: "__default__",
      title: "Use default model",
      description: "Inherit the mission/session default model",
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
      title={title}
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
          ? [{ value: "ralph", title: "ralph", category: "Agent" }]
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
    .catch(() => onPick(current ?? "ralph"))
}

function footer(api: TuiPluginApi, def: Store.MissionDefinition) {
  const rt = Runner.runtimeOf(def.id)
  const info = Runner.statusInfo(def, rt)
  return <span style={{ fg: toneColor(api.theme.current, info.tone) }}>{info.label}</span>
}

type ManagerValue = { kind: "new" } | { kind: "mission"; id: string }

function missionOptions(api: TuiPluginApi): DialogSelectOption<ManagerValue>[] {
  const missions = Store.loadAll(api.kv)
  const rows: DialogSelectOption<ManagerValue>[] = missions.map((def) => ({
    title: def.name,
    value: { kind: "mission", id: def.id } as ManagerValue,
    description: progressLine(def),
    category: "Missions",
    footer: footer(api, def),
  }))
  rows.push({
    title: "＋ New mission",
    value: { kind: "new" } as ManagerValue,
    description: "Plan a multi-milestone workflow (template, LLM, or blank)",
    category: "Actions",
  })
  return rows
}

export function openManager(api: TuiPluginApi): void {
  api.ui.dialog.replace(() => (
    <DialogSelect<ManagerValue>
      title="Missions"
      placeholder="Search missions…"
      options={missionOptions(api)}
      onSelect={(opt) => {
        if (opt.value.kind === "new") {
          openNew(api)
          return
        }
        const def = Store.getById(api.kv, opt.value.id)
        if (def) openActions(api, def)
      }}
    />
  ))
}

type NewSource = "template" | "llm" | "blank"

function openNew(api: TuiPluginApi): void {
  const options: DialogSelectOption<NewSource>[] = [
    {
      title: "From template",
      value: "template",
      description: "Pick a built-in starter brief",
      category: "Sources",
    },
    {
      title: "Generate from description",
      value: "llm",
      description: "Let the model author a milestone+feature plan from a prompt",
      category: "Sources",
    },
    {
      title: "Blank brief",
      value: "blank",
      description: "Single-feature mission from a free-form brief",
      category: "Sources",
    },
    {
      title: "← Back",
      value: "blank",
      description: "Return to mission list",
      category: "Back",
    },
  ]
  // Replace the "blank" duplicate by giving the back option a sentinel.
  options[3] = {
    title: "← Back",
    value: "blank",
    description: "Return to mission list",
    category: "Back",
  }
  api.ui.dialog.replace(() => (
    <DialogSelect<NewSource>
      title="New mission"
      placeholder="Pick a source…"
      options={options}
      onSelect={(opt) => {
        switch (opt.value) {
          case "template":
            openTemplatePicker(api)
            break
          case "llm":
            openLLMWizard(api)
            break
          case "blank":
            openBlankWizard(api)
            break
        }
      }}
    />
  ))
}

async function openTemplatePicker(api: TuiPluginApi): Promise<void> {
  const api2 = new MissionApi(api.client)
  const templates = await api2.templates()
  const options: DialogSelectOption<{ id: string; title: string }>[] = templates.map((t) => ({
    title: t.title,
    value: { id: t.id, title: t.title },
    description: t.description,
    category: "Templates",
  }))
  api.ui.dialog.replace(() => (
    <DialogSelect<{ id: string; title: string }>
      title="Mission templates"
      placeholder="Pick a template…"
      options={options}
      onSelect={(opt) => {
        const brief = templates.find((t) => t.id === opt.value.id)?.brief
        openLLMWizard(api, { templateBrief: brief })
      }}
    />
  ))
}

function openLLMWizard(api: TuiPluginApi, preset?: { templateBrief?: string }): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Generate mission from description"
      placeholder="Describe the mission — the model will author milestones + features"
      value={preset?.templateBrief ?? ""}
      onConfirm={async (raw) => {
        const text = raw.trim()
        if (!text) {
          api.ui.toast({
            variant: "error",
            message: "Description cannot be empty",
          })
          openManager(api)
          return
        }
        const api2 = new MissionApi(api.client)
        const def = await api2.generateFromDescription(text).catch(() => undefined)
        if (!def) {
          api.ui.toast({
            variant: "error",
            message: "The model did not return a usable plan",
          })
          openManager(api)
          return
        }
        // Confirm before persistence: the model can hallucinate structure.
        confirmAndSave(api, def)
      }}
      onCancel={() => openManager(api)}
    />
  ))
}

function openBlankWizard(api: TuiPluginApi): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Blank mission brief"
      placeholder="One paragraph: what should the agent do?"
      onConfirm={async (raw) => {
        const text = raw.trim()
        if (!text) {
          api.ui.toast({ variant: "error", message: "Brief cannot be empty" })
          openManager(api)
          return
        }
        const def: MissionDefinition = {
          id: `mission_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: text.slice(0, 32),
          brief: text,
          milestones: [
            {
              id: "m1",
              name: "Main",
              features: [
                {
                  id: "f1_1",
                  name: "Execute brief",
                  objective: text,
                  agent: "ralph",
                  status: "pending",
                  dependsOn: [],
                },
              ],
              validation: "scrutiny",
              status: "pending",
            },
          ],
          models: {},
          status: "ready",
          createdAt: Date.now(),
        }
        confirmAndSave(api, def)
      }}
      onCancel={() => openManager(api)}
    />
  ))
}

function confirmAndSave(api: TuiPluginApi, def: MissionDefinition): void {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Save "${def.name}"?`}
      message={`${def.milestones.length} milestone(s) · ${def.milestones.reduce((n, m) => n + m.features.length, 0)} feature(s)\n\n${briefSummary(def)}`}
      onConfirm={async () => {
        const saved = await Runner.persist(api, def)
        if (saved) {
          api.ui.toast({
            variant: "success",
            message: `Saved "${saved.name}"`,
          })
        } else {
          api.ui.toast({ variant: "error", message: "Failed to save mission" })
        }
        openManager(api)
      }}
      onCancel={() => openManager(api)}
    />
  ))
}

type Action = "start" | "pause" | "resume" | "cancel" | "view" | "models" | "history" | "delete" | "back"

function openActions(api: TuiPluginApi, def: Store.MissionDefinition): void {
  const rt = Runner.runtimeOf(def.id)
  const options: DialogSelectOption<Action>[] = []
  if (rt.status === "running") {
    options.push({
      title: "Cancel run",
      value: "cancel",
      description: "Freeze the mission for reassessment",
    })
  } else if (def.status === "complete") {
    options.push({
      title: "Complete",
      value: "view",
      description: "All milestones done",
    })
  } else {
    options.push({
      title: rt.status === "paused" || def.status === "frozen" ? "Resume" : "Start",
      value: "start",
      description:
        rt.status === "paused" || def.status === "frozen"
          ? "Pick up where the orchestrator left off"
          : "Drive the mission forward",
    })
    if ((rt.status as MissionRuntimeStatus) === "running") {
      options.push({
        title: "Pause",
        value: "pause",
        description: "Stop at the next safe point",
      })
    }
  }
  options.push(
    {
      title: "View plan",
      value: "view",
      description: `${def.milestones.length} milestone(s) · ${def.milestones.reduce((n, m) => n + m.features.length, 0)} feature(s)`,
    },
    {
      title: "Edit models",
      value: "models",
      description: `worker ${modelLabel(api, def.models.worker)} · validation ${modelLabel(api, def.models.validation)}`,
    },
    {
      title: "History",
      value: "history",
      description: "Recent feature/validation runs",
    },
    {
      title: "Delete",
      value: "delete",
      description: "Remove this mission and its history",
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to the mission list",
    },
  )
  api.ui.dialog.replace(() => (
    <DialogSelect<Action>
      title={def.name}
      options={options}
      onSelect={async (opt) => {
        switch (opt.value) {
          case "start": {
            await Runner.start(api, def.id)
            api.ui.toast({
              variant: "info",
              message: `Starting "${def.name}"…`,
            })
            openManager(api)
            break
          }
          case "pause": {
            await Runner.pause(api, def.id)
            openManager(api)
            break
          }
          case "resume": {
            await Runner.start(api, def.id)
            openManager(api)
            break
          }
          case "cancel": {
            await Runner.cancel(api, def.id)
            api.ui.toast({
              variant: "info",
              message: `Cancelled "${def.name}"`,
            })
            openManager(api)
            break
          }
          case "view":
            openView(api, def)
            break
          case "models":
            openModels(api, def)
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

/** Edit the three role models a mission orchestrator uses. */
function openModels(api: TuiPluginApi, def: Store.MissionDefinition): void {
  type Role = "worker" | "validation" | "orchestrator" | "back"
  const options: DialogSelectOption<Role>[] = [
    {
      title: "Worker model",
      value: "worker",
      description: modelLabel(api, def.models.worker),
      category: "Roles",
    },
    {
      title: "Validation model",
      value: "validation",
      description: modelLabel(api, def.models.validation),
      category: "Roles",
    },
    {
      title: "Orchestrator model",
      value: "orchestrator",
      description: modelLabel(api, def.models.orchestrator),
      category: "Roles",
    },
    { title: "← Back", value: "back", description: "Return to the action menu", category: "Actions" },
  ]
  const persistModels = (role: Exclude<Role, "back">, model: string | undefined) => {
    const models: Store.MissionModels = { ...def.models }
    if (model) models[role] = model
    else delete models[role]
    const next = { ...def, models }
    void Runner.persist(api, next).then((saved) => {
      api.ui.toast({ variant: "success", message: `${role} model updated` })
      openModels(api, saved ?? next)
    })
  }
  api.ui.dialog.replace(() => (
    <DialogSelect<Role>
      title={`${def.name} — models`}
      options={options}
      onSelect={(opt) => {
        if (opt.value === "back") {
          openActions(api, def)
          return
        }
        const role = opt.value
        pickModel(api, `Select ${role} model`, def.models[role], (model) => persistModels(role, model))
      }}
    />
  ))
}

function openView(api: TuiPluginApi, def: Store.MissionDefinition): void {
  type ViewAction = "edit-feature" | "back"
  const featureOptions: DialogSelectOption<{
    action: ViewAction
    feature: MissionFeature
    milestone: string
  }>[] = []
  for (const m of def.milestones) {
    for (const f of m.features) {
      const tick = featureIcon(f.status)
      featureOptions.push({
        title: `${tick} ${f.id} ${f.name}`,
        value: { action: "edit-feature", feature: f, milestone: m.id },
        description: `${f.agent} · ${f.status}${f.dependsOn.length > 0 ? ` · after ${f.dependsOn.join(", ")}` : ""}`,
        category: m.name,
      })
    }
  }
  featureOptions.push({
    title: "← Back",
    value: {
      action: "back",
      feature: {
        id: "",
        name: "",
        objective: "",
        agent: "",
        status: "pending",
        dependsOn: [],
      },
      milestone: "",
    },
    description: "Return to the action menu",
    category: "Actions",
  })
  api.ui.dialog.replace(() => (
    <DialogSelect<{
      action: ViewAction
      feature: MissionFeature
      milestone: string
    }>
      title={`${def.name} — plan`}
      placeholder="Pick a feature to intervene…"
      options={featureOptions}
      onSelect={(opt) => {
        if (opt.value.action === "back") {
          openActions(api, def)
          return
        }
        openFeatureActions(api, def, opt.value.milestone, opt.value.feature)
      }}
    />
  ))
}

function featureIcon(status: MissionFeature["status"]): string {
  switch (status) {
    case "done":
      return "✓"
    case "running":
      return "▶"
    case "skipped":
      return "–"
    case "error":
    case "blocked":
      return "✗"
    default:
      return "·"
  }
}

type FeatureAction =
  | "edit-objective"
  | "edit-agent"
  | "edit-model"
  | "edit-budget"
  | "mark-done"
  | "skip"
  | "reset"
  | "retry"
  | "back"

/** Replace a feature in the definition and persist the whole mission. */
function persistFeaturePatch(
  api: TuiPluginApi,
  def: Store.MissionDefinition,
  featureID: string,
  patch: Partial<MissionFeature>,
): Promise<Store.MissionDefinition | undefined> {
  const next: Store.MissionDefinition = {
    ...def,
    milestones: def.milestones.map((m) => ({
      ...m,
      features: m.features.map((f) => (f.id === featureID ? { ...f, ...patch } : f)),
    })),
  }
  return Runner.persist(api, next).then((saved) => saved ?? next)
}

function openFeatureActions(
  api: TuiPluginApi,
  def: Store.MissionDefinition,
  milestoneID: string,
  feature: MissionFeature,
): void {
  const options: DialogSelectOption<FeatureAction>[] = [
    {
      title: "Edit objective",
      value: "edit-objective",
      description: feature.objective.length <= 60 ? feature.objective : `${feature.objective.slice(0, 59)}…`,
      category: "Edit",
    },
    {
      title: "Edit agent",
      value: "edit-agent",
      description: `@${feature.agent}`,
      category: "Edit",
    },
    {
      title: "Edit model",
      value: "edit-model",
      description: modelLabel(api, feature.model),
      category: "Edit",
    },
    {
      title: "Edit token budget",
      value: "edit-budget",
      description: feature.tokenBudget ? `${feature.tokenBudget} tok` : "none",
      category: "Edit",
    },
  ]
  if (feature.status === "running" || feature.status === "error" || feature.status === "blocked") {
    options.push({
      title: "Mark done",
      value: "mark-done",
      description: "Force the feature to `done` and advance",
    })
  }
  if (feature.status === "pending" || feature.status === "running" || feature.status === "error") {
    options.push({
      title: "Skip",
      value: "skip",
      description: "Mark the feature as `skipped` (unblocks downstream)",
    })
  }
  if (feature.status === "done" || feature.status === "skipped" || feature.status === "error") {
    options.push({
      title: "Reset to pending",
      value: "reset",
      description: "Re-run the feature on the next orchestration pass",
    })
  }
  if (feature.status === "error" || feature.status === "blocked") {
    options.push({
      title: "Mark pending & resume",
      value: "retry",
      description: "Clear the error, mark pending, and resume orchestration",
    })
  }
  options.push({
    title: "← Back",
    value: "back",
    description: "Return to the plan view",
  })
  api.ui.dialog.replace(() => (
    <DialogSelect<FeatureAction>
      title={`${feature.id} ${feature.name}`}
      options={options}
      onSelect={async (opt) => {
        switch (opt.value) {
          case "edit-objective": {
            api.ui.dialog.replace(() => (
              <DialogPrompt
                title={`${feature.id} · objective`}
                placeholder="What should this feature accomplish?"
                value={feature.objective}
                onConfirm={(raw) => {
                  const objective = raw.trim()
                  if (!objective) {
                    api.ui.toast({ variant: "error", message: "Objective cannot be empty" })
                    openFeatureActions(api, def, milestoneID, feature)
                    return
                  }
                  void persistFeaturePatch(api, def, feature.id, { objective }).then((saved) => {
                    api.ui.toast({ variant: "success", message: "Objective updated" })
                    openFeatureActions(api, saved ?? def, milestoneID, { ...feature, objective })
                  })
                }}
                onCancel={() => openFeatureActions(api, def, milestoneID, feature)}
              />
            ))
            break
          }
          case "edit-agent": {
            pickAgent(api, feature.agent, (agent) => {
              void persistFeaturePatch(api, def, feature.id, { agent }).then((saved) => {
                api.ui.toast({ variant: "success", message: `Agent set to @${agent}` })
                openFeatureActions(api, saved ?? def, milestoneID, { ...feature, agent })
              })
            })
            break
          }
          case "edit-model": {
            pickModel(api, `${feature.id} · model`, feature.model, (model) => {
              void persistFeaturePatch(api, def, feature.id, { model }).then((saved) => {
                api.ui.toast({ variant: "success", message: "Model updated" })
                openFeatureActions(api, saved ?? def, milestoneID, { ...feature, model })
              })
            })
            break
          }
          case "edit-budget": {
            api.ui.dialog.replace(() => (
              <DialogPrompt
                title={`${feature.id} · token budget (optional)`}
                placeholder="e.g. 200000 — leave empty for none"
                value={feature.tokenBudget ? String(feature.tokenBudget) : ""}
                onConfirm={(raw) => {
                  const text = raw.trim()
                  let tokenBudget: number | undefined
                  if (text) {
                    const parsed = Number(text)
                    if (!Number.isInteger(parsed) || parsed <= 0) {
                      api.ui.toast({ variant: "error", message: "Token budget must be a positive integer" })
                      openFeatureActions(api, def, milestoneID, feature)
                      return
                    }
                    tokenBudget = parsed
                  }
                  void persistFeaturePatch(api, def, feature.id, { tokenBudget }).then((saved) => {
                    api.ui.toast({
                      variant: "success",
                      message: tokenBudget ? "Token budget updated" : "Token budget removed",
                    })
                    openFeatureActions(api, saved ?? def, milestoneID, { ...feature, tokenBudget })
                  })
                }}
                onCancel={() => openFeatureActions(api, def, milestoneID, feature)}
              />
            ))
            break
          }
          case "mark-done": {
            const next = await Runner.mutateFeature(api, def.id, feature.id, {
              status: "done",
            })
            if (next)
              api.ui.toast({
                variant: "success",
                message: `Marked ${feature.id} done`,
              })
            else
              api.ui.toast({
                variant: "error",
                message: `Failed to update ${feature.id}`,
              })
            openActions(api, next ?? def)
            break
          }
          case "skip": {
            const next = await Runner.mutateFeature(api, def.id, feature.id, {
              status: "skipped",
            })
            openActions(api, next ?? def)
            break
          }
          case "reset": {
            const next = await Runner.mutateFeature(api, def.id, feature.id, {
              status: "pending",
            })
            openActions(api, next ?? def)
            break
          }
          case "retry": {
            await Runner.mutateFeature(api, def.id, feature.id, {
              status: "pending",
              error: undefined,
            })
            void Runner.start(api, def.id)
            openManager(api)
            break
          }
          case "back":
            openView(api, def)
            break
        }
      }}
    />
  ))
}

function openHistory(api: TuiPluginApi, def: Store.MissionDefinition): void {
  const runs = Store.loadHistory(api.kv, def.id)
  const stats = Store.missionStats(runs)
  const summary = `ok ${stats.ok}/${stats.total} · ${Math.round(stats.successRate * 100)}% · ${stats.features} feat, ${stats.validations} val`
  const options: DialogSelectOption<{ kind: "back" }>[] = runs.map((r) => ({
    title: `${r.kind === "feature" ? "f" : "v"} ${r.targetID} ${r.targetName}`,
    value: { kind: "back" },
    description: `${r.status}${r.error ? ` — ${r.error}` : ""}${r.endedAt ? ` · ${formatRelative(r.endedAt)}` : ""}`,
    category: r.kind,
  }))
  if (options.length === 0) {
    options.push({
      title: "No runs yet",
      value: { kind: "back" },
      description: "Start the mission to record executions",
      category: "Info",
    })
  }
  options.push({
    title: `← Back (${summary})`,
    value: { kind: "back" },
    description: "Return to the action menu",
    category: "Actions",
  })
  api.ui.dialog.replace(() => (
    <DialogSelect<{ kind: "back" }>
      title={`${def.name} — history`}
      options={options}
      onSelect={() => openActions(api, def)}
    />
  ))
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`
  return `${Math.round(delta / 86_400_000)}d ago`
}

function confirmDelete(api: TuiPluginApi, def: Store.MissionDefinition): void {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title={`Delete "${def.name}"?`}
      message="This cancels any in-flight orchestration and removes the execution history."
      onConfirm={async () => {
        const ok = await Runner.remove(api, def.id)
        if (ok)
          api.ui.toast({
            variant: "success",
            message: `Deleted "${def.name}"`,
          })
        else
          api.ui.toast({
            variant: "error",
            message: `Failed to delete "${def.name}"`,
          })
        openManager(api)
      }}
      onCancel={() => openActions(api, def)}
    />
  ))
}

// Silence the unused-import warning for milestoneID (used in openView).
void (null as unknown as string)
