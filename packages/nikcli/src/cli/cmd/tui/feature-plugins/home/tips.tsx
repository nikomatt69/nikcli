import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"

const id = "internal:home-tips"

function View(props: { show: boolean }) {
  return (
    <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
      <Show when={props.show}>
        <Tips />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: api.kv.get("tips_hidden", false) ? "Show tips" : "Hide tips",
        namespace: "System",
        hidden: api.route.current.name !== "home",
        run() {
          api.kv.set("tips_hidden", !api.kv.get("tips_hidden", false))
          api.ui.dialog.clear()
        },
      },
    ],
    bindings: [{ key: "tips_toggle", cmd: "tips.toggle" }],
  }))

  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const show = createMemo(() => !first() && !hidden())
        return <View show={show()} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
