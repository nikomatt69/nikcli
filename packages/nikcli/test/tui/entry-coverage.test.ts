import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import { SessionEntry } from "@/session/v2/entry"

/**
 * Every entry type reaches the screen.
 *
 * The session renderer draws from the v2 entry union. `fromEntries` folds some
 * types into the turn itself and the rest are looked up in `PART_MAPPING` — and
 * a type in neither used to render as *nothing*, with no error and no gap in
 * the transcript to notice. That is how `retry`, `subtask` and `synthetic`
 * became invisible when the renderer moved onto entries.
 *
 * This reads the source rather than the components because the alternative is
 * importing the session route, which pulls in the whole TUI. The union comes
 * from the schema itself, so adding a type to `SessionEntry` and forgetting the
 * renderer fails here.
 */

// `URL.pathname` is `/C:/…` on Windows — the leading slash makes the path
// unopenable. `fileURLToPath` yields a native path on every platform.
const root = fileURLToPath(new URL("../../src/", import.meta.url))

async function source(path: string) {
  return await Bun.file(root + path).text()
}

/** Types the turn model absorbs as properties instead of rows. */
async function absorbed() {
  const text = await source("cli/cmd/tui/routes/session/view.ts")
  return new Set([...text.matchAll(/entry\.type === "([a-z-]+)"/g)].map((match) => match[1]!))
}

/** Types with a component in `PART_MAPPING`. */
async function drawn() {
  const text = await source("cli/cmd/tui/routes/session/index.tsx")
  const table = /const PART_MAPPING = \{([^}]*)\}/.exec(text)
  expect(table).not.toBeNull()
  return new Set([...table![1]!.matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1]!))
}

describe("entry coverage", () => {
  it("the union is exactly the types the renderer was written against", () => {
    const types = SessionEntry.Entry.options.map((option) => option.shape.type.value as string).sort()
    expect(types).toEqual([
      "compaction",
      "complete",
      "patch",
      "reasoning",
      "retry",
      "snapshot",
      "start",
      "step-finish",
      "step-start",
      "subtask",
      "synthetic",
      "text",
      "tool",
      "user",
    ])
  })

  it("every type is either absorbed by the turn or drawn as a row", async () => {
    const [byTurn, byRow] = await Promise.all([absorbed(), drawn()])
    const missing = SessionEntry.Entry.options
      .map((option) => option.shape.type.value as string)
      .filter((type) => !byTurn.has(type) && !byRow.has(type))

    // A type here renders as nothing at all. Add a component to `PART_MAPPING`,
    // or fold it into the turn in `fromEntries`.
    expect(missing).toEqual([])
  })

  it("the three that regressed are drawn, not absorbed", async () => {
    const byRow = await drawn()
    for (const type of ["retry", "subtask", "synthetic"]) {
      expect(byRow.has(type)).toBe(true)
    }
  })

  it("there is a fallback, so an unmapped type is visible rather than silent", async () => {
    const text = await source("cli/cmd/tui/routes/session/index.tsx")
    expect(text).toContain("fallback={<UnknownPart")
  })
})
