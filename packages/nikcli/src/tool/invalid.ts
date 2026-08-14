import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Tool } from "./tool"

const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

export const InvalidTool = Tool.define("invalid", {
  description: "Do not use",
  parameters: zod(Parameters),
  async execute(params) {
    return {
      title: "Invalid Tool",
      output: `The arguments provided to the tool are invalid: ${params.error}`,
      metadata: {},
    }
  },
})
