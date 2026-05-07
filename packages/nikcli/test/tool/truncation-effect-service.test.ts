import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-truncation-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { Truncate } = await import("@/tool/truncation")

describe("Truncate.Service", () => {
  beforeEach(async () => {
    await fs.rm(Truncate.DIR, { recursive: true, force: true })
    await fs.mkdir(Truncate.DIR, { recursive: true })
  })

  it("returns unmodified content when output is under limits", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        return yield* truncate.output("short", { maxLines: 5, maxBytes: 100 })
      }).pipe(Effect.provide(Truncate.defaultLayer)),
    )

    expect(result).toEqual({ content: "short", truncated: false })
  })

  it("writes full content and returns a truncated message when limits are exceeded", async () => {
    const text = ["a", "b", "c", "d"].join("\n")
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        return yield* truncate.output(text, { maxLines: 2, maxBytes: 100 })
      }).pipe(Effect.provide(Truncate.defaultLayer)),
    )

    expect(result.truncated).toBe(true)
    if (result.truncated) {
      expect(await Bun.file(result.outputPath).text()).toBe(text)
      expect(result.content).toContain("2 lines truncated")
    }
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
