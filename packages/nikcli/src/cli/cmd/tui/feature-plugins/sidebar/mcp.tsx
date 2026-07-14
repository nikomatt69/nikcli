import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

function View() {
  const sync = useSync()
  const theme = useTheme().theme
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))
  const active = createMemo(() => list().filter(([, item]) => item.status === "connected").length)
  const failed = createMemo(
    () =>
      list().filter(([, item]) => ["failed", "needs_auth", "needs_client_registration"].includes(item.status)).length,
  )
  const color = (status: string) => {
    if (status === "connected") return theme.success
    if (status === "failed" || status === "needs_client_registration") return theme.error
    if (status === "needs_auth") return theme.warning
    return theme.textMuted
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((value) => !value)}>
          <Show when={list().length > 2}>
            <text fg={theme.text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text}>
            <b>MCP</b>
            <Show when={!open()}>
              <span style={{ fg: theme.textMuted }}>
                {` (${active()} active${failed() ? `, ${failed()} error${failed() > 1 ? "s" : ""}` : ""})`}
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {([name, item]) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={color(item.status)}>
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  {name}{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(value) => <i>{value().error}</i>}</Match>
                      <Match when={item.status === "disabled"}>Disabled</Match>
                      <Match when={item.status === "needs_auth"}>Needs auth</Match>
                      <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "internal:sidebar-mcp",
  setup(ctx) {
    ctx.ui.slot("sidebar.content", () => <View />)
  },
})
