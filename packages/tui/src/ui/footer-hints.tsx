import { TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"

/** Action-based footer hint that looks up the keybind automatically */
export function FooterHintAction(props: { action: string; label?: string }) {
  const t = useTheme()
  const keybind = useKeybind()
  const key = () => keybind.print(props.action)
  const label = () => props.label ?? props.action.replace(/_/g, " ")

  if (!key()) return null

  return (
    <box flexDirection="row" gap={1} alignItems="baseline">
      <text fg={t.theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
        {key()}
      </text>
      <text fg={t.theme.foreground.muted} attributes={TextAttributes.DIM} wrapMode="none">
        {` ${label()}`}
      </text>
    </box>
  )
}

export function FooterHint(props: { keys: string; label: string }) {
  const t = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="baseline">
      <text fg={t.theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.keys}
      </text>
      <text fg={t.theme.foreground.muted} attributes={TextAttributes.DIM} wrapMode="none">
        {` ${props.label}`}
      </text>
    </box>
  )
}

export function FooterSep() {
  const t = useTheme()
  return (
    <text fg={t.theme.border.subtle} wrapMode="none">
      │
    </text>
  )
}

/** Group of footer hints with separator dots between them */
export function FooterHintGroup(props: { children: JSX.Element | JSX.Element[] }) {
  const t = useTheme()
  const children = Array.isArray(props.children) ? props.children : [props.children]

  return (
    <box flexDirection="row" gap={1} alignItems="baseline" flexWrap="wrap">
      <For each={children}>
        {(child, index) => (
          <>
            {child}
            {index() < children.length - 1 && (
              <text fg={t.theme.border.subtle} wrapMode="none">
                ·
              </text>
            )}
          </>
        )}
      </For>
    </box>
  )
}
