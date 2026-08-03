import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-question-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { InstanceScope, runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
const { Bus } = await import("@/bus")
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

  it("joins concurrent asks with the same explicit id", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const events: string[] = []
          let markAsked = () => {}
          const asked = new Promise<void>((resolve) => (markAsked = resolve))
          const unsubscribe = Bus.subscribeAll((event) => {
            if (!event.type.startsWith("question.")) return
            events.push(event.type)
            if (event.type === Question.Event.Asked.type) markAsked()
          })
          const firstInput = {
            id: "que_shared_question",
            sessionID: "session-question-joined-test",
            ignored: "first value",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          const equivalentInput = structuredClone(firstInput)
          equivalentInput.ignored = "second value"
          const first = yield* Effect.forkChild(service.ask(firstInput))
          yield* Effect.promise(() => asked)
          firstInput.questions[0]!.question = "Mutated after asking"
          const second = yield* Effect.forkChild(service.ask(equivalentInput))
          yield* Effect.yieldNow
          yield* Effect.yieldNow

          const pending = yield* service.list()
          expect(pending).toHaveLength(1)
          expect(pending[0]).toEqual({
            id: equivalentInput.id,
            sessionID: equivalentInput.sessionID,
            questions: equivalentInput.questions,
          })
          expect(events).toEqual([Question.Event.Asked.type])

          yield* service.reply({
            requestID: equivalentInput.id,
            answers: [["Yes"]],
          })
          const answers = [yield* Fiber.join(first), yield* Fiber.join(second)]
          unsubscribe()
          return { answers, events }
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )

    expect(result.answers).toEqual([[["Yes"]], [["Yes"]]])
    expect(result.events).toEqual([Question.Event.Asked.type, Question.Event.Replied.type])
  })

  it("rejects conflicting asks with the same explicit id", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const events: string[] = []
          let markAsked = () => {}
          const asked = new Promise<void>((resolve) => (markAsked = resolve))
          const unsubscribe = Bus.subscribeAll((event) => {
            if (!event.type.startsWith("question.")) return
            events.push(event.type)
            if (event.type === Question.Event.Asked.type) markAsked()
          })
          const input = {
            id: "que_conflicting_question",
            sessionID: "session-question-conflict-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          const first = yield* Effect.forkChild(service.ask(input))
          yield* Effect.promise(() => asked)

          const error = yield* service
            .ask({
              ...input,
              questions: [{ ...input.questions[0]!, question: "Stop?" }],
            })
            .pipe(Effect.flip)
          expect(error).toEqual(new Question.AlreadyExistsError({ id: input.id! }))
          expect(yield* service.list()).toHaveLength(1)

          yield* service.reject(input.id!)
          expect(yield* Fiber.join(first).pipe(Effect.flip)).toEqual(new Question.RejectedError({}))
          unsubscribe()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("keeps a joined question pending when one asker is interrupted", async () => {
    const directory = await makeProjectDir()
    const answer = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const events: string[] = []
          let markAsked = () => {}
          const asked = new Promise<void>((resolve) => (markAsked = resolve))
          const unsubscribe = Bus.subscribeAll((event) => {
            if (!event.type.startsWith("question.")) return
            events.push(event.type)
            if (event.type === Question.Event.Asked.type) markAsked()
          })
          const input = {
            id: "que_independent_waiters",
            sessionID: "session-question-interrupt-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          const first = yield* Effect.forkChild(service.ask(input))
          yield* Effect.promise(() => asked)
          const second = yield* Effect.forkChild(service.ask(structuredClone(input)))
          yield* Effect.yieldNow
          yield* Effect.yieldNow

          yield* Fiber.interrupt(first)
          expect(yield* service.list()).toHaveLength(1)
          expect(events).toEqual([Question.Event.Asked.type])

          yield* service.reply({ requestID: input.id!, answers: [["Yes"]] })
          const answer = yield* Fiber.join(second)
          unsubscribe()
          return { answer, events }
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )

    expect(answer.answer).toEqual([["Yes"]])
    expect(answer.events).toEqual([Question.Event.Asked.type, Question.Event.Replied.type])
  })

  it("settles waiters when reply publication is interrupted", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const input = {
            id: "que_interrupted_settlement",
            sessionID: "session-question-interrupted-settlement-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          let releasePublish = () => {}
          let markPublishing = () => {}
          const publishing = new Promise<void>((resolve) => (markPublishing = resolve))
          const held = new Promise<void>((resolve) => (releasePublish = resolve))
          const unsubscribe = Bus.subscribe(Question.Event.Replied, async (event) => {
            if (event.properties.requestID !== input.id) return
            markPublishing()
            await held
          })

          const asker = yield* Effect.forkChild(service.ask(input))
          yield* Effect.yieldNow
          const reply = yield* Effect.forkChild(service.reply({ requestID: input.id, answers: [["Yes"]] }))
          yield* Effect.promise(() => publishing)

          yield* Fiber.interrupt(reply)
          expect(yield* service.list()).toEqual([])
          releasePublish()
          expect(yield* Fiber.join(asker)).toEqual([["Yes"]])
          unsubscribe()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("settles waiters when rejection publication is interrupted", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const input = {
            id: "que_interrupted_rejection",
            sessionID: "session-question-interrupted-rejection-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          let releasePublish = () => {}
          let markPublishing = () => {}
          const publishing = new Promise<void>((resolve) => (markPublishing = resolve))
          const held = new Promise<void>((resolve) => (releasePublish = resolve))
          const unsubscribe = Bus.subscribe(Question.Event.Rejected, async (event) => {
            if (event.properties.requestID !== input.id) return
            markPublishing()
            await held
          })

          const asker = yield* Effect.forkChild(service.ask(input))
          yield* Effect.yieldNow
          const rejection = yield* Effect.forkChild(service.reject(input.id))
          yield* Effect.promise(() => publishing)

          yield* Fiber.interrupt(rejection)
          expect(yield* Fiber.join(asker).pipe(Effect.flip)).toEqual(new Question.RejectedError({}))
          expect(yield* service.list()).toEqual([])
          releasePublish()
          unsubscribe()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("cleans up last-waiter cancellation without waiting for subscribers", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const input = {
            id: "que_cancelled_last_waiter",
            sessionID: "session-question-cancelled-last-waiter-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          let releasePublish = () => {}
          let markPublishing = () => {}
          const publishing = new Promise<void>((resolve) => (markPublishing = resolve))
          const held = new Promise<void>((resolve) => (releasePublish = resolve))
          const unsubscribe = Bus.subscribe(Question.Event.Rejected, async (event) => {
            if (event.properties.requestID !== input.id) return
            markPublishing()
            await held
          })

          const asker = yield* Effect.forkChild(service.ask(input))
          yield* Effect.yieldNow
          yield* Fiber.interrupt(asker)

          expect(yield* service.list()).toEqual([])
          yield* Effect.promise(() => publishing)
          releasePublish()
          unsubscribe()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("ignores duplicate settlement while the first settlement publishes", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const input = {
            id: "que_duplicate_settlement",
            sessionID: "session-question-duplicate-settlement-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          let replied = 0
          let rejected = 0
          let releasePublish = () => {}
          let markPublishing = () => {}
          const publishing = new Promise<void>((resolve) => (markPublishing = resolve))
          const held = new Promise<void>((resolve) => (releasePublish = resolve))
          const unsubscribeReply = Bus.subscribe(Question.Event.Replied, async (event) => {
            if (event.properties.requestID !== input.id) return
            replied++
            markPublishing()
            await held
          })
          const unsubscribeReject = Bus.subscribe(Question.Event.Rejected, (event) => {
            if (event.properties.requestID === input.id) rejected++
          })

          const asker = yield* Effect.forkChild(service.ask(input))
          yield* Effect.yieldNow
          const first = yield* Effect.forkChild(service.reply({ requestID: input.id, answers: [["Yes"]] }))
          yield* Effect.promise(() => publishing)

          yield* service.reject(input.id)
          yield* service.reply({ requestID: input.id, answers: [["No"]] })
          expect(replied).toBe(1)
          expect(rejected).toBe(0)

          releasePublish()
          yield* Fiber.join(first)
          expect(yield* Fiber.join(asker)).toEqual([["Yes"]])
          unsubscribeReply()
          unsubscribeReject()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("reserves an explicit id until the terminal event is published", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const input = {
            id: "que_settling_question",
            sessionID: "session-question-settling-test",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          }
          let releasePublish = () => {}
          let markPublishing = () => {}
          const publishing = new Promise<void>((resolve) => {
            markPublishing = resolve
          })
          const held = new Promise<void>((resolve) => {
            releasePublish = resolve
          })
          const unsubscribe = Bus.subscribe(Question.Event.Replied, async (event) => {
            if (event.properties.requestID !== input.id) return
            markPublishing()
            await held
          })

          const asker = yield* Effect.forkChild(service.ask(input))
          yield* Effect.yieldNow
          const reply = yield* Effect.forkChild(service.reply({ requestID: input.id, answers: [["Yes"]] }))
          yield* Effect.promise(() => publishing)

          expect(yield* service.ask(input).pipe(Effect.flip)).toEqual(new Question.AlreadyExistsError({ id: input.id }))

          releasePublish()
          yield* Fiber.join(reply)
          expect(yield* Fiber.join(asker)).toEqual([["Yes"]])
          unsubscribe()
        }).pipe(Effect.provide(Question.defaultLayer)),
      ),
    )
  })

  it("rejects malformed explicit ids without creating pending state", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const service = yield* Question.Service
          const id = "question_without_que_prefix"
          const error = yield* service
            .ask({
              id,
              sessionID: "session-question-invalid-id-test",
              questions: [
                {
                  header: "Confirm",
                  question: "Continue?",
                  options: [{ label: "Yes", description: "Continue" }],
                },
              ],
            })
            .pipe(Effect.flip)

          expect(error).toEqual(new Question.InvalidIDError({ id }))
          expect(yield* service.list()).toEqual([])
        }).pipe(Effect.provide(Question.defaultLayer)),
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
