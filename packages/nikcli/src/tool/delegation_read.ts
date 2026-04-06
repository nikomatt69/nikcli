import { Tool } from "./tool"
import z from "zod"
import { Delegation } from "@/delegation/manager"

const parameters = z.object({
  id: z.string().describe("The delegation ID (e.g., 'elegant-blue-tiger')"),
})

export const DelegationReadTool = Tool.define("delegation_read", {
  description: `Read the output of a background delegation by its ID.

Use this to retrieve results from delegated tasks if the inline notification was lost during compaction.
The delegation must have completed (status: complete, error, or timeout).`,
  parameters,
  async execute(params: z.infer<typeof parameters>) {
    try {
      const result = await Delegation.read(params.id)
      return { title: `Delegation ${params.id}`, metadata: { id: params.id }, output: result }
    } catch (error) {
      return {
        title: "Error",
        metadata: { id: params.id },
        output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    }
  },
})
