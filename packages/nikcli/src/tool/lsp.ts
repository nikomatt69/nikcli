import { Schema, Effect } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const Parameters = Schema.Struct({
  operation: Schema.Literal(...operations).annotations({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotations({ description: "The absolute or relative path to the file" }),
  line: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)).annotations({
    description: "The line number (1-based, as shown in editors)",
  }),
  character: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)).annotations({
    description: "The character offset (1-based, as shown in editors)",
  }),
})

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  execute: async (args, ctx) => {
    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const exists = await Bun.file(file).exists()
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        return yield* lsp.hasClients(file)
      }),
    )
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.touchFile(file, true)
      }),
    )

    const result: unknown[] = await (async () => {
      return runLSP(
        Effect.gen(function* () {
          const lsp = yield* LSP.Service
          switch (args.operation) {
            case "goToDefinition":
              return yield* lsp.definition(position)
            case "findReferences":
              return yield* lsp.references(position)
            case "hover":
              return yield* lsp.hover(position)
            case "documentSymbol":
              return yield* lsp.documentSymbol(uri)
            case "workspaceSymbol":
              return yield* lsp.workspaceSymbol("")
            case "goToImplementation":
              return yield* lsp.implementation(position)
            case "prepareCallHierarchy":
              return yield* lsp.prepareCallHierarchy(position)
            case "incomingCalls":
              return yield* lsp.incomingCalls(position)
            case "outgoingCalls":
              return yield* lsp.outgoingCalls(position)
          }
        }),
      )
    })()

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    return {
      title,
      metadata: { result },
      output,
    }
  },
})
