import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./context_diagnostics.txt"
import { LSP } from "@/lsp"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "./external-directory"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect, Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

const ParametersSchema = Schema.Struct({
  filePath: Schema.optional(Schema.String.annotations({ description: "Optional file path to filter diagnostics" })),
  limit: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(200)).annotations({
      description: "Maximum diagnostics per file",
    }),
  ),
})
const parameters = zodObject(ParametersSchema)

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

export const ContextDiagnosticsTool = Tool.define<typeof parameters, { count: number }>("context_diagnostics", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const limit = params.limit ?? 50

    await ctx.ask({
      permission: "context_diagnostics",
      patterns: [params.filePath ?? "*"],
      always: ["*"],
      metadata: {
        filePath: params.filePath,
        limit,
      },
    })

    if (params.filePath) {
      const target = path.isAbsolute(params.filePath)
        ? params.filePath
        : path.resolve(Instance.directory, params.filePath)
      await assertExternalDirectory(ctx, target, { kind: "file" })

      const all = await runLSP(
        Effect.gen(function* () {
          const lsp = yield* LSP.Service
          yield* lsp.touchFile(target, true)
          return yield* lsp.diagnostics()
        }),
      )
      const issues = all[target] ?? []
      if (issues.length === 0) {
        return {
          title: path.relative(Instance.worktree, target),
          output: "No diagnostics found.",
          metadata: { count: 0 },
        }
      }

      const output = issues
        .slice(0, limit)
        .map((item) => LSP.Diagnostic.pretty(item))
        .join("\n")
      return {
        title: path.relative(Instance.worktree, target),
        output,
        metadata: { count: issues.length },
      }
    }

    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        return yield* lsp.diagnostics()
      }),
    )
    const entries = Object.entries(diagnostics).filter(([, issues]) => issues.length > 0)
    if (entries.length === 0) {
      return {
        title: "Diagnostics",
        output: "No diagnostics found.",
        metadata: { count: 0 },
      }
    }

    const lines: string[] = []
    for (const [file, issues] of entries) {
      lines.push(`${file}:`)
      lines.push(...issues.slice(0, limit).map((item) => `  ${LSP.Diagnostic.pretty(item)}`))
      lines.push("")
    }

    return {
      title: "Diagnostics",
      output: lines.join("\n").trim(),
      metadata: { count: entries.length },
    }
  },
})
