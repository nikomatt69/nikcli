import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createSignal, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

function View() {
  const sync = useSync()
  const theme = useTheme().theme
  const [open, setOpen] = createSignal(true)
  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => sync.data.lsp.length > 2 && setOpen((value) => !value)}>
        <Show when={sync.data.lsp.length > 2}>
          <text fg={theme.text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme.text}>
          <b>LSP</b>
        </text>
      </box>
      <Show when={sync.data.lsp.length <= 2 || open()}>
        <Show when={sync.data.lsp.length === 0}>
          <text fg={theme.textMuted}>
            {sync.data.config.lsp === false
              ? "LSPs have been disabled in settings"
              : "LSPs will activate as files are read"}
          </text>
        </Show>
        <For each={sync.data.lsp}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={item.status === "connected" ? theme.success : theme.error}>
                •
              </text>
              <text fg={theme.textMuted}>
                {item.id} {item.root}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "internal:sidebar-lsp",
  setup(ctx) {
    ctx.ui.slot("sidebar.content", () => <View />)
  },
})
