import { describe, expect, it } from "bun:test"
import {
  groupLabel,
  groupParts,
  isExplorationTool,
  type ExplorationGroup,
  type RowPart,
  type SessionRow,
} from "../../../src/cli/cmd/tui/routes/session/rows"

type Part = RowPart & { id: string }

const tool = (id: string, name: string): Part => ({ id, type: "tool", tool: name, callID: id })
const text = (id: string): Part => ({ id, type: "text" })

/** Compact shape assertions read better than deep-equalling whole rows. */
const shape = (rows: SessionRow<Part>[]) =>
  rows.map((row) => (row.type === "part" ? row.part.id : `[${row.parts.map((p) => p.id).join(",")}]`))

const groups = (rows: SessionRow<Part>[]) => rows.filter((row): row is ExplorationGroup<Part> => row.type === "group")

describe("session rows", () => {
  it("classifies read-only tools as exploration and mutating ones as not", () => {
    expect(isExplorationTool("read")).toBe(true)
    expect(isExplorationTool("grep")).toBe(true)
    expect(isExplorationTool("edit")).toBe(false)
    expect(isExplorationTool("bash")).toBe(false)
    expect(isExplorationTool(undefined)).toBe(false)
  })

  it("folds a run of consecutive exploration calls into one row", () => {
    const rows = groupParts([tool("a", "read"), tool("b", "grep"), tool("c", "glob")])
    expect(shape(rows)).toEqual(["[a,b,c]"])
  })

  it("keeps non-exploration parts as their own rows and splits runs around them", () => {
    const rows = groupParts([tool("a", "read"), tool("b", "grep"), text("t"), tool("c", "glob"), tool("d", "list")])
    expect(shape(rows)).toEqual(["[a,b]", "t", "[c,d]"])
  })

  it("does not fold a mutating call into a surrounding run", () => {
    const rows = groupParts([tool("a", "read"), tool("w", "edit"), tool("b", "grep")])
    expect(shape(rows)).toEqual(["a", "w", "b"])
  })

  it("unfolds runs shorter than the minimum back into plain part rows", () => {
    expect(shape(groupParts([tool("a", "read"), text("t")]))).toEqual(["a", "t"])
    expect(shape(groupParts([tool("a", "read")], { minimum: 3 }))).toEqual(["a"])
    expect(shape(groupParts([tool("a", "read"), tool("b", "read")], { minimum: 3 }))).toEqual(["a", "b"])
    expect(shape(groupParts([tool("a", "read"), tool("b", "read"), tool("c", "read")], { minimum: 3 }))).toEqual([
      "[a,b,c]",
    ])
  })

  it("marks a run complete only once something follows it", () => {
    const live = groupParts([tool("a", "read"), tool("b", "read")])
    expect(groups(live)[0].completed).toBe(false)

    const ended = groupParts([tool("a", "read"), tool("b", "read"), text("t")])
    expect(groups(ended)[0].completed).toBe(true)
  })

  it("closes a trailing run when the message is finished", () => {
    const rows = groupParts([tool("a", "read"), tool("b", "read")], { closed: true })
    expect(groups(rows)[0].completed).toBe(true)
  })

  it("surfaces calls blocked on the user without reordering or dropping them", () => {
    const parts = [tool("a", "read"), tool("b", "grep"), tool("c", "glob")]
    const rows = groupParts(parts, { isPending: (part) => part.id === "b" })
    const group = groups(rows)[0]

    // The blocked call stays in the ordered run so collapsing cannot lose it...
    expect(group.parts.map((part) => part.id)).toEqual(["a", "b", "c"])
    // ...and is also flagged so the view can render it expanded.
    expect(group.pending.map((part) => part.id)).toEqual(["b"])
  })

  it("labels a group by how many calls it stands for", () => {
    const rows = groupParts([tool("a", "read"), tool("b", "read"), tool("c", "read")])
    expect(groupLabel(groups(rows)[0])).toBe("Explored 3 locations")

    const pair = groupParts([tool("a", "read"), tool("b", "read")])
    expect(groupLabel(groups(pair)[0])).toBe("Explored 2 locations")
  })

  it("returns nothing for an empty message", () => {
    expect(groupParts([])).toEqual([])
  })
})
