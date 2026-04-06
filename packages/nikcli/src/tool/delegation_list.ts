import { Tool } from "./tool"
import z from "zod"
import { Delegation } from "@/delegation/manager"

export const DelegationListTool = Tool.define("delegation_list", {
  description: `List all delegations for the current session.
Shows both running and completed delegations with their titles, agents, and status.`,
  parameters: z.object({}),
  async execute(_, ctx) {
    try {
      const delegations = await Delegation.list(ctx.sessionID)

      if (delegations.length === 0) {
        return { title: "No delegations", metadata: { count: 0 }, output: "No delegations found for this session." }
      }

      const lines = delegations.map((d) => {
        const statusIcon =
          d.status === "complete" ? "✓" : d.status === "running" ? "●" : d.status === "error" ? "✗" : "○"
        const unreadPart = d.status === "running" ? " [running]" : ""
        return `- **${d.id}** [${statusIcon} ${d.status}]${unreadPart}\n  Agent: ${d.agent}\n  ${d.title}`
      })

      return {
        title: `${delegations.length} delegation(s)`,
        metadata: { count: delegations.length },
        output: `Delegations:\n\n${lines.join("\n")}`,
      }
    } catch (error) {
      return {
        title: "Error",
        metadata: { count: 0 },
        output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    }
  },
})
