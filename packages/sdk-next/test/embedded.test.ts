import { afterAll, afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { z } from "zod"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sdk-next-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { Effect } = await import("effect")
const { NikCli, Tool } = await import("../src")
const { Instance } = await import("nikcli-ai/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sdk-next-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

test("embedded client uses the real router and handlers", async () => {
  const directory = await makeProjectDir()
  const program = Effect.gen(function* () {
    const nikcli = yield* NikCli.create({ directory })

    yield* nikcli.tools.register(
      Tool.define("embedded_tool", async () => ({
        description: "Embedded test tool",
        parameters: z.object({}),
        execute: async () => ({ title: "", output: "ok", metadata: {} }),
      })),
    )

    const ids = yield* Effect.promise(() => nikcli.experimental.toolIDs())
    const created = yield* Effect.promise(() => nikcli.session.create({ title: "Embedded session" }))
    const listed = yield* Effect.promise(() => nikcli.session.list())
    const config = yield* Effect.promise(() => nikcli.config.get())

    expect(ids).toContain("embedded_tool")
    expect(ids).toContain("bash")
    expect(created.title).toBe("Embedded session")
    expect(created.directory).toBe(directory)
    expect(listed.some((session) => session.id === created.id)).toBe(true)
    expect(config).toBeDefined()
  })
  await Effect.runPromise(program)
})

test("requests can override the host directory per call", async () => {
  const first = await makeProjectDir()
  const second = await makeProjectDir()
  const program = Effect.gen(function* () {
    const nikcli = yield* NikCli.create({ directory: first })
    const created = yield* Effect.promise(() => nikcli.session.create({ title: "Host session" }))
    const other = yield* Effect.promise(() => nikcli.session.list({ directory: second }))

    expect(created.directory).toBe(first)
    expect(other.some((session) => session.id === created.id)).toBe(false)
  })
  await Effect.runPromise(program)
})

test("registered tools are host-directory scoped", async () => {
  const first = await makeProjectDir()
  const second = await makeProjectDir()
  const program = Effect.gen(function* () {
    const one = yield* NikCli.create({ directory: first })
    const two = yield* NikCli.create({ directory: second })

    yield* one.tools.register(
      Tool.define("scoped_tool", async () => ({
        description: "Scoped test tool",
        parameters: z.object({}),
        execute: async () => ({ title: "", output: "ok", metadata: {} }),
      })),
    )

    const firstIDs = yield* Effect.promise(() => one.experimental.toolIDs())
    const secondIDs = yield* Effect.promise(() => two.experimental.toolIDs())

    expect(firstIDs).toContain("scoped_tool")
    expect(secondIDs).not.toContain("scoped_tool")
  })
  await Effect.runPromise(program)
})

test("embedded client is available as a Layer service", async () => {
  const directory = await makeProjectDir()
  const created = await Effect.runPromise(
    Effect.gen(function* () {
      const nikcli = yield* NikCli.Service
      return yield* Effect.promise(() =>
        nikcli.session.create({ title: "Layer session" }, { headers: { "x-nikcli-directory": directory } }),
      )
    }).pipe(Effect.provide(NikCli.layer)),
  )

  expect(created.title).toBe("Layer session")
  expect(created.directory).toBe(directory)
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
