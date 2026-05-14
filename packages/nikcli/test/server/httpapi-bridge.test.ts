import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-bridge-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

const { runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { InstanceBootstrap } = await import("@/project/bootstrap")
const { PermissionNext } = await import("@/permission/next")
const { Question } = await import("@/question")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-bridge-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url, init))
}

async function waitForList<T>(pathname: string, directory: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await request(pathname, directory)
    expect(response.status).toBe(200)
    const pending = (await response.json()) as T[]
    if (pending.length > 0) return pending
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return [] as T[]
}

describe("HttpApi bridge", () => {
  it("serves implemented question and permission routes behind NIKCLI_EXPERIMENTAL_HTTPAPI", async () => {
    const directory = await makeProjectDir()

    const questionFiber = await Instance.provide({
      directory,
      init: InstanceBootstrap,
      fn: async () =>
        runPromiseWithLayer(
          Question.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const question = yield* Question.Service
              return yield* Effect.forkDetach(
                question.ask({
                  sessionID: "session-httpapi-bridge-question",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [{ label: "Yes", description: "Continue" }],
                    },
                  ],
                }),
              )
            }),
          ),
        ),
    })

    const permissionFiber = await Instance.provide({
      directory,
      init: InstanceBootstrap,
      fn: async () =>
        runPromiseWithLayer(
          PermissionNext.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const permission = yield* PermissionNext.Service
              return yield* Effect.forkDetach(
                permission.ask({
                  permission: "edit",
                  patterns: ["src/index.ts"],
                  sessionID: "session-httpapi-bridge-permission",
                  metadata: { tool: "edit" },
                  always: ["src/index.ts"],
                  ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
                }),
              )
            }),
          ),
        ),
    })

    const questions = await waitForList<{ id: string }>("/question", directory)
    expect(questions).toHaveLength(1)

    const permissions = await waitForList<{ id: string }>("/permission", directory)
    expect(permissions).toHaveLength(1)

    const questionReply = await request(`/question/${questions[0].id}/reply`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [["Yes"]] }),
    })
    expect(questionReply.status).toBe(200)

    const permissionReply = await request(`/permission/${permissions[0].id}/reply`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply: "once" }),
    })
    expect(permissionReply.status).toBe(200)

    const answers = await runPromiseWithLayer(Question.defaultLayer, Fiber.join(questionFiber))
    expect(answers).toEqual([["Yes"]])
    await runPromiseWithLayer(PermissionNext.defaultLayer, Fiber.join(permissionFiber))
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
