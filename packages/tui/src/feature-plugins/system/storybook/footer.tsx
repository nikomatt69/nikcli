import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"

export type StoryFooterControl = {
  shortcut: string
  label: string
}

/**
 * Shared chrome for storybook screens, so a story is a component plus fixtures and nothing else.
 *
 * Ported from opencode v2's storybook footer; theme comes from nikcli's `useTheme` rather than being
 * threaded through a plugin context.
 */
export function StoryFooter(props: {
  title: string
  details?: readonly string[]
  message?: string
  controls: readonly StoryFooterControl[]
}) {
  const { theme } = useTheme()

  return (
    <box flexShrink={0} flexDirection="column" backgroundColor={theme.surface.panel}>
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
        <text fg={theme.foreground.default}>{props.title}</text>
        <Show when={props.details?.length}>
          <text fg={theme.foreground.muted}> · {props.details?.join(" · ")}</text>
        </Show>
      </box>
      <Show when={props.message}>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
          <text fg={theme.foreground.muted} wrapMode="none">
            {props.message}
          </text>
        </box>
      </Show>
      <box paddingLeft={1} paddingRight={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
        <For each={props.controls}>
          {(control) => (
            <text fg={theme.foreground.default} wrapMode="none" flexShrink={0}>
              {control.shortcut} <span style={{ fg: theme.foreground.muted }}>{control.label}</span>
            </text>
          )}
        </For>
      </box>
      {/* The app-wide feature footer overlays the terminal's final row. */}
      <box height={1} />
    </box>
  )
}
