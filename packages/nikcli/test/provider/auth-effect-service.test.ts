import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-provider-auth-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { ProviderAuth } = await import("@/provider/auth")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-provider-auth-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("ProviderAuth.Service", () => {
  it("loads auth methods and returns missing callback as a typed domain error", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const providerAuth = yield* ProviderAuth.Service
          const methods = yield* providerAuth.methods()
          const missing = yield* providerAuth
            .callback({
              providerID: "missing-provider",
              method: 0,
            })
            .pipe(Effect.either)

          return { methods, missing }
        }).pipe(Effect.provide(ProviderAuth.defaultLayer)),
      ),
    )

    expect(Object.keys(result.methods).length).toBeGreaterThan(0)
    for (const methods of Object.values(result.methods)) {
      for (const method of methods) {
        expect(ProviderAuth.Method.parse(method)).toEqual(method)
      }
    }
    expect(result.missing._tag).toBe("Left")
    if (result.missing._tag === "Left") {
      expect(result.missing.left).toBeInstanceOf(ProviderAuth.OauthMissing)
    }
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
