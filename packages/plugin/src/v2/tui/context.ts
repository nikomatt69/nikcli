import type { NikcliClient } from "@nikcli-ai/sdk/v2"
import type { JSX } from "@opentui/solid"
import type { TuiEventBus, TuiState } from "../../tui.js"

/** Reactive nikcli data exposed to a v2 TUI plugin. */
export interface Data extends TuiState, TuiEventBus {}

export type Route =
  | { readonly type: "home" }
  | { readonly type: "session"; readonly sessionID: string }
  | {
      readonly type: "plugin"
      readonly id: string
      readonly name: string
      readonly data?: Record<string, unknown>
    }

export type Destination = Route | Omit<Extract<Route, { readonly type: "plugin" }>, "id">

export interface Page {
  readonly name: string
  readonly render: (input: { readonly data?: Record<string, unknown> }) => JSX.Element
}

export type Slot = (props: Record<string, unknown>) => JSX.Element

export interface UI {
  readonly router: {
    register(page: Page): () => void
    navigate(destination: Destination): void
    current(): Route
  }
  readonly slot: (name: string, render: Slot) => () => void
}

export interface Context {
  readonly options: Readonly<Record<string, unknown>>
  readonly client: NikcliClient
  readonly data: Data
  readonly ui: UI
}
