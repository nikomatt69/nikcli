/**
 * Loops — internal TUI plugin.
 *
 * Adds first-class autonomous loops to the TUI: define an objective + trigger
 * once, and nikcli drives the existing Goal system toward it on a schedule (or
 * on demand), with a live sidebar and a `/loops` manager.
 *
 * Loops are persisted server-side (see `src/loop/`) so they keep running with
 * the TUI closed; the plugin reads its data through the SDK and subscribes to
 * the engine's bus events for live updates. A local cache keeps the sidebar
 * snappy when the server is unreachable.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import * as Store from "./store"
import * as Runner from "./runner"
import { openManager, openWizard, toneColor } from "./dialogs"
import { LoopApi } from "./sdk"

const id = "internal:loops"

function Row(props: { api: TuiPluginApi; def: Store.LoopDefinition }) {
  const theme = () => props.api.theme.current
  const info = createMemo(() => Runner.statusInfo(props.def, Runner.runtimeOf(props.def.id)))
  const right = createMemo(() => {
    const stats = Store.loopStats(Store.loadHistory(props.api.kv, props.def.id))
    return stats.total > 0 ? `${info().label} · ${Math.round(stats.successRate * 100)}%` : info().label
  })
  return (
    <box flexDirection="row" gap={1} justifyContent="space-between">
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={toneColor(theme(), info().tone)}>●</text>
        <text fg={theme().text}>{props.def.name}</text>
      </box>
      <text fg={toneColor(theme(), info().tone)}>{right()}</text>
    </box>
  )
}

function Sidebar(props: { api: TuiPluginApi }) {
  const loops = createMemo(() => Store.loadAll(props.api.kv))
  const running = createMemo(() => loops().filter((d) => Runner.runtimeOf(d.id).status === "running").length)
  return (
    <Show when={loops().length > 0}>
      <box>
        <box flexDirection="row" gap={1} justifyContent="space-between">
          <text fg={props.api.theme.current.text}>
            <b>Loops</b>
          </text>
          <Show when={running() > 0}>
            <text fg={props.api.theme.current.warning}>{running()} running</text>
          </Show>
        </box>
        <For each={loops()}>{(def) => <Row api={props.api} def={def} />}</For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  // Pull the server's view into the local cache so the sidebar reflects any
  // headless activity (e.g. intervals fired while the TUI was closed), then
  // arm local interval timers for snappy UI feedback. The server is the
  // source of truth; the local timer just makes the sidebar feel live.
  await Runner.syncAll(api)
  const unsubscribeBus = Runner.subscribeEvents(api)
  api.lifecycle.onDispose(() => {
    Runner.disposeAll()
    unsubscribeBus()
  })

  api.command.register(() => [
    {
      title: "Loops",
      value: "loops.manage",
      category: "Loops",
      description: "Create & manage autonomous loops",
      slash: { name: "loops", aliases: ["loop"] },
      onSelect() {
        openManager(api)
      },
    },
    {
      title: "New loop",
      value: "loops.new",
      category: "Loops",
      description: "Define a new autonomous loop (template, blank, or AI-generated)",
      onSelect() {
        openWizard(api)
      },
    },
  ])

  api.slots.register({
    order: 250,
    slots: {
      sidebar_content() {
        return <Sidebar api={api} />
      },
    },
  })

  // Touch the import so the SDK stays reachable from this file even if a
  // future refactor removes the direct usage.
  void LoopApi
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
