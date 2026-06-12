import { TextAttributes } from "@opentui/core"
import { theme, severityColor } from "../theme"
import { short, type AlertSeverity } from "../types"

export interface ConfirmDialogState {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  cancelLabel?: string
  severity: AlertSeverity
  onConfirm: () => void | Promise<void>
}

interface ConfirmDialogProps {
  width: number
  height: number
  dialog: ConfirmDialogState
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const w = Math.min(76, Math.max(44, props.width - 8))
  const color = () => severityColor(props.dialog.severity)

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={props.width}
      height={props.height}
      backgroundColor={theme.overlay}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      onMouseUp={props.onCancel}
    >
      <box
        border
        borderColor={color()}
        backgroundColor={theme.surface}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
        width={w}
        onMouseUp={(event) => event.stopPropagation()}
      >
        <text fg={color()} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.dialog.title}
        </text>
        <text fg={theme.text} wrapMode="word">
          {props.dialog.message}
        </text>
        {props.dialog.detail && (
          <text fg={theme.textMuted} wrapMode="word">
            {short(props.dialog.detail, w - 4)}
          </text>
        )}
        <text fg={theme.border} wrapMode="none">
          {"-".repeat(Math.max(0, w - 4))}
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme.bg} bg={color()} attributes={TextAttributes.BOLD} wrapMode="none" onMouseUp={props.onConfirm}>
            Enter/Y {props.dialog.confirmLabel}
          </text>
          <text fg={theme.textMuted} wrapMode="none" onMouseUp={props.onCancel}>
            Esc/N {props.dialog.cancelLabel ?? "Cancel"}
          </text>
        </box>
      </box>
    </box>
  )
}
