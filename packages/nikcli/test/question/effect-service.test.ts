import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-question-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { InstanceScope, runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Question } = await import("@/question")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-question-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Question.Service", () => {
  it("tracks pending questions and resolves replies in an instance scope", async () => {
    const directory = await makeProjectDir()
    const answers = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const fiber = yield* Effect.forkChild(
            service.ask({
              sessionID: "session-question-test",
              questions: [
                {
                  header: "Confirm",
                  question: "Continue?",
                  options: [{ label: "Yes", description: "Continue" }],
                },
              ],
            }),
          )
          yield* Effect.yieldNow
          const pending = yield* service.list()
          expect(pending).toHaveLength(1)
          yield* service.reply({
            requestID: pending[0].id,
            answers: [["Yes"]],
          })
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )

    expect(answers).toEqual([["Yes"]])
  })

  it("shares pending state through the shared layer runtime", async () => {
    const directory = await makeProjectDir()
    const answers = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const question = runPromiseWithLayer(
            Question.defaultLayer,
            withCurrentInstance(
              Effect.gen(function* () {
                const service = yield* Question.Service
                return yield* service.ask({
                  sessionID: "session-question-runtime-test",
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
          const pending = await runPromiseWithLayer(
            Question.defaultLayer,
            withCurrentInstance(
              Effect.gen(function* () {
                const service = yield* Question.Service
                return yield* service.list()
              }),
            ),
          )
          expect(pending).toHaveLength(1)
          await runPromiseWithLayer(
            Question.defaultLayer,
            withCurrentInstance(
              Effect.gen(function* () {
                const service = yield* Question.Service
                yield* service.reply({
                  requestID: pending[0].id,
                  answers: [["Yes"]],
                })
              }),
            ),
          )

          return question
        }),
      ),
    )

    expect(answers).toEqual([["Yes"]])
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
