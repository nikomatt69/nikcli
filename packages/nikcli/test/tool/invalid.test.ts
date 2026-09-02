import { afterAll, describe, expect, it } from "bun:test"
import z from "zod"
import { InvalidTool } from "../../src/tool/invalid"
import { Tool } from "../../src/tool/tool"
import { Effect } from "effect"
import { Tool as EffectPluginTool } from "@nikcli-ai/plugin/v2/effect"
import { recordBenchmark, flushBenchmarkRun } from "../benchmarks/runner"

describe("InvalidTool", () => {
  it("rejects args outside schema in parameters.parse", async () => {
    const def = await InvalidTool.init()
    expect(() => def.parameters.parse({ tool: 1, error: "x" } as unknown as z.infer<typeof def.parameters>)).toThrow(
      z.ZodError,
    )
  })

  it("returns formatted error output for a valid call", async () => {
    const def = await InvalidTool.init()
    const result = await def.executeAsync(
      { tool: "read", error: "missing path" },
      {
        // This file stands in no instance scope, and `InvalidTool` never
        // touches the instance — so the field is present for the contract and
        // throws only if something starts reading it.
        get instance(): never {
          throw new Error("InvalidTool must not read the instance")
        },
        sessionID: "ses_test",
        messageID: "msg_test",
        callID: "call_test",
        agent: "build",
        abort: new AbortController().signal,
        metadata() {},
        async progress() {},
        async ask() {},
      },
    )
    expect(result.title).toBe("Invalid Tool")
    expect(result.output).toContain("missing path")
    expect(result.output).toContain("invalid")
  })

  it("forwards progress from Promise and Effect tool implementations", async () => {
    const updates: Tool.Progress[] = []
    const context: Tool.Context = {
      get instance(): never {
        throw new Error("this test must not read the instance")
      },
      sessionID: "ses_progress",
      messageID: "msg_progress",
      callID: "call_progress",
      agent: "build",
      abort: new AbortController().signal,
      metadata() {},
      async progress(update) {
        updates.push(update)
      },
      async ask() {},
    }
    const parameters = z.object({ value: z.string() })
    const promiseTool = Tool.define("promise-progress", {
      description: "Promise progress test",
      parameters,
      async execute(args, ctx) {
        await ctx.progress({ structured: { phase: args.value } })
        return { title: "", metadata: {}, output: args.value }
      },
    })
    const effectTool = Tool.define("effect-progress", {
      description: "Effect progress test",
      parameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            ctx.progress({
              structured: { phase: args.value },
              content: [{ type: "text", text: "working" }],
            }),
          )
          return { title: "", metadata: {}, output: args.value }
        }),
    })

    await (await promiseTool.init()).executeAsync({ value: "promise" }, context)
    await (await effectTool.init()).executeAsync({ value: "effect" }, context)

    expect(updates).toEqual([
      { structured: { phase: "promise" } },
      { structured: { phase: "effect" }, content: [{ type: "text", text: "working" }] },
    ])
  })

  it("adapts Effect plugin progress to the Promise plugin host contract", async () => {
    const updates: Tool.Progress[] = []
    const definition = EffectPluginTool.tool({
      description: "Effect plugin progress test",
      args: { value: z.string() },
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* ctx.progress({ structured: { value: args.value } })
          return args.value
        }),
    })

    const result = await definition.execute(
      { value: "ready" },
      {
        sessionID: "ses_plugin_progress",
        messageID: "msg_plugin_progress",
        callID: "call_plugin_progress",
        agent: "build",
        abort: new AbortController().signal,
        metadata() {},
        async progress(update) {
          updates.push(update)
        },
        async ask() {},
      },
    )

    expect(result).toBe("ready")
    expect(updates).toEqual([{ structured: { value: "ready" } }])
  })
})

describe("InvalidTool zod path benchmark", () => {
  it("records parameters.safeParse in a loop", async () => {
    const def = await InvalidTool.init()
    const iterations = 20_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      def.parameters.safeParse({ tool: "grep", error: i % 2 === 0 ? "a" : "b" })
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "tool",
      module: "invalid",
      scenario: "parameters.safeParse loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => {
  return flushBenchmarkRun()
})
