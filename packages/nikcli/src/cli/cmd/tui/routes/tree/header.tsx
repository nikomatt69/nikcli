import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

function shortId(id: string) {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…`
}

export function SessionTreeHeader(props: {
  workspaceLabel?: string
  focusedSessionId?: string
  rootsCount: number
  sessionsCount: number
  currentSessionTitle?: string
}) {
  const { theme } = useTheme()
  const scope = () => props.workspaceLabel ?? "All workspaces"
  const badge = () => (props.focusedSessionId ? "FOCUS" : "TREE")
  const badgeFg = () => (props.focusedSessionId ? theme.primary : theme.info)

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
          <box flexDirection="row" gap={0} alignItems="baseline" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              Session
            </text>
            <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
              {" tree"}
            </text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {"  ·  "}
            </text>
            <text fg={theme.text} attributes={TextAttributes.DIM} wrapMode="word" flexGrow={1} minWidth={0}>
              {scope()}
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
        <box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" paddingTop={0} gap={1}>
          <Show
            when={props.focusedSessionId}
            fallback={
              <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
                All roots
              </text>
            }
          >
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {`Focus · ${shortId(props.focusedSessionId!)}`}
            </text>
          </Show>
          <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {`${props.rootsCount} root${props.rootsCount === 1 ? "" : "s"}`}
            </text>
            <text fg={theme.borderSubtle} attributes={TextAttributes.DIM} wrapMode="none">
              ·
            </text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {`${props.sessionsCount} session${props.sessionsCount === 1 ? "" : "s"}`}
            </text>
          </box>
        </box>
        <Show when={props.currentSessionTitle}>
          <box flexDirection="row" paddingTop={0} gap={1} alignItems="center" width="100%" minWidth={0} overflow="hidden">
            <text fg={theme.primary} attributes={TextAttributes.DIM} wrapMode="none">
              ▾
            </text>
            <text fg={theme.text} wrapMode="word" flexGrow={1} minWidth={0}>
              {props.currentSessionTitle}
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}

/** Table column labels below the main header (aligned with list rows). */
export function SessionTreeColumnHeaders() {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      gap={2}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text attributes={TextAttributes.DIM} fg={theme.textMuted} wrapMode="none">
          Session
        </text>
      </box>
      <box flexDirection="row" gap={2} flexShrink={1} minWidth={0} alignItems="center">
        <text attributes={TextAttributes.DIM} fg={theme.textMuted} minWidth={14} wrapMode="none">
          Delta
        </text>
        <box flexGrow={1} minWidth={20} minHeight={0} flexShrink={1}>
          <text attributes={TextAttributes.DIM} fg={theme.textMuted} wrapMode="none">
            Message
          </text>
        </box>
        <text attributes={TextAttributes.DIM} fg={theme.textMuted} minWidth={10} wrapMode="none">
          Age
        </text>
        <text attributes={TextAttributes.DIM} fg={theme.textMuted} minWidth={8} wrapMode="none">
          ID
        </text>
      </box>
    </box>
  )
}
