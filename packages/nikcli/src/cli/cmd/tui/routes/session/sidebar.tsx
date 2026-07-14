import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { TuiPluginRuntime } from "@tui/plugin"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sdk = useSDK()
  const sync = useSync()
  const theme = useTheme().theme
  const session = createMemo(() => sync.session.get(props.sessionID))
  const [instructions] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const response = await sdk.client.session.instructions({ sessionID }).catch(() => undefined)
      return response?.data ?? []
    },
  )
  const [instructionsOpen, setInstructionsOpen] = createSignal(true)

  return (
    <Show when={session()}>
      {(current) => (
        <box
          backgroundColor={theme.backgroundPanel}
          width={42}
          height="100%"
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          position={props.overlay ? "absolute" : "relative"}
        >
          <scrollbox flexGrow={1}>
            <box flexShrink={0} gap={1} paddingRight={1}>
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{current().title}</b>
                </text>
                <Show when={current().share?.url}>
                  <text fg={theme.textMuted}>{current().share!.url}</text>
                </Show>
              </box>
              <TuiPluginRuntime.Slot name="sidebar.content" sessionID={props.sessionID} />
              <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              <Show when={instructions()?.length}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => instructions()!.length > 2 && setInstructionsOpen((value) => !value)}
                  >
                    <Show when={instructions()!.length > 2}>
                      <text fg={theme.text}>{instructionsOpen() ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>Instructions</b>
                      <span style={{ fg: theme.textMuted }}> ({instructions()!.length})</span>
                    </text>
                  </box>
                  <Show when={instructions()!.length <= 2 || instructionsOpen()}>
                    <For each={instructions()}>
                      {(item) => (
                        <text fg={theme.textMuted} wrapMode="none">
                          📄 {item.name}
                        </text>
                      )}
                    </For>
                  </Show>
                </box>
              </Show>
            </box>
          </scrollbox>
          <box flexShrink={0} gap={1} paddingTop={1}>
            <TuiPluginRuntime.Slot name="sidebar.footer" sessionID={props.sessionID} />
            <TuiPluginRuntime.Slot name="sidebar_footer" session_id={props.sessionID} />
          </box>
        </box>
      )}
    </Show>
  )
}
