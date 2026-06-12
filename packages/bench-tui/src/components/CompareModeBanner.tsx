import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short } from "../types"

interface CompareModeBannerProps {
  compareLeft: string | null
  compareRight: string | null
  compareResultsLength: number
  onClose: () => void
}

export function CompareModeBanner(props: CompareModeBannerProps) {
  return (
    <box paddingLeft={2} paddingRight={2} backgroundColor={theme.surfaceHover} flexDirection="row" height={1} gap={1}>
      <text fg={theme.purple} attributes={TextAttributes.BOLD}>COMPARE</text>
      <text fg={theme.cyan}>{short(props.compareLeft ?? "", 12)}</text>
      <text fg={theme.textMuted}>vs</text>
      <text fg={theme.yellow}>{short(props.compareRight ?? "", 12)}</text>
      <text fg={theme.textMuted}>({props.compareResultsLength} benchmark{props.compareResultsLength !== 1 ? "s" : ""})</text>
      <box flexGrow={1} />
      <text fg={theme.textMuted}>c/esc=close C=swap</text>
    </box>
  )
}
