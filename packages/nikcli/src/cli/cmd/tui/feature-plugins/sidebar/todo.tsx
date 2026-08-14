import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { TodoItem } from "@tui/component/todo-item"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

function View(props: { sessionID: string }) {
  const sync = useSync()
  const theme = useTheme().theme
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const visible = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  return (
    <Show when={visible()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((value) => !value)}>
          <Show when={list().length > 2}>
            <text fg={theme.foreground.default}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.foreground.default}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "internal:sidebar-todo",
  setup(ctx) {
    ctx.ui.slot("sidebar.content", (props) => <View sessionID={String(props.sessionID)} />)
  },
})
