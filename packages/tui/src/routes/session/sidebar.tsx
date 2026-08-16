import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { formatInstructionDelta, visibleInstructionNotices } from "@nikcli-ai/util/instruction-delta"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { TuiPluginRuntime } from "@tui/plugin"
import { SESSION_SIDEBAR_WIDTH } from "@tui/ui/layout"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sdk = useSDK()
  const sync = useSync()
  const theme = useTheme().theme
  const session = createMemo(() => sync.session.get(props.sessionID))
  const instructionEpoch = createMemo(() => (sync.data.session_instructions[props.sessionID] ?? []).length)
  const instructionChanges = createMemo(() =>
    visibleInstructionNotices(sync.data.session_instructions[props.sessionID], 1),
  )
  const [instructions] = createResource(
    () => ({ sessionID: props.sessionID, epoch: instructionEpoch() }),
    async ({ sessionID }) => {
      const response = await sdk.client.session.instructions({ sessionID }).catch(() => undefined)
      return response?.data ?? []
    },
  )
  const [instructionsOpen, setInstructionsOpen] = createSignal(true)

  return (
    <Show when={session()}>
      {(current) => (
        <box
          backgroundColor={theme.surface.panel}
          width={SESSION_SIDEBAR_WIDTH}
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
                <text fg={theme.foreground.default}>
                  <b>{current().title}</b>
                </text>
                <Show when={current().share?.url}>
                  <text fg={theme.foreground.muted}>{current().share!.url}</text>
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
                      <text fg={theme.foreground.default}>{instructionsOpen() ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.foreground.default}>
                      <b>Instructions</b>
                      <span style={{ fg: theme.foreground.muted }}> ({instructions()!.length})</span>
                    </text>
                  </box>
                  <Show when={instructions()!.length <= 2 || instructionsOpen()}>
                    <For each={instructions()}>
                      {(item) => (
                        <text fg={theme.foreground.muted} wrapMode="none">
                          📄 {item.name}
                        </text>
                      )}
                    </For>
                  </Show>
                  <Show when={instructionChanges()[0]}>
                    {(notice) => (
                      <text fg={theme.foreground.muted} wrapMode="word">
                        {formatInstructionDelta(notice().delta)}
                      </text>
                    )}
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
