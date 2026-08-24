import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-todo-codec-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { Tool } = await import("@/tool/tool")
const { TodoReadTool, TodoWriteTool } = await import("@/tool/todo")
const { makeToolContext } = await import("../helpers/tool-context")

const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-todo-codec-project-"))

const todos = [
  { id: "1", content: "write the codec", status: "in_progress", priority: "high" },
  { id: "2", content: "run the tests", status: "pending", priority: "medium" },
]

afterAll(async () => {
  await Instance.disposeAll()
  await removeTestDir(projectDir)
  await removeTestDir(testHome)
})

/**
 * T3: tools that already emit JSON declare a codec and return `value`, while the
 * model-facing `output` stays the same string. The todo tools are the clean
 * case — the schema is `Todo.InfoSchema`, which this repo owns, so the codec
 * cannot drift away from a payload produced elsewhere.
 */
describe("todo tools — output codec", () => {
  it("returns the validated list as `value` and the same string as `output`", async () => {
    const { ctx } = makeToolContext({ sessionID: `todo-codec-${Date.now()}` })

    const result = await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const def = await TodoWriteTool.init()
        expect(def.output).toBeDefined()
        return def.executeAsync({ todos }, ctx)
      },
    })

    // The model still sees the JSON string it always saw: a codec must not
    // change what reaches the provider.
    expect(result.output).toBe(JSON.stringify(todos, null, 2))
    expect(result.value).toEqual(todos)
    expect(result.title).toBe("2 todos")
  })

  it("hands Code Mode the array instead of the string", async () => {
    const { ctx } = makeToolContext({ sessionID: `todo-codec-encoded-${Date.now()}` })

    const encoded = await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const def = await TodoWriteTool.init()
        const result = await def.executeAsync({ todos }, ctx)
        return Tool.encoded(result, def.output)
      },
    })

    // The whole point of T3: a machine consumer stops re-parsing JSON that the
    // tool already had in hand.
    expect(encoded).toEqual(todos)
    expect(typeof encoded).not.toBe("string")
  })

  it("reads back the same shape it wrote", async () => {
    const sessionID = `todo-codec-roundtrip-${Date.now()}`
    const { ctx } = makeToolContext({ sessionID })

    const read = await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const write = await TodoWriteTool.init()
        await write.executeAsync({ todos }, ctx)
        const def = await TodoReadTool.init()
        return def.executeAsync({}, ctx)
      },
    })

    expect(read.value).toEqual(todos)
    expect(read.output).toBe(JSON.stringify(todos, null, 2))
  })

  it("gives Code Mode a typed signature instead of `unknown`", async () => {
    const z = (await import("zod")).default
    const { Tool: ConfinedTool } = await import("@/codemode")
    const { outputTypeScript } = await import("@/codemode/tool-schema")

    const def = await TodoWriteTool.init()
    const confined = ConfinedTool.make({
      description: "todo",
      input: z.toJSONSchema(def.parameters, { io: "input" }) as never,
      output: z.toJSONSchema(def.output!, { io: "output" }) as never,
      run: () => Effect.succeed(null),
    })

    // Without a codec this reads `unknown`, and `code_mode.ts` renders the
    // signature behind a try/catch that would quietly fall back to a bare
    // object — so asserting the field is what proves the schema survived the
    // round trip through JSON Schema.
    const rendered = outputTypeScript(confined, true)
    expect(rendered).toStartWith("Array<")
    expect(rendered).toContain("priority: string")
  })

  it("fails only that call when the success does not satisfy the codec", async () => {
    const { ctx } = makeToolContext({ sessionID: `todo-codec-invalid-${Date.now()}` })
    const { Tool: ToolNs } = await import("@/tool/tool")

    // Same codec, a body that lies about its result: the wrapper has to reject
    // it rather than let a malformed value reach a typed consumer.
    const broken = ToolNs.define("todowrite_broken", {
      description: "x",
      parameters: (await TodoWriteTool.init()).parameters,
      output: (await TodoWriteTool.init()).output,
      async execute() {
        return { title: "x", output: "[]", metadata: {}, value: [{ id: 1 }] }
      },
    })

    const def = await broken.init()
    await expect(def.executeAsync({ todos }, ctx)).rejects.toThrow(/invalid output/i)
  })
})
