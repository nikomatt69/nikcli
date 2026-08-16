import { describe, expect, it } from "bun:test"
import { getMonitorsForSession } from "@tui/util/monitor-helpers"

describe("getMonitorsForSession", () => {
  it("returns live monitor event snapshots before a tool part has monitor metadata", () => {
    const sync = {
      data: {
        message: { ses_1: [] },
        part: {},
        monitor: {
          ses_1: [
            {
              id: "mon_1",
              title: "Typecheck",
              command: "bun run typecheck",
              status: "running",
              logPath: "/tmp/typecheck.log",
              preview: "starting",
              bytes: 8,
            },
          ],
        },
      },
    } as any

    expect(getMonitorsForSession(sync, "ses_1")).toEqual([
      {
        id: "mon_1",
        title: "Typecheck",
        command: "bun run typecheck",
        status: "running",
        logPath: "/tmp/typecheck.log",
        preview: "starting",
        bytes: 8,
      },
    ])
  })

  it("prefers live monitor event state over stale tool part metadata", () => {
    const sync = {
      data: {
        message: { ses_1: [{ id: "msg_1" }] },
        part: {
          msg_1: [
            {
              type: "tool",
              tool: "monitor",
              state: {
                input: { command: "bun test" },
                metadata: {
                  monitorId: "mon_1",
                  title: "Old test",
                  status: "running",
                  logPath: "/tmp/old.log",
                  recentOutput: "old",
                  bytes: 1,
                },
              },
            },
          ],
        },
        monitor: {
          ses_1: [
            {
              id: "mon_1",
              title: "Current test",
              command: "bun test",
              status: "complete",
              logPath: "/tmp/current.log",
              exitCode: 0,
              preview: "done",
              bytes: 42,
            },
          ],
        },
      },
    } as any

    expect(getMonitorsForSession(sync, "ses_1")).toEqual([
      {
        id: "mon_1",
        title: "Current test",
        command: "bun test",
        status: "complete",
        logPath: "/tmp/current.log",
        exitCode: 0,
        preview: "done",
        bytes: 42,
      },
    ])
  })
})
