import { describe, expect, it } from "bun:test"
import { runSyncConnect, type SyncConnectDeps } from "@/cli/cmd/sync"

describe("runSyncConnect", () => {
  it("sets exit code 1 when remote is not configured", async () => {
    const prev = process.exitCode
    process.exitCode = 0
    try {
      await runSyncConnect({
        readRemote: async () => undefined,
        withInstance: async (_opts, fn) => fn(),
        getProjectId: () => "proj",
        remoteStart: async () => ({ stop: async () => {} }),
        onSignal: () => {},
        offSignal: () => {},
      })
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = prev
    }
  })

  it("starts remote sync and stops on SIGINT", async () => {
    const stops: string[] = []
    const signals: Array<"SIGINT" | "SIGTERM"> = []
    const handlers = new Map<string, () => void>()

    const deps: SyncConnectDeps = {
      readRemote: async () => ({
        url: "https://hub.test",
        token: "tok",
        source: "config",
      }),
      withInstance: async (_opts, fn) => fn(),
      getProjectId: () => "proj-1",
      remoteStart: async (opts) => {
        expect(opts).toEqual({
          url: "https://hub.test",
          token: "tok",
          projectID: "proj-1",
        })
        return {
          stop: async () => {
            stops.push("stopped")
          },
        }
      },
      onSignal: (signal, handler) => {
        signals.push(signal)
        handlers.set(signal, handler)
        if (signal === "SIGINT") queueMicrotask(handler)
      },
      offSignal: (signal, handler) => {
        expect(handlers.get(signal)).toBe(handler)
      },
    }

    await runSyncConnect(deps)
    expect(stops).toEqual(["stopped"])
    expect(signals).toContain("SIGINT")
    expect(signals).toContain("SIGTERM")
  })
})
