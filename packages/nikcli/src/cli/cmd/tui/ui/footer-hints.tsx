import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

export function FooterHint(props: { keys: string; label: string }) {
  const t = useTheme()
  return (
    <box flexDirection="row" gap={0} alignItems="baseline">
      <text fg={t.theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.keys}
      </text>
      <text fg={t.theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
        {` ${props.label}`}
      </text>
    </box>
  )
}

export function FooterSep() {
  const t = useTheme()
  return (
    <text fg={t.theme.borderSubtle} wrapMode="none">
      │
    </text>
  )
}
