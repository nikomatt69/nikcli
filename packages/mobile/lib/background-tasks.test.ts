/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import {
  collectBackgroundTasks,
  durationLabel,
  finishedTasks,
  formatTokenCount,
  runningTasks,
  statusLabel,
} from "./background-tasks"
import type { MessageWithParts, ToolState } from "./types"

function toolMessage(input: { id: string; tool: string; state: ToolState }): MessageWithParts {
  return {
    info: {
      id: input.id,
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 1 },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: `part_${input.id}`,
        sessionID: "ses_test",
        messageID: input.id,
        type: "tool",
        callID: `call_${input.id}`,
        tool: input.tool,
        state: input.state,
      },
    ],
  }
}

const runningAgent = toolMessage({
  id: "m1",
  tool: "task",
  state: {
    status: "running",
    input: { description: "Check roadmap coherence", subagent_type: "general" },
    title: "Check roadmap coherence",
    metadata: { sessionId: "ses_child", background: true, summary: [{ id: "a" }, { id: "b" }] },
    time: { start: 10_000 },
  },
})

const completedAgent = toolMessage({
  id: "m2",
  tool: "task",
  state: {
    status: "completed",
    input: { description: "Risk review" },
    output: "done",
    title: "Risk review",
    metadata: { sessionId: "ses_child2", summary: [{ id: "a" }] },
    time: { start: 1_000, end: 178_000 },
  },
})

const finishedShell = toolMessage({
  id: "m3",
  tool: "bash",
  state: {
    status: "completed",
    input: { command: "git fetch", description: "Unshallow repo fully" },
    output: "",
    title: "Unshallow repo fully",
    time: { start: 1_000, end: 2_000 },
  },
})

const runningShell = toolMessage({
  id: "m4",
  tool: "bash",
  state: {
    status: "running",
    input: { command: "bun test", description: "Run the suite" },
    title: "Run the suite",
    time: { start: 5_000 },
  },
})

describe("collectBackgroundTasks", () => {
  test("keeps agent runs and only live shell runs", () => {
    const tasks = collectBackgroundTasks([runningAgent, completedAgent, finishedShell, runningShell])

    // Live runs first, newest first within each group; the finished shell run drops out.
    expect(tasks.map((task) => task.title)).toEqual([
      "Check roadmap coherence",
      "Run the suite",
      "Risk review",
    ])
  })

  test("reads the child session, agent type and tool-use count off the task metadata", () => {
    const [task] = collectBackgroundTasks([runningAgent])

    expect(task).toMatchObject({
      kind: "agent",
      status: "running",
      childSessionID: "ses_child",
      agentType: "general",
      toolUses: 2,
      detached: true,
    })
  })

  test("an aborted run reads as stopped rather than failed", () => {
    const aborted = toolMessage({
      id: "m5",
      tool: "task",
      state: {
        status: "error",
        input: { description: "Long run" },
        error: "AbortError: run cancelled",
        time: { start: 1, end: 2 },
      },
    })

    expect(collectBackgroundTasks([aborted])[0]?.status).toBe("stopped")
    expect(statusLabel("stopped")).toBe("Stopped")
  })

  test("ignores tools that are not background work", () => {
    const read = toolMessage({
      id: "m6",
      tool: "read",
      state: { status: "completed", input: { path: "a.ts" }, output: "", title: "a.ts", time: { start: 1, end: 2 } },
    })

    expect(collectBackgroundTasks([read])).toHaveLength(0)
  })

  test("splits running from finished", () => {
    const tasks = collectBackgroundTasks([runningAgent, completedAgent])

    expect(runningTasks(tasks).map((task) => task.id)).toEqual(["part_m1"])
    expect(finishedTasks(tasks).map((task) => task.id)).toEqual(["part_m2"])
  })
})

describe("durationLabel", () => {
  test("counts up from the start while a run is live", () => {
    const [task] = collectBackgroundTasks([runningAgent])
    expect(durationLabel(task!, 59_000)).toBe("49 s")
  })

  test("uses the recorded end once a run has settled", () => {
    const [task] = collectBackgroundTasks([completedAgent])
    expect(durationLabel(task!, Date.now())).toBe("2 min 57 s")
  })
})

describe("formatTokenCount", () => {
  test("reads at a glance", () => {
    expect(formatTokenCount(940)).toBe("940")
    expect(formatTokenCount(118_412)).toBe("118.4K")
    expect(formatTokenCount(45_000)).toBe("45K")
    expect(formatTokenCount(2_000_000)).toBe("2M")
  })
})
