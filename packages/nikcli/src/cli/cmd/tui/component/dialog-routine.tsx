import { createResource, createSignal, Match, Show, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { useSDK } from "@tui/context/sdk"
import { Keybind } from "@/util/keybind"
import { randomBytes } from "crypto"

// ── Wizard step types ─────────────────────────────────────────────────────────

type WizardStep = "name" | "prompt" | "schedule" | "api" | "summary"

// ── Schedule presets ───────────────────────────────────────────────────────────

const SCHEDULE_OPTIONS: DialogSelectOption<string>[] = [
  {
    title: "Manual only",
    value: "",
    description: "Run only when triggered manually or via API",
  },
  {
    title: "@hourly",
    value: "@hourly",
    description: "Every hour at minute 0",
  },
  {
    title: "Every 6 hours",
    value: "0 */6 * * *",
    description: "At 00:00, 06:00, 12:00, 18:00",
  },
  {
    title: "@daily",
    value: "@daily",
    description: "Once a day at midnight",
  },
  {
    title: "@weekly",
    value: "@weekly",
    description: "Every Monday at midnight",
  },
  {
    title: "Custom cron...",
    value: "__custom__",
    description: "Enter any cron expression",
  },
]

const CRON_DESCRIPTIONS: Record<string, string> = {
  "": "Manual only",
  "@hourly": "Every hour",
  "0 */6 * * *": "Every 6 hours",
  "@daily": "Every day at midnight",
  "@weekly": "Every Monday at midnight",
}

// ── Main wizard component ─────────────────────────────────────────────────────

function DialogRoutineCreate(props: { onDone: () => void }) {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const { theme } = useTheme()

  const [step, setStep] = createSignal<WizardStep>("name")
  const [name, setName] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [scheduleCron, setScheduleCron] = createSignal("")
  const [scheduleEnabled, setScheduleEnabled] = createSignal(false)
  const [apiEnabled, setApiEnabled] = createSignal(false)
  const [apiToken, setApiToken] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  // ── Step 2: Prompt ────────────────────────────────────────────────────────

  function handleName(value: string) {
    if (!value.trim()) return
    setName(value.trim())
    setStep("prompt")
  }

  // ── Step 3: Prompt ────────────────────────────────────────────────────────

  function handlePrompt(value: string) {
    if (!value.trim()) return
    setPrompt(value.trim())
    setStep("schedule")
  }

  // ── Step 4: Schedule ──────────────────────────────────────────────────────

  function handleSchedule(value: string) {
    if (value === "__custom__") {
      dialog.replace(() => (
        <DialogPrompt
          title="Custom cron expression"
          description={() => (
            <text style={{ fg: theme.textMuted }}>
              e.g. 0 9 * * 1-5 (weekdays at 9am) or */15 * * * * (every 15 min)
            </text>
          )}
          placeholder="*/30 * * * *"
          onConfirm={(v) => {
            if (v.trim()) {
              setScheduleCron(v.trim())
              setScheduleEnabled(true)
            }
            setStep("api")
          }}
          onCancel={() => setStep("schedule")}
        />
      ))
      return
    }
    const cron = value.trim()
    setScheduleCron(cron)
    setScheduleEnabled(Boolean(cron))
    setStep("api")
  }

  // ── Step 5: API Trigger ──────────────────────────────────────────────────

  const API_OPTIONS: DialogSelectOption<string>[] = [
    {
      title: "No API trigger",
      value: "none",
      description: "Only run manually or on schedule",
    },
    {
      title: "Enable API trigger",
      value: "generate",
      description: "Auto-generate a secure token",
    },
    {
      title: "Custom token...",
      value: "custom",
      description: "Provide your own token string",
    },
  ]

  function handleApi(value: string) {
    if (value === "none") {
      setApiEnabled(false)
      setApiToken("")
    } else if (value === "generate") {
      const token = randomBytes(16).toString("hex")
      setApiToken(token)
      setApiEnabled(true)
    } else if (value === "custom") {
      dialog.replace(() => (
        <DialogPrompt
          title="API token"
          description={() => (
            <text style={{ fg: theme.textMuted }}>A unique string used to trigger this routine. Keep it secret.</text>
          )}
          placeholder="my-secret-token"
          onConfirm={(v) => {
            if (v.trim()) {
              setApiToken(v.trim())
              setApiEnabled(true)
            }
            setStep("summary")
          }}
          onCancel={() => setStep("api")}
        />
      ))
      return
    }
    setStep("summary")
  }

  // ── Step 6: Summary & Submit ─────────────────────────────────────────────

  async function submit() {
    setBusy(true)
    try {
      const triggers = []
      if (scheduleEnabled()) {
        triggers.push({ type: "schedule" as const, cron: scheduleCron(), enabled: true })
      }
      if (apiEnabled()) {
        triggers.push({ type: "api" as const, token: apiToken(), enabled: true })
      }

      const result = await sdk.client.mobile.routine.create({
        mobileRoutineCreateInput: { name: name(), prompt: prompt(), triggers },
      })
      if (result.error) throw new Error(String(result.error))
      const routine = (result as any).data
      toast.show({ message: `Routine "${routine.name}" created`, variant: "success" })
      props.onDone()
      dialog.clear()
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Failed to create routine",
        variant: "error",
      })
      setBusy(false)
    }
  }

  // ── Summary options ────────────────────────────────────────────────────────

  const summaryOptions = (): DialogSelectOption<string>[] => {
    const rows: DialogSelectOption<string>[] = [
      {
        title: name(),
        value: "__name__",
        description: "Routine name",
      },
      {
        title: prompt().slice(0, 60) + (prompt().length > 60 ? "…" : ""),
        value: "__prompt__",
        description: "Prompt",
      },
    ]

    if (scheduleEnabled()) {
      rows.push({
        title: scheduleCron(),
        value: "__schedule__",
        description: CRON_DESCRIPTIONS[scheduleCron()] ?? "Custom schedule",
      })
    }

    if (apiEnabled()) {
      rows.push({
        title: apiToken(),
        value: "__api__",
        description: "API trigger",
      })
    }

    if (!scheduleEnabled() && !apiEnabled()) {
      rows.push({
        title: "Manual only",
        value: "__manual__",
        description: "No triggers configured",
      })
    }

    rows.push(
      {
        title: "← Back",
        value: "__back__",
        description: "Edit previous steps",
      },
      {
        title: "Create routine",
        value: "__create__",
        description: "Save and close",
      },
    )

    return rows
  }

  function handleSummary(value: string) {
    if (value === "__back__") {
      setStep("api")
      return
    }
    if (value === "__create__") {
      void submit()
    }
  }

  // ── Render step ────────────────────────────────────────────────────────────

  return (
    <Switch>
      {/* Step 1: Name */}
      <Match when={step() === "name"}>
        <DialogPrompt
          title="New routine — name"
          placeholder="e.g. Daily code review"
          busy={busy()}
          onConfirm={handleName}
          onCancel={() => dialog.clear()}
        />
      </Match>

      {/* Step 2: Prompt */}
      <Match when={step() === "prompt"}>
        <DialogPrompt
          title="New routine — what should it do?"
          description={() => (
            <text style={{ fg: theme.textMuted }}>
              Describe the workflow. The agent will follow these instructions on each run.
            </text>
          )}
          placeholder="Review every pull request in the last 24h and summarize changes..."
          busy={busy()}
          onConfirm={handlePrompt}
          onCancel={() => setStep("name")}
        />
      </Match>

      {/* Step 3: Schedule */}
      <Match when={step() === "schedule"}>
        <DialogSelect
          title="Schedule"
          options={SCHEDULE_OPTIONS}
          onSelect={(opt) => handleSchedule(opt.value)}
          keybind={[
            {
              title: "skip",
              keybind: Keybind.parse("escape")[0],
              onTrigger: () => handleSchedule(""),
            },
          ]}
        />
      </Match>

      {/* Step 4: API trigger */}
      <Match when={step() === "api"}>
        <DialogSelect
          title="API trigger"
          options={API_OPTIONS}
          onSelect={(opt) => handleApi(opt.value)}
          keybind={[
            {
              title: "skip",
              keybind: Keybind.parse("escape")[0],
              onTrigger: () => handleApi("none"),
            },
          ]}
        />
      </Match>

      {/* Step 5: Summary */}
      <Match when={step() === "summary"}>
        <DialogSelect
          title="Review routine"
          options={summaryOptions()}
          onSelect={(opt) => handleSummary(opt.value)}
          keybind={
            busy()
              ? []
              : [
                  {
                    title: "create",
                    keybind: Keybind.parse("return")[0],
                    onTrigger: () => handleSummary("__create__"),
                  },
                ]
          }
        />
      </Match>
    </Switch>
  )
}

// ── Actions (unchanged — using SDK via mobile.routine) ────────────────────────

function DialogRoutineActions(props: {
  routine: {
    id: string
    name: string
    paused: boolean
    directory: string
    triggers: Array<{ type: string; enabled: boolean }>
  }
  onDone: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()

  async function run() {
    try {
      const result = await sdk.client.mobile.routine.run({ id: props.routine.id })
      if (result.error) throw new Error(String(result.error))
      const session = (result as any).data
      toast.show({ message: `Session ${session.id} started`, variant: "success" })
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Run failed", variant: "error" })
    }
    props.onDone()
    dialog.clear()
  }

  async function togglePause() {
    try {
      const result = props.routine.paused
        ? await sdk.client.mobile.routine.resume({ id: props.routine.id })
        : await sdk.client.mobile.routine.pause({ id: props.routine.id })
      if (result.error) throw new Error(String(result.error))
      toast.show({ message: props.routine.paused ? "Routine resumed" : "Routine paused", variant: "success" })
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Failed", variant: "error" })
    }
    props.onDone()
    dialog.clear()
  }

  async function deleteRoutine() {
    const { DialogConfirm } = await import("@tui/ui/dialog-confirm")
    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete routine",
      `Delete "${props.routine.name}"? This cannot be undone.`,
    )
    if (!confirmed) return
    try {
      const result = await sdk.client.mobile.routine.delete({ id: props.routine.id })
      if (result.error) throw new Error(String(result.error))
      toast.show({ message: "Routine deleted", variant: "success" })
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Delete failed", variant: "error" })
    }
    props.onDone()
    dialog.clear()
  }

  const options: DialogSelectOption<string>[] = [
    {
      title: "Run now",
      value: "run",
      description: "Trigger an immediate run",
      onSelect: () => void run(),
    },
    {
      title: props.routine.paused ? "Resume" : "Pause",
      value: "pause",
      description: props.routine.paused ? "Re-enable scheduled triggers" : "Disable scheduled triggers",
      onSelect: () => void togglePause(),
    },
    {
      title: "Delete",
      value: "delete",
      description: "Permanently remove this routine",
      onSelect: () => void deleteRoutine(),
    },
  ]

  return <DialogSelect title={`Routine: ${props.routine.name}`} options={options} />
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function DialogRoutine() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [routines] = createResource(refreshKey, async () => {
    const result = await sdk.client.mobile.routine.list()
    if (result.error) throw result.error
    if (!result.data) return [] as any[]
    return result.data
  })

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  function formatTriggers(triggers: Array<{ type: string; enabled: boolean }>) {
    const active = triggers.filter((t) => t.enabled)
    if (!active.length) return "manual"
    return active.map((t) => (t.type === "schedule" ? "schedule" : "api")).join(" · ") || "manual"
  }

  function relativeTime(ts: number) {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
  }

  const options = (): DialogSelectOption<string>[] => {
    const list = (routines.latest ?? routines() ?? []) as any[]
    const items: DialogSelectOption<string>[] = list.map((r) => ({
      title: r.name,
      value: r.id,
      description: r.paused
        ? `⏸ paused · ${formatTriggers(r.triggers)}`
        : `● ${formatTriggers(r.triggers)}${r.lastRunAt ? ` · ${relativeTime(r.lastRunAt)}` : ""}`,
      onSelect: () => {
        dialog.replace(() => <DialogRoutineActions routine={r} onDone={refresh} />)
      },
    }))

    items.push({
      title: "＋ New routine",
      value: "__new__",
      description: "Create a scheduled or API-triggered workflow",
      onSelect: () => {
        dialog.replace(() => <DialogRoutineCreate onDone={refresh} />)
      },
    })

    return items
  }

  return (
    <Show
      when={routines.state === "ready" || routines.state === "refreshing"}
      fallback={
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <text attributes={TextAttributes.BOLD} style={{ fg: theme.text }}>
            Routines
          </text>
          <text style={{ fg: theme.textMuted }}>
            {routines.error
              ? `Error: ${routines.error instanceof Error ? routines.error.message : String(routines.error)}`
              : "Loading…"}
          </text>
        </box>
      }
    >
      <DialogSelect title="Routines" options={options()} />
    </Show>
  )
}
