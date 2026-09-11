import { TextAttributes, type RGBA } from "@opentui/core"
import { For, Show, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"

/** Action-based footer hint that looks up the keybind automatically */
export function FooterHintAction(props: { action: string; label?: string }) {
  const t = useTheme()
  const keybind = useKeybind()
  const key = () => keybind.print(props.action)
  const label = () => props.label ?? props.action.replace(/_/g, " ")

  // Keybinds arrive with the config, so the first render can legitimately have
  // no key for an action that gets one a tick later. An early `return null` ran
  // once, outside any reactive scope, and the hint never came back.
  return (
    <Show when={key()}>
      <box flexDirection="row" gap={1} alignItems="baseline">
        <text fg={t.theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          {key()}
        </text>
        <text fg={t.theme.foreground.muted} attributes={TextAttributes.DIM} wrapMode="none">
          {` ${label()}`}
        </text>
      </box>
    </Show>
  )
}

/**
 * `tone` colours the label for a hint whose state matters — "saving…" while a
 * toggle is in flight, say. Without it those rows stayed hand-rolled just to
 * keep one colour, which is how the footer conventions drifted apart.
 */
export function FooterHint(props: { keys: string; label: string; tone?: RGBA }) {
  const t = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="baseline">
      <text fg={t.theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.keys}
      </text>
      <text
        fg={props.tone ?? t.theme.foreground.muted}
        attributes={props.tone ? undefined : TextAttributes.DIM}
        wrapMode="none"
      >
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
