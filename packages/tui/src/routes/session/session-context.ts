import { createContext, useContext } from "solid-js"
import type { useSync } from "@tui/context/sync"

/**
 * View state shared by everything the session route renders.
 *
 * Lives in its own module because both halves of the split need it: the route
 * and its message components in `index.tsx`, and the tool renderers in
 * `tool-view.tsx`. Keeping it in either would make that file the other's
 * dependency for no reason beyond where it happened to be declared.
 */
export type SessionViewContext = {
  width: number
  /**
   * Terminal height. Shared here rather than read from `useTerminalDimensions`
   * per component: every subscriber is one `resize` listener on the renderer,
   * and the message components below are instantiated once per rendered part —
   * a long session blew past the emitter's cap and printed a
   * MaxListenersExceededWarning over the first frame.
   */
  height: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  diffWrapMode: () => "word" | "none"
  messageCreatedAt: () => Record<string, number>
  sync: ReturnType<typeof useSync>
}

export const context = createContext<SessionViewContext>()

export function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
