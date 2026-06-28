/**
 * DeepSec — launcher dialogs.
 *
 * A small DialogSelect-based hub for the `/deepsec` command: pick a scan mode
 * (full / PR-diff / export), schedule a recurring scan, or stop one already
 * running. Each action authors a DeepSec loop and drives it through the loop
 * engine (see `sdk.ts`). Built on the internal DialogSelect/DialogPrompt
 * components, mirroring `feature-plugins/loops/dialogs.tsx`.
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { formatDuration, MIN_INTERVAL_MS, parseDuration } from "@/loop/schema"
import { DEEPSEC_MODES, DeepSecApi, planFor, type DeepSecMode, type LoopDefinition, type LoopRuntime } from "./sdk"

const DOCS_URL = "https://github.com/vercel-labs/deepsec"

type LauncherValue = { kind: "mode"; mode: DeepSecMode } | { kind: "schedule" } | { kind: "manage" } | { kind: "docs" }

function runtimeLabel(rt: LoopRuntime): string {
  if (rt.status === "running") return "running…"
  if (rt.status === "error") return rt.lastError ? `error: ${rt.lastError}` : "error"
  if (rt.status === "paused") return "paused"
  return rt.runs > 0 ? `idle · ${rt.runs} run${rt.runs === 1 ? "" : "s"}` : "idle"
}

export function openLauncher(api: TuiPluginApi): void {
  const deepsec = new DeepSecApi(api.client)
  void deepsec.list().then((existing) => {
    const running = existing.filter((e) => e.runtime.status === "running")
    const options: DialogSelectOption<LauncherValue>[] = DEEPSEC_MODES.map((m) => ({
      title: m.title,
      value: { kind: "mode", mode: m.mode } as LauncherValue,
      description: m.description,
      category: "Scan",
    }))
    options.push({
      title: "Schedule recurring scan",
      value: { kind: "schedule" },
      description: "Run the full scan automatically on an interval",
      category: "Scan",
    })
    if (existing.length > 0) {
      options.push({
        title: running.length > 0 ? `Manage scans (${running.length} running)` : "Manage scans",
        value: { kind: "manage" },
        description: "View, stop, or remove DeepSec loops",
        category: "Manage",
      })
    }
    options.push({
      title: "About DeepSec",
      value: { kind: "docs" },
      description: DOCS_URL,
      category: "Manage",
    })

    api.ui.dialog.replace(() => (
      <DialogSelect<LauncherValue>
        title="DeepSec — agent-powered vulnerability scanner"
        placeholder="Choose an action…"
        options={options}
        onSelect={(opt) => {
          switch (opt.value.kind) {
            case "mode":
              startRun(api, opt.value.mode)
              break
            case "schedule":
              openSchedule(api)
              break
            case "manage":
              openManage(api)
              break
            case "docs":
              api.ui.toast({ variant: "info", message: `DeepSec — ${DOCS_URL}` })
              break
          }
        }}
      />
    ))
  })
}

function startRun(api: TuiPluginApi, mode: DeepSecMode): void {
  const deepsec = new DeepSecApi(api.client)
  api.ui.dialog.clear()
  api.ui.toast({ variant: "info", message: "DeepSec: starting scan…" })
  void deepsec
    .runNow(planFor(mode))
    .then((def) => {
      api.ui.toast({ variant: "success", message: `DeepSec scan started — track it in /loops (${def.name})` })
    })
    .catch((error) => {
      api.ui.toast({
        variant: "error",
        message: `DeepSec failed to start: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
}

function openSchedule(api: TuiPluginApi): void {
  const deepsec = new DeepSecApi(api.client)
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Schedule recurring DeepSec scan"
      placeholder={`e.g. 1h, 6h, 1d (min ${formatDuration(MIN_INTERVAL_MS)})`}
      onConfirm={(raw) => {
        let everyMs: number
        try {
          everyMs = parseDuration(raw)
          if (everyMs < MIN_INTERVAL_MS) {
            throw new Error(`Interval must be at least ${formatDuration(MIN_INTERVAL_MS)}`)
          }
        } catch (error) {
          api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
          openSchedule(api)
          return
        }
        void deepsec
          .schedule(everyMs)
          .then(() => {
            api.ui.dialog.clear()
            api.ui.toast({ variant: "success", message: `DeepSec scheduled every ${formatDuration(everyMs)}` })
          })
          .catch((error) => {
            api.ui.toast({
              variant: "error",
              message: `Failed to schedule: ${error instanceof Error ? error.message : String(error)}`,
            })
          })
      }}
      onCancel={() => openLauncher(api)}
    />
  ))
}

function openManage(api: TuiPluginApi): void {
  const deepsec = new DeepSecApi(api.client)
  void deepsec.list().then((existing) => {
    type Value = { kind: "loop"; def: LoopDefinition } | { kind: "back" }
    const options: DialogSelectOption<Value>[] = existing.map(({ def, runtime }) => ({
      title: def.name,
      value: { kind: "loop", def } as Value,
      description: `${runtimeLabel(runtime)} · ${
        def.trigger.kind === "interval" ? `every ${formatDuration(def.trigger.everyMs)}` : "manual"
      }`,
      category: "Loops",
    }))
    options.push({ title: "← Back", value: { kind: "back" }, category: "Actions" })

    api.ui.dialog.replace(() => (
      <DialogSelect<Value>
        title="Manage DeepSec scans"
        placeholder="Select a scan…"
        options={options}
        onSelect={(opt) => {
          if (opt.value.kind === "back") {
            openLauncher(api)
            return
          }
          openLoopActions(api, opt.value.def)
        }}
      />
    ))
  })
}

function openLoopActions(api: TuiPluginApi, def: LoopDefinition): void {
  const deepsec = new DeepSecApi(api.client)
  type Action = "run" | "remove" | "back"
  const options: DialogSelectOption<Action>[] = [
    { title: "Run now", value: "run", description: "Trigger this scan immediately", category: "Actions" },
    { title: "Remove", value: "remove", description: "Delete this DeepSec loop", category: "Actions" },
    { title: "← Back", value: "back", category: "Actions" },
  ]
  api.ui.dialog.replace(() => (
    <DialogSelect<Action>
      title={def.name}
      placeholder="Choose an action…"
      options={options}
      onSelect={(opt) => {
        if (opt.value === "back") {
          openManage(api)
          return
        }
        if (opt.value === "run") {
          api.ui.dialog.clear()
          void deepsec.run(def.id).then((ok) => {
            api.ui.toast({
              variant: ok ? "success" : "error",
              message: ok ? `DeepSec scan started (${def.name})` : "Failed to start scan",
            })
          })
          return
        }
        void deepsec.remove(def.id).then((ok) => {
          api.ui.toast({
            variant: ok ? "success" : "error",
            message: ok ? `Removed ${def.name}` : "Failed to remove",
          })
          openManage(api)
        })
      }}
    />
  ))
}
