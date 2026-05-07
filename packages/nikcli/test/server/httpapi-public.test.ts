import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { HttpApiBuilder } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Fiber, Layer, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-public-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { InstanceScope, withCurrentInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { PermissionNext } = await import("@/permission/next")
const { Question } = await import("@/question")
const { PublicHttpApi } = await import("@/server/httpapi/public")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-public-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Public HttpApi", () => {
  it("serves implemented question and permission slices from one Effect HttpApi", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const memoMap = Effect.runSync(Layer.makeMemoMap)
          const serviceRuntime = ManagedRuntime.make(
            Layer.mergeAll(Question.defaultLayer, PermissionNext.defaultLayer),
            memoMap,
          )
          const { handler, dispose } = HttpApiBuilder.toWebHandler(
            Layer.mergeAll(PublicHttpApi.layer, BunHttpServer.layerContext),
            { memoMap },
          )

          const questionFiber = serviceRuntime.runFork(
            withCurrentInstance(
              Effect.gen(function* () {
                const question = yield* Question.Service
                return yield* question.ask({
                  sessionID: "session-httpapi-public-question",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [{ label: "Yes", description: "Continue" }],
                    },
                  ],
                })
              }),
            ),
          )
          const permissionFiber = serviceRuntime.runFork(
            withCurrentInstance(
              Effect.gen(function* () {
                const permission = yield* PermissionNext.Service
                yield* permission.ask({
                  permission: "edit",
                  patterns: ["src/index.ts"],
                  sessionID: "session-httpapi-public-permission",
                  metadata: { tool: "edit" },
                  always: ["src/index.ts"],
                  ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
                })
              }),
            ),
          )
          await Promise.resolve()

          const questions = (await handler(new Request("http://nikcli.local/question")).then((response) =>
            response.json(),
          )) as Array<{ id: string }>
          const permissions = (await handler(new Request("http://nikcli.local/permission")).then((response) =>
            response.json(),
          )) as Array<{ id: string }>

          expect(questions).toHaveLength(1)
          expect(permissions).toHaveLength(1)

          await handler(
            new Request(`http://nikcli.local/question/${questions[0].id}/reply`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ answers: [["Yes"]] }),
            }),
          )
          await handler(
            new Request(`http://nikcli.local/permission/${permissions[0].id}/reply`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reply: "once" }),
            }),
          )

          await serviceRuntime.runPromise(Effect.all([Fiber.join(questionFiber), Fiber.join(permissionFiber)]))
          await dispose()
          await serviceRuntime.dispose()
        }),
      ),
    )
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
