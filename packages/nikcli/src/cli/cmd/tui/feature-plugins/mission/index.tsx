/**
 * Missions — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: an autonomous-mission manager wired into
 * the TUI. The plugin shows a sidebar with all missions and their live
 * status, and registers the `/mission` (alias: `/missions`) slash command
 * that opens the manager dialog.
 *
 * Definitions, execution history, and orchestration are all server-side (see
 * `src/mission/`); the plugin reads them through the SDK and subscribes to the
 * orchestrator's bus events for live updates. A local KV cache keeps the
 * sidebar snappy when the server is unreachable.
 */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@nikcli-ai/plugin/tui";
import { createMemo, For, Show } from "solid-js";
import * as Store from "./store";
import * as Runner from "./runner";
import { openManager, toneColor } from "./dialogs";
import { MissionApi } from "./sdk";

const id = "internal:missions";

function Row(props: { api: TuiPluginApi; def: Store.MissionDefinition }) {
  const theme = () => props.api.theme.current;
  const info = createMemo(() =>
    Runner.statusInfo(props.def, Runner.runtimeOf(props.def.id)),
  );
  const right = createMemo(() => {
    const p = Store.progressOf(props.def);
    if (p.totalFeatures === 0) return info().label;
    return `${info().label} · ${p.doneFeatures}/${p.totalFeatures}`;
  });
  return (
    <box flexDirection="row" gap={1} justifyContent="space-between">
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={toneColor(theme(), info().tone)}>●</text>
        <text fg={theme().text}>{props.def.name}</text>
      </box>
      <text fg={toneColor(theme(), info().tone)}>{right()}</text>
    </box>
  );
}

function Sidebar(props: { api: TuiPluginApi }) {
  const missions = createMemo(() => Store.loadAll(props.api.kv));
  const running = createMemo(
    () =>
      missions().filter((m) => Runner.runtimeOf(m.id).status === "running")
        .length,
  );
  return (
    <Show when={missions().length > 0}>
      <box>
        <box flexDirection="row" gap={1} justifyContent="space-between">
          <text fg={props.api.theme.current.text}>
            <b>Missions</b>
          </text>
          <Show when={running() > 0}>
            <text fg={props.api.theme.current.warning}>
              {running()} running
            </text>
          </Show>
        </box>
        <For each={missions()}>
          {(def) => <Row api={props.api} def={def} />}
        </For>
      </box>
    </Show>
  );
}

const tui: TuiPlugin = async (api) => {
  // Pull the server's view into the local cache so the sidebar reflects any
  // headless activity (orchestration that started while the TUI was closed).
  await Runner.syncAll(api);
  const unsubscribeBus = Runner.subscribeEvents(api);
  api.lifecycle.onDispose(() => {
    unsubscribeBus();
  });

  api.command.register(() => [
    {
      title: "Missions",
      value: "missions.manage",
      category: "Missions",
      description: "Create & manage multi-milestone autonomous missions",
      slash: { name: "mission", aliases: ["missions"] },
      onSelect() {
        openManager(api);
      },
    },
    {
      title: "New mission",
      value: "missions.new",
      category: "Missions",
      description:
        "Plan a new mission (template, LLM-generated, or blank brief)",
      onSelect() {
        openManager(api);
      },
    },
  ]);

  api.slots.register({
    order: 240, // before Loops (250) so Missions wins the bottom of the sidebar.
    slots: {
      sidebar_content() {
        return <Sidebar api={api} />;
      },
    },
  });

  // Touch the import so the SDK stays reachable from this file even if a
  // future refactor removes the direct usage.
  void MissionApi;
};

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default plugin;
