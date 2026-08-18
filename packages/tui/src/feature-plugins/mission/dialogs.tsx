/**
 * Missions — TUI plugin: management dialogs.
 *
 * Mirrors `feature-plugins/loops/dialogs.tsx`. Key views:
 *   - `openManager` lists missions + offers "New mission"
 *   - `openWizard` is the guided creation flow (blank / template / generate)
 *   - `openActions` shows per-mission controls (start, pause, cancel, edit, delete)
 *   - `openHistory` lists recent executions with status, drilling into run detail
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
import {
  MissionApi,
  type MissionDefinition,
  type MissionFeature,
  type MissionMilestone,
  type MissionRuntimeStatus,
} from "./sdk"

export function toneColor(theme: TuiPluginApi["theme"]["current"], tone: Runner.MissionTone): RGBA {
  switch (tone) {
    case "running":
      return theme.status.warning.fg
    case "error":
      return theme.status.error.fg
    case "ok":
      return theme.status.success.fg
    case "frozen":
      return theme.foreground.muted
    default:
      return theme.foreground.muted
  }
}

function progressLine(def: Store.MissionDefinition): string {
  const p = Store.progressOf(def)
  const pct = p.totalFeatures === 0 ? 0 : Math.round((p.doneFeatures / p.totalFeatures) * 100)
  return `${p.doneFeatures}/${p.totalFeatures} features · ${p.doneMilestones}/${p.totalMilestones} milestones · ${pct}%`
}

// ── Model & agent pickers (mirrors feature-plugins/loops/dialogs.tsx) ──────────

/**
 * The session the user is looking at, when the current route is a session.
 * Missions, loops and the drafting calls they make inherit that session's
 * model, so the work runs on the model shown in its footer rather than the
 * global default.
 */
function currentSessionID(api: TuiPluginApi): string | undefined {
  const current = api.route.current
  if (current.name !== "session") return undefined
  const sessionID = (current as { params?: { sessionID?: unknown } }).params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

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
    description: "Plan a multi-milestone workflow (blank, template, or AI-generated)",
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
          openWizard(api)
          return
        }
        const def = Store.getById(api.kv, opt.value.id)
        if (def) openActions(api, def)
      }}
    />
  ))
}

/**
 * Like `dialog.replace`, but routes Esc (which closes the top dialog) back to
 * `back` — so pressing Esc mid-wizard returns to the previous step instead of
 * tearing down the whole stack. The host runs `onClose` on *any* teardown, so
 * we guard on `depth === 0` to fire only on a real close, not a forward replace.
 * Only safe for dialogs that don't self-clear (DialogPrompt/DialogSelect), never
 * DialogConfirm/DialogAlert.
 */
function nav(
  api: TuiPluginApi,
  render: Parameters<TuiPluginApi["ui"]["dialog"]["replace"]>[0],
  back: () => void,
): void {
  api.ui.dialog.replace(render, () => {
    if (api.ui.dialog.depth === 0) back()
  })
}

// ── Creation wizard (mirrors feature-plugins/loops/dialogs.tsx) ────────────────
//
// A guided, multi-step flow where the user chooses everything: name, brief,
// the three role models, and the first feature (objective / agent / model /
// budget). Three starting points — blank, template, or generate-from-prompt —
// all converge on the plan view (`openView`) for review after creation.

type WizardFeature = {
  objective: string
  agent?: string
  model?: string
  tokenBudget?: number
}

type WizardDraft = {
  name?: string
  brief?: string
  models: Store.MissionModels
  validation?: Store.ValidationPolicy
  feature: WizardFeature
}

function emptyDraft(): WizardDraft {
  return { models: {}, feature: { objective: "" } }
}

export function openWizard(api: TuiPluginApi): void {
  askStarter(api)
}

/** First step: pick a starting point (blank / template / generate). */
function askStarter(api: TuiPluginApi): void {
  type Starter = "blank" | "template" | "generate" | "back"
  const options: DialogSelectOption<Starter>[] = [
    {
      title: "Blank mission",
      value: "blank",
      description: "Build a single-feature mission step by step",
      category: "Start",
    },
    {
      title: "From a template",
      value: "template",
      description: "Start from a built-in brief, then refine or generate",
      category: "Start",
    },
    {
      title: "Generate from description",
      value: "generate",
      description: "Describe the goal — the model drafts milestones + features",
      category: "Start",
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to the mission list",
      category: "Start",
    },
  ]
  nav(
    api,
    () => (
      <DialogSelect<Starter>
        title="New mission · start with"
        options={options}
        onSelect={(opt) => {
          if (opt.value === "blank") askName(api, emptyDraft())
          else if (opt.value === "template") openTemplateGallery(api)
          else if (opt.value === "generate") askGenerateDescription(api)
          else openManager(api)
        }}
      />
    ),
    () => openManager(api),
  )
}

/** Template gallery — pick a template, then choose to generate or build manually. */
async function openTemplateGallery(api: TuiPluginApi): Promise<void> {
  const api2 = new MissionApi(api.client)
  const templates = await api2.templates()
  type TemplateValue = { kind: "template"; id: string } | { kind: "back" }
  const options: DialogSelectOption<TemplateValue>[] = templates.map((t) => ({
    title: t.title,
    value: { kind: "template", id: t.id } as TemplateValue,
    description: t.description,
    category: "Templates",
  }))
  options.push({
    title: "← Back",
    value: { kind: "back" },
    description: "Return to starter options",
    category: "Start",
  })
  nav(
    api,
    () => (
      <DialogSelect<TemplateValue>
        title="New mission · templates"
        placeholder="Pick a template…"
        options={options}
        onSelect={(opt) => {
          if (opt.value.kind === "back") {
            askStarter(api)
            return
          }
          const id = opt.value.id
          const template = templates.find((t) => t.id === id)
          if (!template) return
          openTemplateActions(api, template.title, template.brief)
        }}
      />
    ),
    () => askStarter(api),
  )
}

/** After picking a template: generate a full plan from the brief, or build it by hand. */
function openTemplateActions(api: TuiPluginApi, title: string, brief: string): void {
  type Choice = "generate" | "manual" | "back"
  const options: DialogSelectOption<Choice>[] = [
    {
      title: "Generate plan from brief",
      value: "generate",
      description: "Let the model author milestones + features, then review",
      category: title,
    },
    {
      title: "Build manually",
      value: "manual",
      description: "Walk the wizard with the brief pre-filled",
      category: title,
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to the template list",
      category: "Actions",
    },
  ]
  nav(
    api,
    () => (
      <DialogSelect<Choice>
        title={`New mission · ${title}`}
        options={options}
        onSelect={(opt) => {
          if (opt.value === "generate") askGenerateDescription(api, { brief })
          else if (opt.value === "manual") askName(api, { models: {}, brief, feature: { objective: brief } })
          else openTemplateGallery(api)
        }}
      />
    ),
    () => openTemplateGallery(api),
  )
}

/** Generate-from-description: prompt (optionally pre-filled), draft a plan, then review. */
function askGenerateDescription(api: TuiPluginApi, preset?: { brief?: string }): void {
  nav(
    api,
    () => (
      <DialogPrompt
        title="New mission · describe what you want"
        placeholder="e.g. Add OAuth login with Google and GitHub, with tests and docs"
        value={preset?.brief ?? ""}
        description={() => (
          <text fg={api.theme.current.foreground.muted}>
            The model will draft milestones + features. You'll review the plan before it runs.
          </text>
        )}
        onConfirm={async (raw) => {
          const description = raw.trim()
          if (!description) {
            askStarter(api)
            return
          }
          api.ui.toast({
            variant: "info",
            message: "Asking the model to draft a plan…",
          })
          const api2 = new MissionApi(api.client)
          const sessionID = currentSessionID(api)
          const def = await api2
            .generateFromDescription(description, sessionID ? { sessionID } : {})
            .catch(() => undefined)
          if (!def) {
            api.ui.toast({
              variant: "error",
              message: "The model did not return a usable plan",
            })
            askStarter(api)
            return
          }
          const saved = await Runner.persist(api, def)
          api.ui.toast({
            variant: "success",
            message: `Drafted "${(saved ?? def).name}" — review the plan before starting`,
          })
          openView(api, saved ?? def)
        }}
      />
    ),
    () => askStarter(api),
  )
}

function askName(api: TuiPluginApi, draft: WizardDraft): void {
  nav(
    api,
    () => (
      <DialogPrompt
        title="New mission · name (optional)"
        placeholder="Leave empty to derive from the brief"
        value={draft.name ?? ""}
        onConfirm={(value) => askBrief(api, { ...draft, name: value.trim() || undefined })}
      />
    ),
    () => askStarter(api),
  )
}

function askBrief(api: TuiPluginApi, draft: WizardDraft): void {
  nav(
    api,
    () => (
      <DialogPrompt
        title="New mission · brief"
        placeholder="One paragraph: what should the mission accomplish?"
        value={draft.brief ?? ""}
        onConfirm={(raw) => {
          const brief = raw.trim()
          if (!brief) {
            api.ui.toast({ variant: "error", message: "Brief cannot be empty" })
            askBrief(api, draft)
            return
          }
          // Pre-fill the first feature's objective from the brief if untouched.
          const feature = draft.feature.objective.trim() ? draft.feature : { ...draft.feature, objective: brief }
          askModels(api, { ...draft, brief, feature })
        }}
      />
    ),
    () => askName(api, draft),
  )
}

/** Choose the three role models the orchestrator uses (all optional). */
function askModels(api: TuiPluginApi, draft: WizardDraft): void {
  type Role = "worker" | "validation" | "orchestrator" | "continue" | "back"
  const options: DialogSelectOption<Role>[] = [
    {
      title: "Worker model",
      value: "worker",
      description: modelLabel(api, draft.models.worker),
      category: "Models",
    },
    {
      title: "Validation model",
      value: "validation",
      description: modelLabel(api, draft.models.validation),
      category: "Models",
    },
    {
      title: "Orchestrator model",
      value: "orchestrator",
      description: modelLabel(api, draft.models.orchestrator),
      category: "Models",
    },
    {
      title: "Continue →",
      value: "continue",
      description: "Proceed to the validation policy",
      category: "Actions",
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to the brief",
      category: "Actions",
    },
  ]
  nav(
    api,
    () => (
      <DialogSelect<Role>
        title="New mission · models (optional)"
        options={options}
        onSelect={(opt) => {
          if (opt.value === "continue") {
            askValidation(api, draft)
            return
          }
          if (opt.value === "back") {
            askBrief(api, draft)
            return
          }
          const role = opt.value
          pickModel(api, `Select ${role} model`, draft.models[role], (model) => {
            const models: Store.MissionModels = { ...draft.models }
            if (model) models[role] = model
            else delete models[role]
            askModels(api, { ...draft, models })
          })
        }}
      />
    ),
    () => askBrief(api, draft),
  )
}

/** Choose how each milestone is validated before the mission advances. */
function askValidation(api: TuiPluginApi, draft: WizardDraft): void {
  const options: DialogSelectOption<Store.ValidationPolicy | "back">[] = [
    {
      title: "Scrutiny",
      value: "scrutiny",
      description: "A critical review pass validates each milestone",
      category: "Validation",
    },
    {
      title: "User test",
      value: "user-test",
      description: "Pause for you to manually verify each milestone",
      category: "Validation",
    },
    {
      title: "None",
      value: "none",
      description: "Advance without validating between milestones",
      category: "Validation",
    },
    {
      title: "← Back",
      value: "back",
      description: "Return to models",
      category: "Actions",
    },
  ]
  nav(
    api,
    () => (
      <DialogSelect<Store.ValidationPolicy | "back">
        title="New mission · validation policy"
        current={draft.validation ?? "scrutiny"}
        options={options}
        onSelect={(opt) => {
          if (opt.value === "back") {
            askModels(api, draft)
            return
          }
          collectFirstFeature(api, { ...draft, validation: opt.value })
        }}
      />
    ),
    () => askModels(api, draft),
  )
}

/** Collect the first feature (objective → agent → model → budget), then finalize. */
function collectFirstFeature(api: TuiPluginApi, draft: WizardDraft): void {
  collectFeature(
    api,
    draft.feature,
    (feature) => finalize(api, { ...draft, feature }),
    () => openManager(api),
  )
}

/** Reusable feature-field collector mirroring the loops stage editor. */
function collectFeature(
  api: TuiPluginApi,
  initial: WizardFeature,
  onDone: (feature: WizardFeature) => void,
  onCancel: () => void,
): void {
  const askObjective = (cur: WizardFeature) => {
    api.ui.dialog.replace(() => (
      <DialogPrompt
        title="Feature · objective"
        placeholder="e.g. implement the login form and wire it to the API"
        value={cur.objective}
        onConfirm={(value) => {
          const objective = value.trim()
          if (!objective) {
            api.ui.toast({ variant: "error", message: "Objective cannot be empty" })
            askObjective({ ...cur, objective })
            return
          }
          pickAgent(api, cur.agent, (agent) => askModelStep({ ...cur, objective, agent }))
        }}
        onCancel={onCancel}
      />
    ))
  }
  const askModelStep = (cur: WizardFeature) => {
    pickModel(api, "Feature · model", cur.model, (model) => askBudget({ ...cur, model }))
  }
  const askBudget = (cur: WizardFeature) => {
    api.ui.dialog.replace(() => (
      <DialogPrompt
        title="Feature · token budget (optional)"
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
          onDone({
            objective: cur.objective,
            ...(cur.agent ? { agent: cur.agent } : {}),
            ...(cur.model ? { model: cur.model } : {}),
            ...(tokenBudget ? { tokenBudget } : {}),
          })
        }}
        onCancel={onCancel}
      />
    ))
  }
  askObjective(initial)
}

function finalize(api: TuiPluginApi, draft: WizardDraft): void {
  const brief = (draft.brief ?? draft.feature.objective).trim()
  const objective = draft.feature.objective.trim() || brief
  const def: MissionDefinition = {
    id: `mission_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: draft.name || brief.slice(0, 32),
    brief,
    milestones: [
      {
        id: "m1",
        name: "Main",
        features: [
          {
            id: "f1_1",
            name: objective.slice(0, 48) || "Execute brief",
            objective,
            agent: draft.feature.agent || "ralph",
            ...(draft.feature.model ? { model: draft.feature.model } : {}),
            ...(draft.feature.tokenBudget ? { tokenBudget: draft.feature.tokenBudget } : {}),
            status: "pending",
            dependsOn: [],
          },
        ],
        validation: draft.validation ?? "scrutiny",
        status: "pending",
      },
    ],
    models: draft.models,
    status: "ready",
    createdAt: Date.now(),
  }
  void Runner.persist(api, def).then((saved) => {
    api.ui.toast({
      variant: "success",
      message: `Mission "${(saved ?? def).name}" created — review the plan`,
    })
    openView(api, saved ?? def)
  })
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

/** Build a fresh feature from collected wizard fields (used by the add paths). */
function featureFromDraft(feature: WizardFeature): MissionFeature {
  const objective = feature.objective.trim()
  return {
    id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: objective.slice(0, 48) || "New feature",
    objective,
    agent: feature.agent || "ralph",
    ...(feature.model ? { model: feature.model } : {}),
    ...(feature.tokenBudget ? { tokenBudget: feature.tokenBudget } : {}),
    status: "pending",
    dependsOn: [],
  }
}

/** Persist a structurally-mutated mission, toast, then continue with the saved def. */
function persistStructure(
  api: TuiPluginApi,
  next: Store.MissionDefinition,
  message: string,
  then: (saved: Store.MissionDefinition) => void,
): void {
  void Runner.persist(api, next).then((saved) => {
    api.ui.toast({ variant: "success", message })
    then(saved ?? next)
  })
}

function openView(api: TuiPluginApi, def: Store.MissionDefinition): void {
  type ViewValue =
    | { kind: "feature"; milestoneID: string; featureID: string }
    | { kind: "add-feature" }
    | { kind: "add-milestone" }
    | { kind: "back" }
  const options: DialogSelectOption<ViewValue>[] = []
  for (const m of def.milestones) {
    for (const f of m.features) {
      options.push({
        title: `${featureIcon(f.status)} ${f.id} ${f.name}`,
        value: { kind: "feature", milestoneID: m.id, featureID: f.id },
        description: `@${f.agent} · ${f.status}${f.dependsOn.length > 0 ? ` · after ${f.dependsOn.join(", ")}` : ""}`,
        category: m.name,
      })
    }
  }
  options.push(
    {
      title: "＋ Add feature",
      value: { kind: "add-feature" },
      description: "Append a feature to a milestone",
      category: "Edit",
    },
    {
      title: "＋ Add milestone",
      value: { kind: "add-milestone" },
      description: "Create a new milestone with a first feature",
      category: "Edit",
    },
    {
      title: "← Back",
      value: { kind: "back" },
      description: "Return to the action menu",
      category: "Actions",
    },
  )
  api.ui.dialog.replace(() => (
    <DialogSelect<ViewValue>
      title={`${def.name} — plan`}
      placeholder="Pick a feature to intervene…"
      options={options}
      onSelect={(opt) => {
        switch (opt.value.kind) {
          case "back":
            openActions(api, def)
            break
          case "add-feature":
            addFeature(api, def)
            break
          case "add-milestone":
            addMilestone(api, def)
            break
          case "feature": {
            const v = opt.value
            const m = def.milestones.find((mm) => mm.id === v.milestoneID)
            const f = m?.features.find((ff) => ff.id === v.featureID)
            if (m && f) openFeatureActions(api, def, m.id, f)
            break
          }
        }
      }}
    />
  ))
}

/** Append a new feature to a milestone (picks the milestone first when there are several). */
function addFeature(api: TuiPluginApi, def: Store.MissionDefinition): void {
  const append = (milestoneID: string) => {
    collectFeature(
      api,
      { objective: "" },
      (feature) => {
        const newFeature = featureFromDraft(feature)
        const next: Store.MissionDefinition = {
          ...def,
          milestones: def.milestones.map((m) =>
            m.id === milestoneID ? { ...m, features: [...m.features, newFeature] } : m,
          ),
        }
        persistStructure(api, next, "Feature added", (saved) => openView(api, saved))
      },
      () => openView(api, def),
    )
  }
  if (def.milestones.length <= 1) {
    append(def.milestones[0]?.id ?? "m1")
    return
  }
  const options: DialogSelectOption<string>[] = def.milestones.map((m) => ({
    title: m.name,
    value: m.id,
    description: `${m.features.length} feature${m.features.length === 1 ? "" : "s"}`,
    category: "Milestones",
  }))
  options.push({ title: "← Back", value: "__back__", description: "Return to the plan", category: "Actions" })
  api.ui.dialog.replace(() => (
    <DialogSelect<string>
      title="Add feature · pick milestone"
      options={options}
      onSelect={(opt) => (opt.value === "__back__" ? openView(api, def) : append(opt.value))}
    />
  ))
}

/** Create a new milestone; a milestone needs at least one feature, so collect that too. */
function addMilestone(api: TuiPluginApi, def: Store.MissionDefinition): void {
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New milestone · name"
      placeholder="e.g. Polish & ship"
      onConfirm={(raw) => {
        const name = raw.trim()
        if (!name) {
          api.ui.toast({ variant: "error", message: "Milestone name cannot be empty" })
          addMilestone(api, def)
          return
        }
        collectFeature(
          api,
          { objective: "" },
          (feature) => {
            const milestone: MissionMilestone = {
              id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`,
              name,
              features: [featureFromDraft(feature)],
              validation: "scrutiny",
              status: "pending",
            }
            const next: Store.MissionDefinition = { ...def, milestones: [...def.milestones, milestone] }
            persistStructure(api, next, "Milestone added", (saved) => openView(api, saved))
          },
          () => openView(api, def),
        )
      }}
      onCancel={() => openView(api, def)}
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
  | "move-up"
  | "move-down"
  | "remove"
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
  const milestone = def.milestones.find((m) => m.id === milestoneID)
  const index = milestone ? milestone.features.findIndex((f) => f.id === feature.id) : -1
  const totalFeatures = def.milestones.reduce((n, m) => n + m.features.length, 0)
  if (milestone && index > 0)
    options.push({
      title: "Move up",
      value: "move-up",
      description: "Run earlier in the milestone",
      category: "Reorder",
    })
  if (milestone && index >= 0 && index < milestone.features.length - 1)
    options.push({
      title: "Move down",
      value: "move-down",
      description: "Run later in the milestone",
      category: "Reorder",
    })
  options.push({
    title: "Remove feature",
    value: "remove",
    description: totalFeatures <= 1 ? "(a mission needs one feature)" : "Drop this feature from the plan",
    category: "Reorder",
  })
  options.push({
    title: "← Back",
    value: "back",
    description: "Return to the plan view",
  })
  api.ui.dialog.replace(() => (
    <DialogSelect<FeatureAction>
      title={milestone ? `${milestone.name} · ${feature.id} ${feature.name}` : `${feature.id} ${feature.name}`}
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
          case "move-up":
          case "move-down": {
            if (!milestone || index < 0) {
              openView(api, def)
              break
            }
            const feats = [...milestone.features]
            const j = index + (opt.value === "move-up" ? -1 : 1)
            if (j < 0 || j >= feats.length) {
              openFeatureActions(api, def, milestoneID, feature)
              break
            }
            ;[feats[index], feats[j]] = [feats[j], feats[index]]
            const next: Store.MissionDefinition = {
              ...def,
              milestones: def.milestones.map((m) => (m.id === milestoneID ? { ...m, features: feats } : m)),
            }
            persistStructure(api, next, "Feature reordered", (saved) => openView(api, saved))
            break
          }
          case "remove": {
            if (totalFeatures <= 1) {
              api.ui.toast({ variant: "error", message: "A mission needs at least one feature" })
              openFeatureActions(api, def, milestoneID, feature)
              break
            }
            const milestones = def.milestones
              .map((m) =>
                m.id === milestoneID ? { ...m, features: m.features.filter((f) => f.id !== feature.id) } : m,
              )
              .filter((m) => m.features.length > 0)
            const next: Store.MissionDefinition = { ...def, milestones }
            persistStructure(api, next, "Feature removed", (saved) => openView(api, saved))
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

function showExecDetail(api: TuiPluginApi, def: Store.MissionDefinition, run: Store.MissionExec | undefined): void {
  if (!run) {
    openHistory(api, def)
    return
  }
  const duration = run.endedAt ? formatDuration(Math.max(0, run.endedAt - run.startedAt)) : "running"
  const lines = [
    `Outcome:  ${run.ok ? "✓ ok" : `✗ ${run.status}`}`,
    `Kind:     ${run.kind}`,
    `Target:   ${run.targetID} ${run.targetName}`,
    `When:     ${new Date(run.startedAt).toLocaleString()}${run.endedAt ? ` (${formatRelative(run.endedAt)})` : ""}`,
    `Duration: ${duration}`,
  ]
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

function openHistory(api: TuiPluginApi, def: Store.MissionDefinition): void {
  const runs = Store.loadHistory(api.kv, def.id)
  const stats = Store.missionStats(runs)
  const pct = stats.total === 0 ? "—" : `${Math.round(stats.successRate * 100)}%`
  const subtitle =
    stats.total === 0
      ? "no runs yet"
      : `${stats.ok}/${stats.total} ok · ${pct} · ${stats.features} feat, ${stats.validations} val`

  type HistoryValue = { kind: "run"; index: number } | { kind: "clear" } | { kind: "back" }
  const options: DialogSelectOption<HistoryValue>[] = runs.map((run, index) => {
    const glyph = run.ok ? "✓" : "✗"
    const when = run.endedAt ? formatRelative(run.endedAt) : "running"
    return {
      title: `${glyph} ${run.kind === "feature" ? "f" : "v"} ${run.targetID} ${run.targetName}`,
      value: { kind: "run", index } as HistoryValue,
      description: `${run.status}${run.error ? ` — ${run.error}` : ""} · ${when}`,
      category: run.kind,
      footer: (
        <span
          style={{
            fg: run.ok ? api.theme.current.status.success.fg : api.theme.current.status.error.fg,
          }}
        >
          {run.ok ? "ok" : run.status}
        </span>
      ),
    }
  })
  if (runs.length > 0) {
    options.push({
      title: "Clear history",
      value: { kind: "clear" },
      description: "Forget recorded executions",
      category: "Actions",
    })
  }
  options.push({
    title: "← Back",
    value: { kind: "back" },
    description: "Return to the action menu",
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
          showExecDetail(api, def, runs[opt.value.index])
        }
      }}
    />
  ))
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`
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
