import { Identifier } from "@nikcli-ai/util/id"

// Session primitives shared with client processes (TUI). They live outside
// session/index.ts so the TUI can validate IDs, recognize default titles, and
// match event names without evaluating the full session/provider chain.
export namespace SessionPrimitives {
  export const ID = Identifier.schema("session")

  export const parentTitlePrefix = "New session - "
  export const childTitlePrefix = "Child session - "
  const DEFAULT_TITLE_REGEX = new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  )

  export function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return DEFAULT_TITLE_REGEX.test(title)
  }

  // Single source of truth for session event names; session/index.ts passes
  // these to BusEvent.define, so TUI-side listeners cannot drift.
  export const EventName = {
    updated: "session.updated",
    deleted: "session.deleted",
    diff: "session.diff",
    error: "session.error",
  } as const
}
