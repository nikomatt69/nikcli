import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createMemo, onCleanup, Show } from "solid-js"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { Tips } from "./tips-view"

function View() {
  const command = useCommandDialog()
  const kv = useKV()
  const sync = useSync()
  const hidden = createMemo(() => kv.get("tips_hidden", false))
  const show = createMemo(() => sync.data.session.length > 0 && !hidden())
  const unregister = command.register(() => [
    {
      title: hidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect(dialog) {
        kv.set("tips_hidden", !hidden())
        dialog.clear()
      },
    },
  ])
  onCleanup(unregister)

  return (
    <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
      <Show when={show()}>
        <Tips />
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "internal:home-tips",
  setup(ctx) {
    ctx.ui.slot("home.bottom", () => <View />)
  },
})
