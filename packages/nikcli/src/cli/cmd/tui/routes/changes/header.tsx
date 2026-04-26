import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

function shortSessionId(id: string) {
  if (id.length <= 10) return id
  return `${id.slice(0, 8)}…`
}

export function ChangesHeader(props: {
  sessionTitle: string
  sessionId: string
  directory?: string
  pane: "list" | "diff"
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
  currentFile?: string
  lineHint?: string
}) {
  const { theme } = useTheme()
  const badge = () => (props.pane === "list" ? "FILES" : "DIFF")
  const badgeFg = () => (props.pane === "list" ? theme.primary : theme.diffHighlightAdded)

  return (
    <box
      flexShrink={0}
      width="100%"
      border={["bottom"]}
      borderColor={theme.borderSubtle}
      backgroundColor={theme.backgroundPanel}
    >
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={0}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" gap={1}>
          <box flexDirection="row" gap={1} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none">
              Code review
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              ·
            </text>
            <text fg={theme.text} wrapMode="word" flexGrow={1} minWidth={0}>
              {props.sessionTitle || "Session"}
            </text>
          </box>
          <box
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor={theme.backgroundElement}
            border={["top", "right", "bottom", "left"]}
            borderColor={theme.borderSubtle}
            flexShrink={0}
          >
            <text fg={badgeFg()} attributes={TextAttributes.BOLD} wrapMode="none">
              {badge()}
            </text>
          </box>
        </box>
        <box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" paddingTop={0}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" alignItems="center">
            <text fg={theme.textMuted} wrapMode="none">
              {shortSessionId(props.sessionId)}
            </text>
            <Show when={props.directory}>
              <text fg={theme.textMuted} wrapMode="none">
                ·
              </text>
              <text fg={theme.textMuted} wrapMode="word" flexShrink={1} minWidth={0}>
                {props.directory}
              </text>
            </Show>
          </box>
          <box flexDirection="row" gap={2} flexShrink={0} alignItems="center">
            <text fg={theme.textMuted} wrapMode="none">
              {`${props.totalFiles} file${props.totalFiles === 1 ? "" : "s"}`}
            </text>
            <Show when={props.totalAdditions > 0}>
              <text fg={theme.diffAdded} wrapMode="none">
                {`+${props.totalAdditions}`}
              </text>
            </Show>
            <Show when={props.totalDeletions > 0}>
              <text fg={theme.diffRemoved} wrapMode="none">
                {`-${props.totalDeletions}`}
              </text>
            </Show>
          </box>
        </box>
        <Show when={props.pane === "diff" && props.currentFile}>
          <box flexDirection="row" paddingTop={0} gap={1} alignItems="center" width="100%" minWidth={0} overflow="hidden">
            <text fg={theme.textMuted} wrapMode="none">
              ▾
            </text>
            <text fg={theme.text} wrapMode="word" flexGrow={1} minWidth={0}>
              {props.currentFile}
            </text>
            <Show when={props.lineHint}>
              <text fg={theme.primary} wrapMode="none" flexShrink={0}>
                {props.lineHint}
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}
