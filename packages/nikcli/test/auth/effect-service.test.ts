import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-auth-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome

const { Auth } = await import("@/auth")

function runAuth<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(effect.pipe(Effect.provide(Auth.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("Auth.Service", () => {
  beforeEach(async () => {
    delete process.env.NIKCLI_AUTH_CONTENT
    await fs.rm(path.join(testHome, "data", "auth.json"), { force: true })
    await fs.mkdir(path.join(testHome, "data"), { recursive: true })
  })

  it("stores, reads, validates, and removes credentials through the Effect service boundary", async () => {
    const result = await runAuth(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "EXAMPLE_TOKEN",
          token: "token",
        })
        yield* auth.set("openrouter", {
          type: "api",
          key: "key",
        })

        const normalized = yield* auth.get("https://example.com")
        const api = yield* auth.getValid("openrouter")
        const all = yield* auth.all()

        yield* auth.remove("openrouter")
        const removed = yield* auth.get("openrouter")

        return { normalized, api, all, removed }
      }),
    )

    expect(result.normalized).toEqual({ type: "wellknown", key: "EXAMPLE_TOKEN", token: "token" })
    expect(result.api).toEqual({ type: "api", key: "key" })
    expect(Object.keys(result.all).sort()).toEqual(["https://example.com", "openrouter"])
    expect(result.removed).toBeUndefined()
  })

  it("merges valid credentials from NIKCLI_AUTH_CONTENT", async () => {
    process.env.NIKCLI_AUTH_CONTENT = JSON.stringify({
      "env-provider": { type: "api", key: "from-env" },
      invalid: { type: "api" },
    })

    const result = await runAuth(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        return yield* auth.all()
      }),
    )

    expect(result["env-provider"]).toEqual({ type: "api", key: "from-env" })
    expect(result.invalid).toBeUndefined()
  })
})

afterAll(async () => {
  delete process.env.NIKCLI_AUTH_CONTENT
  await fs.rm(testHome, { recursive: true, force: true })
})
