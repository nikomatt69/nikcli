/**
 * Loops — internal TUI plugin.
 *
 * Adds first-class autonomous loops to the TUI: define an objective + trigger
 * once, and nikcli drives the existing Goal system toward it on a schedule (or
 * on demand), with a live sidebar and a `/loops` manager. Self-contained — it
 * uses only the documented plugin `api` surface and persists definitions in the
 * durable plugin KV store, so it introduces no changes to the core.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import * as Store from "./store"
import * as Runner from "./runner"
import { openManager, openWizard, toneColor } from "./dialogs"

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
  // Re-arm enabled interval loops for this TUI session, and clean up on exit.
  Runner.syncAll(api)
  api.lifecycle.onDispose(() => Runner.disposeAll())

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
      description: "Define a new autonomous loop",
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
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
