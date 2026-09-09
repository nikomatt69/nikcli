import type { JSX } from "solid-js"
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"

/**
 * What a story is allowed to do.
 *
 * Deliberately smaller than the full plugin API: a story that can reach the SDK is not a fixture any
 * more, it is a second copy of the app, and it will drift from the component it claims to show.
 * Keymap (to drive fixtures) and navigation (to get back) are the whole surface.
 */
export type StoryContext = {
  readonly keymap: TuiPluginApi["keymap"]
  /** Open another story by id, or the index when given `undefined`. */
  readonly open: (id: string | undefined) => void
}

/**
 * A story is a full-screen, fixture-driven rendering of a real production component.
 *
 * Stories own their whole screen, including the footer, and must bind escape back to the index.
 */
export type Story = {
  readonly id: string
  readonly title: string
  readonly render: (context: StoryContext) => JSX.Element
}
