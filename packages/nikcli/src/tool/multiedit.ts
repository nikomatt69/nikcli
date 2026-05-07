import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

const Parameters = Schema.Struct({
  filePath: Schema.String.annotations({ description: "The absolute path to the file to modify" }),
  edits: Schema.Array(
    Schema.Struct({
      filePath: Schema.String.annotations({ description: "The absolute path to the file to modify" }),
      oldString: Schema.String.annotations({ description: "The text to replace" }),
      newString: Schema.String.annotations({
        description: "The text to replace it with (must be different from oldString)",
      }),
      replaceAll: Schema.optional(Schema.Boolean).annotations({
        description: "Replace all occurrences of oldString (default false)",
      }),
    }),
  ).annotations({ description: "Array of edit operations to perform sequentially on the file" }),
})

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    const tool = await EditTool.init()
    const results = []
    for (const [, edit] of params.edits.entries()) {
      const result = await tool.executeAsync(
        {
          filePath: params.filePath,
          oldString: edit.oldString,
          newString: edit.newString,
          replaceAll: edit.replaceAll,
        },
        ctx,
      )
      results.push(result)
    }
    return {
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        results: results.map((r) => r.metadata),
      },
      output: results.at(-1)!.output,
    }
  },
})
