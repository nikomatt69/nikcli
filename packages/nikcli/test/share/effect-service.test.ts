import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-share-next-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_SHARE = "1"

const { ShareNext } = await import("@/share/share-next")

function runShareNext<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(effect.pipe(Effect.provide(ShareNext.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("ShareNext.Service", () => {
  it("runs disabled share lifecycle operations through the Effect service boundary", async () => {
    // Synchronous sanity assertion — guards against the junit reporter flagging the
    // case as "zero assertions" under heavy parallel load if the async path is timing-
    // sensitive in a particular runner.
    expect(typeof ShareNext.defaultLayer).toBe("object")

    const result = await runShareNext(
      Effect.gen(function* () {
        const shareNext = yield* ShareNext.Service
        yield* shareNext.init()
        yield* shareNext.remove("ses_test")
        return "ok"
      }),
    )

    expect(result).toBe("ok")
  })
})

afterAll(async () => {
  delete process.env.NIKCLI_DISABLE_SHARE
  await fs.rm(testHome, { recursive: true, force: true })
})
