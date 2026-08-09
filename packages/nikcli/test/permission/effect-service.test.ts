import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PermissionNext as PermissionNextNamespace } from "@/permission/next"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-permission-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

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
  const waitForPending = Effect.fn("PermissionNext.test.waitForPending")(function* (
    permission: PermissionNextNamespace.Interface,
  ) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const pending = yield* permission.list()
      if (pending.length > 0) return pending
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))
    }
    return yield* permission.list()
  })

  it("tracks pending permissions and resolves one-time replies in an instance scope", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          const fiber = yield* Effect.forkChild(
            permission.ask({
              permission: "edit",
              patterns: ["src/index.ts"],
              sessionID: "ses_permission_effect",
              metadata: { tool: "edit" },
              always: ["src/index.ts"],
              ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
            }),
          )

          const pending = yield* waitForPending(permission)
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
          const fiber = yield* Effect.forkChild(
            permission
              .ask({
                permission: "bash",
                patterns: ["rm -rf build"],
                sessionID: "ses_permission_reject_effect",
                metadata: { tool: "bash" },
                always: ["rm -rf build"],
                ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
              })
              .pipe(Effect.result),
          )

          const pending = yield* waitForPending(permission)
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

    expect(error._tag).toBe("Failure")
    if (error._tag === "Failure") {
      expect(error.failure.message).toContain("Use a safer command")
    }
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
