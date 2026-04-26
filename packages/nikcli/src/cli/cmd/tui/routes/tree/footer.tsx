import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { FooterHint, FooterSep } from "@tui/ui/footer-hints"

export function SessionTreeFooter(props: {
  selectedIndex: number
  totalRows: number
  lspCount: number
  mcpCount: number
  mcpError: boolean
  filterOpen: boolean
  filterHasText: boolean
  /** Keys to open /timeline for the selected row (e.g. `t · ctrl+x g`). */
  timelineKeyHint: string
}) {
  const theme = useTheme()
  const escLabel = () => {
    if (props.filterOpen) return "clear"
    if (props.filterHasText) return "clear search"
    return "back"
  }

  return (
    <box
      border={["top"]}
      borderColor={theme.theme.borderSubtle}
      backgroundColor={theme.theme.backgroundPanel}
      width="100%"
      flexShrink={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexWrap="wrap"
        gap={1}
      >
        <box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <text fg={theme.theme.text} attributes={TextAttributes.DIM} wrapMode="none">
            Tree
          </text>
          <FooterSep />
          <FooterHint keys="j · k" label="move" />
          <FooterSep />
          <FooterHint keys="h · l" label="nav" />
          <FooterSep />
          <FooterHint keys="enter" label="open" />
          <FooterSep />
          <FooterHint keys="/ · f" label="search" />
          <FooterSep />
          <FooterHint keys="a" label="all" />
          <FooterSep />
          <FooterHint keys="x" label="collapse" />
          <FooterSep />
          <FooterHint keys="g/G" label="top/end" />
          <FooterSep />
          <FooterHint keys="m" label="messages" />
          <FooterSep />
          <FooterHint keys={props.timelineKeyHint} label="timeline" />
        </box>

        <box flexDirection="row" gap={2} alignItems="center" flexShrink={0} flexWrap="wrap">
          <text fg={theme.theme.textMuted} wrapMode="none">
            {`[${props.selectedIndex + 1}/${Math.max(1, props.totalRows)}]`}
          </text>
          <Show when={props.mcpCount > 0}>
            <text fg={props.mcpError ? theme.theme.error : theme.theme.success} wrapMode="none">
              {`MCP ${props.mcpCount}`}
            </text>
          </Show>
          <text fg={theme.theme.textMuted} wrapMode="none">
            {`LSP ${props.lspCount}`}
          </text>
          <box flexDirection="row" gap={0} paddingLeft={1} border={["left"]} borderColor={theme.theme.borderSubtle}>
            <text fg={theme.theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
              esc
            </text>
            <text fg={theme.theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {` ${escLabel()}`}
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}
