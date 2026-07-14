import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import { createMemo, Show } from "solid-js"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

function View() {
  const kv = useKV()
  const sync = useSync()
  const theme = useTheme().theme
  const hasProvider = createMemo(() =>
    sync.data.provider.some(
      (item) => item.id !== "nikcli" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const showGettingStarted = createMemo(() => !hasProvider() && !kv.get("dismissed_getting_started", false))
  const path = createMemo(() => {
    const value = (sync.data.path.directory || process.cwd()).replace(Global.Path.home, "~")
    const text = sync.data.vcs?.branch ? `${value}:${sync.data.vcs.branch}` : value
    const parts = text.split("/")
    return { parent: parts.slice(0, -1).join("/"), name: parts.at(-1) ?? "" }
  })

  return (
    <box gap={1}>
      <Show when={showGettingStarted()}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme.text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text}>
                <b>Getting started</b>
              </text>
              <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme.textMuted}>Nikcli includes free models so you can start immediately.</text>
            <text fg={theme.textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme.text}>Connect provider</text>
              <text fg={theme.textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme.textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme.text }}>{path().name}</span>
      </text>
      <text fg={theme.textMuted}>
        <span style={{ fg: theme.success }}>•</span> <b>NIK</b>
        <span style={{ fg: theme.text }}>
          <b>CLI</b>
        </span>{" "}
        <span>{Installation.VERSION}</span>
      </text>
    </box>
  )
}

export default Plugin.define({
  id: "internal:sidebar-footer",
  setup(ctx) {
    ctx.ui.slot("sidebar.footer", () => <View />)
  },
})
