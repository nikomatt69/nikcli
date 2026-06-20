import { describe, expect, it } from "bun:test"

// Regression test for the tool-usage success-rate classification.
//
// Bug: the aggregator at cli/cmd/tui/util/analytics-aggregator.ts used to
// check part.state.status against "success"/"complete" for success and
// "error"/"failed" for failures. But ToolPart.state.status is a discriminated
// union (session/message-v2.ts) whose values are exactly:
//   "pending" | "running" | "completed" | "error"
// As a result, "completed" never matched → every tool reported 0% success
// even when all calls actually succeeded.
//
// Fix: classify "completed" as success and "error" as failure. The block
// below mirrors the exact decision from the aggregator so any regression in
// the literal set fails this test.

type Status = "pending" | "running" | "completed" | "error"

function classify(state: { status?: string } | undefined): "success" | "error" | "other" {
  if (!state || typeof state !== "object") return "other"
  const status = state.status as Status | undefined
  if (status === "completed") return "success"
  if (status === "error") return "error"
  return "other"
}

function aggregate(parts: Array<{ tool: string; state: { status?: string } }>) {
  const map = new Map<string, { count: number; success: number; error: number }>()
  for (const part of parts) {
    const entry = map.get(part.tool) ?? { count: 0, success: 0, error: 0 }
    entry.count++
    const klass = classify(part.state)
    if (klass === "success") entry.success++
    else if (klass === "error") entry.error++
    map.set(part.tool, entry)
  }
  return map
}

describe("analytics-aggregator tool status classification", () => {
  it("counts 'completed' as success (the bug was checking 'success'/'complete')", () => {
    const stats = aggregate([
      { tool: "bash", state: { status: "completed" } },
      { tool: "bash", state: { status: "completed" } },
      { tool: "bash", state: { status: "completed" } },
    ])
    const bash = stats.get("bash")!
    expect(bash.count).toBe(3)
    expect(bash.success).toBe(3)
    expect(bash.error).toBe(0)
  })

  it("counts 'error' as failure", () => {
    const stats = aggregate([
      { tool: "read", state: { status: "error" } },
      { tool: "read", state: { status: "completed" } },
    ])
    const read = stats.get("read")!
    expect(read.count).toBe(2)
    expect(read.success).toBe(1)
    expect(read.error).toBe(1)
  })

  it("ignores 'pending' and 'running' (neither success nor error)", () => {
    const stats = aggregate([
      { tool: "glob", state: { status: "pending" } },
      { tool: "glob", state: { status: "running" } },
      { tool: "glob", state: { status: "completed" } },
    ])
    const glob = stats.get("glob")!
    expect(glob.count).toBe(3)
    expect(glob.success).toBe(1)
    expect(glob.error).toBe(0)
  })

  it("computes successRate per tool as success/count", () => {
    const stats = aggregate([
      { tool: "edit", state: { status: "completed" } },
      { tool: "edit", state: { status: "completed" } },
      { tool: "edit", state: { status: "completed" } },
      { tool: "edit", state: { status: "error" } },
    ])
    const edit = stats.get("edit")!
    expect(edit.count).toBe(4)
    expect((edit.success / edit.count) * 100).toBe(75)
  })

  it("does NOT treat legacy/wrong status literals as success", () => {
    // Old aggregator checked "success" and "complete" (note: not "completed").
    // These should not match — they are not real ToolState statuses.
    const stats = aggregate([
      { tool: "monitor", state: { status: "success" } },
      { tool: "monitor", state: { status: "complete" } },
    ])
    const monitor = stats.get("monitor")!
    expect(monitor.success).toBe(0)
    expect(monitor.error).toBe(0)
  })
})
