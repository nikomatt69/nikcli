import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-storage-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { Storage } = await import("@/storage/storage")

function runStorage<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Storage.Service", () => {
  it("writes, reads, updates, lists, and removes JSON records through the Effect boundary", async () => {
    const key = ["effect", "record"]

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(key, { count: 1 })
        const first = yield* storage.read<{ count: number }>(key)
        expect(first).toEqual({ count: 1 })

        const updated = yield* storage.update<{ count: number }>(key, (draft) => {
          draft.count += 1
        })
        expect(updated).toEqual({ count: 2 })

        const listed = yield* storage.list(["effect"])
        expect(listed).toContainEqual(key)

        yield* storage.remove(key)
        const missing = yield* storage.read(key).pipe(Effect.exit)
        expect(missing._tag).toBe("Failure")
      }),
    )
  })
})
