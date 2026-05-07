import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-permission-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { PermissionNext } = await import("@/permission/next")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-permission-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("PermissionNext.Service", () => {
  it("tracks pending permissions and resolves one-time replies in an instance scope", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          const fiber = yield* Effect.fork(
            permission.ask({
              permission: "edit",
              patterns: ["src/index.ts"],
              sessionID: "ses_permission_effect",
              metadata: { tool: "edit" },
              always: ["src/index.ts"],
              ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
            }),
          )

          yield* Effect.yieldNow()
          const pending = yield* permission.list()
          expect(pending).toHaveLength(1)
          expect(pending[0].permission).toBe("edit")

          yield* permission.reply({
            requestID: pending[0].id,
            reply: "once",
          })
          yield* Fiber.join(fiber)
        }).pipe(Effect.provide(PermissionNext.defaultLayer)),
      ),
    )
  })

  it("rejects pending permissions with feedback", async () => {
    const directory = await makeProjectDir()
    const error = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          const fiber = yield* Effect.fork(
            permission.ask({
              permission: "bash",
              patterns: ["rm -rf build"],
              sessionID: "ses_permission_reject_effect",
              metadata: { tool: "bash" },
              always: ["rm -rf build"],
              ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
            }).pipe(Effect.either),
          )

          yield* Effect.yieldNow()
          const pending = yield* permission.list()
          expect(pending).toHaveLength(1)

          yield* permission.reply({
            requestID: pending[0].id,
            reply: "reject",
            message: "Use a safer command",
          })

          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(PermissionNext.defaultLayer)),
      ),
    )

    expect(error._tag).toBe("Left")
    if (error._tag === "Left") {
      expect(error.left.message).toContain("Use a safer command")
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
