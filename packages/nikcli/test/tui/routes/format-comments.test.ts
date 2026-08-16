import { describe, expect, it } from "bun:test"
import { hasAnyComments, formatCommentsForAI } from "@tui/routes/changes/format-comments"
import type { Comment } from "@tui/routes/changes/comment-box"
import { recordBenchmark } from "../../benchmarks/runner"

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    line: 0,
    anchor: "new:5",
    lineType: "add",
    label: "Line 5",
    text: "This looks wrong",
    type: "bug",
    ...overrides,
  }
}

function makeMap(comments: Comment[]): Map<string, Comment> {
  const m = new Map<string, Comment>()
  for (const c of comments) m.set(c.id, c)
  return m
}

describe("hasAnyComments", () => {
  it("returns false for empty map", () => {
    expect(hasAnyComments(new Map())).toBe(false)
  })

  it("returns false when all file maps are empty", () => {
    const byFile = new Map<string, Map<string, Comment>>([
      ["file.ts", new Map()],
      ["other.ts", new Map()],
    ])
    expect(hasAnyComments(byFile)).toBe(false)
  })

  it("returns true when at least one file has a comment", () => {
    const byFile = new Map<string, Map<string, Comment>>([
      ["file.ts", new Map()],
      ["other.ts", makeMap([makeComment()])],
    ])
    expect(hasAnyComments(byFile)).toBe(true)
  })

  it("returns true for a single file with one comment", () => {
    const byFile = new Map<string, Map<string, Comment>>([["src/index.ts", makeMap([makeComment()])]])
    expect(hasAnyComments(byFile)).toBe(true)
  })
})

describe("formatCommentsForAI", () => {
  it("returns empty string for empty map", () => {
    expect(formatCommentsForAI(new Map())).toBe("")
  })

  it("returns empty string when all files have no comments", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", new Map()]])
    expect(formatCommentsForAI(byFile)).toBe("")
  })

  it("includes header text", () => {
    const byFile = new Map<string, Map<string, Comment>>([["src/app.ts", makeMap([makeComment()])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("Code Review Feedback")
    expect(result).toContain("line-level feedback")
  })

  it("includes file path as section header", () => {
    const byFile = new Map<string, Map<string, Comment>>([["src/app.ts", makeMap([makeComment()])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("## src/app.ts")
  })

  it("includes the comment text", () => {
    const byFile = new Map<string, Map<string, Comment>>([
      ["src/app.ts", makeMap([makeComment({ text: "Fix this immediately" })])],
    ])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("Fix this immediately")
  })

  it("includes [bug] type tag for bug comment", () => {
    const byFile = new Map<string, Map<string, Comment>>([["src/app.ts", makeMap([makeComment({ type: "bug" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("[bug]")
  })

  it("includes line type label for added lines", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([makeComment({ lineType: "add" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("added")
  })

  it("includes line type label for removed lines", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([makeComment({ lineType: "remove" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("removed")
  })

  it("formats anchor new: correctly", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([makeComment({ anchor: "new:42" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("Line 42 (new)")
  })

  it("formats anchor old: correctly", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([makeComment({ anchor: "old:10" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("Line 10 (old)")
  })

  it("formats anchor ln: correctly", () => {
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([makeComment({ anchor: "ln:7" })])]])
    const result = formatCommentsForAI(byFile)
    expect(result).toContain("Line 7")
  })

  it("sorts comments by line number within a file", () => {
    const c1 = makeComment({ id: "c1", line: 20, anchor: "new:20" })
    const c2 = makeComment({ id: "c2", line: 5, anchor: "new:5" })
    const byFile = new Map<string, Map<string, Comment>>([["file.ts", makeMap([c1, c2])]])
    const result = formatCommentsForAI(byFile)
    const pos20 = result.indexOf("Line 20")
    const pos5 = result.indexOf("Line 5")
    expect(pos5).toBeLessThan(pos20)
  })

  describe("benchmark", () => {
    it("formatCommentsForAI throughput", () => {
      const comments = Array.from({ length: 5 }, (_, i) =>
        makeComment({ id: `c${i}`, line: i, anchor: `new:${i}`, text: `comment ${i}` }),
      )
      const byFile = new Map<string, Map<string, Comment>>([
        ["src/a.ts", makeMap(comments.slice(0, 2))],
        ["src/b.ts", makeMap(comments.slice(2, 5))],
      ])
      const r = recordBenchmark({
        suite: "tui-comments",
        module: "formatCommentsForAI",
        scenario: "throughput",
        iterations: 50_000,
        value: formatCommentsForAI(byFile) as unknown as number,
        unit: "ms",
      })
    })
  })
})
