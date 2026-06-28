/**
 * DeepSec — internal TUI plugin.
 *
 * Wires the `/deepsec` command (aliases: `/sec`, `/scan`) into the TUI. DeepSec
 * (https://github.com/vercel-labs/deepsec) is an agent-powered vulnerability
 * scanner; rather than reimplement an orchestrator, this plugin authors a loop
 * from the canonical DeepSec stages (`DEEPSEC_STAGES` in `@/loop/schema`) and
 * drives it through the existing loop engine — so resume, history, scheduling,
 * and the `/loops` manager all work for DeepSec scans for free.
 *
 * The sidebar shows live status of any DeepSec loops; it reads through the SDK
 * and refreshes on the loop engine's bus events.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { openLauncher } from "./dialogs"
import { DeepSecApi, type LoopDefinition, type LoopRuntime } from "./sdk"
import { subscribeLoopEvents } from "../loops/sdk"

const id = "internal:deepsec"

type Entry = { def: LoopDefinition; runtime: LoopRuntime }

function toneColor(theme: TuiPluginApi["theme"]["current"], rt: LoopRuntime) {
  if (rt.status === "running") return theme.warning
  if (rt.status === "error") return theme.error
  if (rt.runs > 0) return theme.success
  return theme.textMuted
}

function statusLabel(rt: LoopRuntime): string {
  if (rt.status === "running") return "scanning…"
  if (rt.status === "error") return "error"
  if (rt.status === "paused") return "paused"
  return rt.runs > 0 ? `${rt.runs} run${rt.runs === 1 ? "" : "s"}` : "idle"
}

const tui: TuiPlugin = async (api) => {
  const deepsec = new DeepSecApi(api.client)
  const [entries, setEntries] = createSignal<Entry[]>([])

  const refresh = () => {
    void deepsec
      .list()
      .then(setEntries)
      .catch(() => {})
  }
  refresh()

  // The DeepSec loops are ordinary loops to the engine, so the same bus events
  // tell us when a scan starts/finishes or its runtime changes.
  const unsubscribe = subscribeLoopEvents(api.event, {
    onRunStarted: refresh,
    onRunFinished: refresh,
    onRuntimeChanged: refresh,
    onUpserted: refresh,
    onRemoved: refresh,
  })
  api.lifecycle.onDispose(unsubscribe)

  api.keymap.registerLayer({
    commands: [
      {
        name: "deepsec.run",
        title: "DeepSec",
        namespace: "DeepSec",
        description: "Agent-powered vulnerability scan (vercel-labs/deepsec)",
        slashName: "deepsec",
        slashAliases: ["sec", "scan"],
        run() {
          openLauncher(api)
        },
      },
    ],
  })

  api.slots.register({
    order: 245, // between Missions (240) and Loops (250)
    slots: {
      sidebar_content() {
        const list = createMemo(() => entries())
        const running = createMemo(() => list().filter((e) => e.runtime.status === "running").length)
        return (
          <Show when={list().length > 0}>
            <box>
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={api.theme.current.text}>
                  <b>DeepSec</b>
                </text>
                <Show when={running() > 0}>
                  <text fg={api.theme.current.warning}>{running()} scanning</text>
                </Show>
              </box>
              <For each={list()}>
                {(entry) => (
                  <box flexDirection="row" gap={1} justifyContent="space-between">
                    <box flexDirection="row" gap={1} flexShrink={1}>
                      <text fg={toneColor(api.theme.current, entry.runtime)}>●</text>
                      <text fg={api.theme.current.text}>{entry.def.name}</text>
                    </box>
                    <text fg={toneColor(api.theme.current, entry.runtime)}>{statusLabel(entry.runtime)}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
