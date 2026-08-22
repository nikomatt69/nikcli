import { describe, expect, test } from "bun:test"
import { createRefreshQueue } from "./queue"

const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))

describe("createRefreshQueue", () => {
  test("reports a refresh failure even when the queue becomes paused", async () => {
    const failure = new Error("refresh failed")
    let paused = false
    let report: (error: unknown) => void = () => {}
    const reported = new Promise<unknown>((resolve) => {
      report = resolve
    })
    const queue = createRefreshQueue({
      paused: () => paused,
      bootstrap: async () => {
        paused = true
        throw failure
      },
      bootstrapInstance: () => {},
      onError: report,
    })

    queue.refresh()

    expect(await Promise.race([reported, timeout(1_000)])).toBe(failure)
    queue.dispose()
  })
})
