import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import z from "zod"
import { CodeMode, Tool as ConfinedTool } from "@/codemode"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncation"
import { makeToolContext } from "../helpers/tool-context"

const CountOutput = z.object({ count: z.number() })

function countTool(execute: Tool.AuthoredDef<z.ZodObject<{}>, Tool.Metadata>["execute"]) {
  return Tool.define("count_items", {
    description: "Return a counted value",
    parameters: z.object({}),
    output: CountOutput,
    execute,
  })
}

describe("tool output schemas", () => {
  it("leaves a tool without an output codec unchanged", async () => {
    const tool = Tool.define("plain", {
      description: "String only",
      parameters: z.object({}),
      async execute() {
        return { title: "plain", output: "hello", metadata: {} }
      },
    })
    const def = await tool.init()
    expect(def.output).toBeUndefined()
    const result = await def.executeAsync({}, makeToolContext().ctx)
    expect(result.output).toBe("hello")
    expect(result.value).toBeUndefined()
    expect(Tool.encoded(result, def.output)).toBe("hello")
  })

  it("validates the encoded value and keeps it off the truncated model-facing string", async () => {
    const huge = "x".repeat(Truncate.MAX_BYTES + 1024)
    const def = await countTool(async () => ({
      title: "count",
      output: huge,
      metadata: {},
      value: { count: 3 },
    })).init()

    expect(def.output).toBe(CountOutput)
    const result = await def.executeAsync({}, makeToolContext().ctx)
    expect(result.value).toEqual({ count: 3 })
    expect(result.output).not.toBe(huge)
    expect(result.output.length).toBeLessThan(huge.length)
    expect(result.metadata.truncated).toBe(true)
    expect(Tool.encoded(result, def.output)).toEqual({ count: 3 })
  })

  it("rejects a malformed success when a codec is declared", async () => {
    const def = await countTool(async () => ({
      title: "count",
      output: "looks fine",
      metadata: {},
      value: { count: "nope" },
    })).init()

    const error = await def.executeAsync({}, makeToolContext().ctx).then(
      () => undefined,
      (cause: unknown) => cause as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain("invalid output")
    expect(error!.message).toContain("count_items")
  })

  it("rejects a missing encoded value when a codec is declared", async () => {
    const def = await countTool(async () => ({
      title: "count",
      output: "looks fine",
      metadata: {},
    })).init()

    const error = await def.executeAsync({}, makeToolContext().ctx).then(
      () => undefined,
      (cause: unknown) => cause as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain("invalid output")
  })

  it("hands Code Mode the encoded value so a program can read fields", async () => {
    const def = await countTool(async () => ({
      title: "count",
      output: "the count is 3, as a story for the model",
      metadata: {},
      value: { count: 3 },
    })).init()
    const { ctx } = makeToolContext()

    const host = ConfinedTool.make({
      description: def.description,
      input: { type: "object" },
      output: z.toJSONSchema(CountOutput, { io: "output" }) as ConfinedTool.JsonSchema,
      run: (input) =>
        def
          .execute((input ?? {}) as z.infer<typeof def.parameters>, ctx)
          .pipe(Effect.map((result) => Tool.encoded(result, def.output))),
    })

    const result = await Effect.runPromise(
      CodeMode.make({ tools: { count_items: host } }).execute(`
        const result = await tools.count_items({})
        return { n: result.count, kind: typeof result }
      `),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ n: 3, kind: "object" })
  })
})
