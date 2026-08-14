import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

function View(props: { sessionID: string }) {
  const sync = useSync()
  const theme = useTheme().theme
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((value) => !value)}>
          <Show when={list().length > 2}>
            <text fg={theme.foreground.default}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.foreground.default}>
            <b>Modified Files</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={theme.foreground.muted} wrapMode="none">
                  {item.file}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={item.additions}>
                    <text fg={theme.diff.added}>+{item.additions}</text>
                  </Show>
                  <Show when={item.deletions}>
                    <text fg={theme.diff.removed}>-{item.deletions}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "internal:sidebar-files",
  setup(ctx) {
    ctx.ui.slot("sidebar.content", (props) => <View sessionID={String(props.sessionID)} />)
  },
})
