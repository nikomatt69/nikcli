import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { HttpRouter } from "effect/unstable/http"
import { BunFileSystem, BunHttpServer, BunPath } from "@effect/platform-bun"
import { Context, Effect, Fiber, Layer, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-question-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { InstanceRef, InstanceScope, withCurrentInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Question } = await import("@/question")
const { QuestionHttpApi } = await import("@/server/httpapi/question")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-question-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function makeHandler(memoMap: Layer.MemoMap) {
  return HttpRouter.toWebHandler(
    QuestionHttpApi.layer.pipe(
      Layer.provide(Layer.mergeAll(BunHttpServer.layerHttpServices, BunFileSystem.layer, BunPath.layer)),
    ),
    { memoMap },
  )
}

describe("Question HttpApi", () => {
  it("lists, replies, and rejects question requests through the Effect HttpApi handler", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const memoMap = Effect.runSync(Layer.makeMemoMap)
          const questionRuntime = ManagedRuntime.make(Question.defaultLayer, { memoMap })
          const { handler, dispose } = makeHandler(memoMap)
          const httpContext = Context.make(InstanceRef, {
            directory,
            worktree: directory,
            project: Instance.project,
          }) as Context.Context<any>
          const handle = (request: Request) => handler(request, httpContext)
          const first = questionRuntime.runFork(
            withCurrentInstance(
              Effect.gen(function* () {
                const question = yield* Question.Service
                return yield* question.ask({
                  sessionID: "session-httpapi-question-reply",
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
          await Promise.resolve()

          const listResponse = await handle(new Request("http://nikcli.local/question"))
          expect(listResponse.status).toBe(200)
          const pending = (await listResponse.json()) as Array<{ id: string }>
          expect(pending).toHaveLength(1)

          const replyResponse = await handle(
            new Request(`http://nikcli.local/question/${pending[0].id}/reply`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ answers: [["Yes"]] }),
            }),
          )
          expect(replyResponse.status).toBe(200)
          expect(await replyResponse.json()).toBe(true)
          const answers = await questionRuntime.runPromise(Fiber.join(first))

          const second = questionRuntime.runFork(
            withCurrentInstance(
              Effect.gen(function* () {
                const question = yield* Question.Service
                return yield* question.ask({
                  sessionID: "session-httpapi-question-reject",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Stop?",
                      options: [{ label: "No", description: "Stop" }],
                    },
                  ],
                })
              }),
            ),
          )
          await Promise.resolve()
          const pendingAfterReply = (await handle(new Request("http://nikcli.local/question")).then((response) =>
            response.json(),
          )) as Array<{ id: string }>
          expect(pendingAfterReply).toHaveLength(1)

          const rejectResponse = await handle(
            new Request(`http://nikcli.local/question/${pendingAfterReply[0].id}/reject`, {
              method: "POST",
            }),
          )
          expect(rejectResponse.status).toBe(200)
          expect(await rejectResponse.json()).toBe(true)
          const rejected = await questionRuntime.runPromiseExit(Fiber.join(second))
          await dispose()
          await questionRuntime.dispose()
          return { answers, rejected }
        }),
      ),
    )

    expect(result.answers).toEqual([["Yes"]])
    expect(result.rejected._tag).toBe("Failure")
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
