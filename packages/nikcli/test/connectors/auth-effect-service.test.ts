import { preserveTestEnv } from "../helpers/env"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-connector-auth-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome

preserveTestEnv(["NIKCLI_TEST_HOME"])

const { ConnectorAuth } = await import("@/connectors/auth")

function runConnectorAuth<A, E>(effect: Effect.Effect<A, E, any>) {
  // SAFETY: `ConnectorAuth.defaultLayer` provides every requirement the effect
  // declares, so nothing is left for the runtime to supply.
  return Effect.runPromise(effect.pipe(Effect.provide(ConnectorAuth.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("ConnectorAuth.Service", () => {
  beforeEach(async () => {
    await fs.rm(path.join(testHome, "data", "connectors-auth.json"), { force: true })
    await fs.mkdir(path.join(testHome, "data"), { recursive: true })
  })

  it("stores and reads connector credentials through the Effect service boundary", async () => {
    const result = await runConnectorAuth(
      Effect.gen(function* () {
        const auth = yield* ConnectorAuth.Service
        yield* auth.updateToken("github", "token", Date.now() / 1000 + 3600)
        yield* auth.updateBotToken("slack", "bot", "team")
        yield* auth.updateApiKey("lovable", "api")

        const github = yield* auth.get("github")
        const slack = yield* auth.get("slack")
        const lovable = yield* auth.get("lovable")
        const expired = yield* auth.isTokenExpired("github")
        const all = yield* auth.all()

        yield* auth.remove("github")
        const removed = yield* auth.get("github")

        return { github, slack, lovable, expired, all, removed }
      }),
    )

    expect(result.github?.token).toBe("token")
    expect(result.slack).toEqual({ botToken: "bot", teamId: "team" })
    expect(result.lovable).toEqual({ apiKey: "api" })
    expect(result.expired).toBe(false)
    expect(Object.keys(result.all).sort()).toEqual(["github", "lovable", "slack"])
    expect(result.removed).toBeUndefined()
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
