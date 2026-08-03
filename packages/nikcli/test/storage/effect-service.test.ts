import { preserveTestEnv } from "../helpers/env"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import { runPromiseWithLayer } from "@/effect"
import { Storage } from "@/storage/storage"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-storage-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

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

  it("creates parent directories for nested records", async () => {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const key = ["nested", "path", "record"]
        yield* storage.write(key, { ok: true })
        expect(yield* storage.read<{ ok: boolean }>(key)).toEqual({ ok: true })
      }),
    )
  })

  it("surfaces a tagged Storage.NotFoundError when reading a missing key", async () => {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const exit = yield* storage.read(["missing", "key"]).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const cause = exit.cause
          const fail = cause.reasons.find((r) => r._tag === "Fail")
          expect(fail).toBeDefined()
          const err = (fail as { error: unknown }).error
          expect(err).toBeInstanceOf(Storage.NotFoundError)
          expect((err as Storage.NotFoundError)._tag).toBe("NotFoundError")
          expect((err as Storage.NotFoundError).message).toContain("Resource not found")
        }
      }),
    )
  })

  it("error union contains both NotFoundError and IOError", () => {
    // Compile-time check: an `Effect<X, Storage.Error>` channel is assignable
    // to a `Effect<X, Storage.NotFoundError | Storage.IOError>` channel.
    const a: Effect.Effect<number, Storage.Error> = Effect.succeed(1)
    const b: Effect.Effect<number, Storage.NotFoundError | Storage.IOError> = a
    expect(b).toBe(a)
  })

  it("catches NotFoundError via Effect.catchTag with the literal _tag", async () => {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const recovered = yield* storage
          .read(["absent"])
          .pipe(Effect.catchTag("NotFoundError", (err) => Effect.succeed(err._tag)))
        expect(recovered).toBe("NotFoundError")
      }),
    )
  })
})
