import z from "zod"
import { Tool } from "./tool"
import { Delegation } from "@/delegation/manager"
import DESCRIPTION from "./delegation.txt"

const parameters = z.object({
  action: z.enum(["list", "read", "cancel", "count"]),
  delegationId: z.string().optional().describe("Delegation ID for read/cancel actions"),
  parentSessionId: z.string().optional().describe("Parent session to inspect; defaults to the current session"),
})

type DelegationMetadata = {
  action: z.infer<typeof parameters>["action"]
  count?: number
  items?: Delegation.ListItem[]
  parentSessionId: string
  delegationId?: string
  cancelled?: boolean
}

export const DelegationTool = Tool.define<typeof parameters, DelegationMetadata>("delegation", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const parentSessionID = params.parentSessionId ?? ctx.sessionID
    if (parentSessionID !== ctx.sessionID) {
      throw new Error("delegation can only manage background tasks for the current session")
    }

    if (params.action === "list") {
      const items = await Delegation.list(parentSessionID)
      return {
        title: `${items.length} delegations`,
        metadata: {
          action: params.action,
          count: items.length,
          items,
          parentSessionId: parentSessionID,
        },
        output:
          items.length === 0
            ? `No delegations found for session ${parentSessionID}.`
            : [
                `Delegations for session ${parentSessionID}:`,
                ...items.map((item) => `- ${item.id} [${item.status}] @${item.agent} ${item.title}`),
              ].join("\n"),
      }
    }

    if (params.action === "count") {
      const count = await Delegation.getRunningCount(parentSessionID)
      return {
        title: `${count} running delegations`,
        metadata: {
          action: params.action,
          count,
          parentSessionId: parentSessionID,
        },
        output: `${count} delegation(s) currently running for session ${parentSessionID}.`,
      }
    }

    if (!params.delegationId) {
      throw new Error(`delegationId is required for action \"${params.action}\"`)
    }

    const items = await Delegation.list(parentSessionID)
    const match = items.find((item) => item.id === params.delegationId)
    if (!match) {
      throw new Error(`Delegation \"${params.delegationId}\" does not belong to the current session.`)
    }

    await ctx.ask({
      permission: "task",
      patterns: [match.agent],
      always: [match.agent],
      metadata: {
        action: params.action,
        delegationId: params.delegationId,
      },
    })

    if (params.action === "read") {
      const output = await Delegation.read(params.delegationId)
      return {
        title: `Delegation ${params.delegationId}`,
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
          delegationId: params.delegationId,
        },
        output,
      }
    }

    const cancelled = await Delegation.cancel(params.delegationId)
    if (!cancelled) {
      throw new Error(`Delegation \"${params.delegationId}\" is not running or does not exist.`)
    }

    return {
      title: `Cancelled ${params.delegationId}`,
      metadata: {
        action: params.action,
        parentSessionId: parentSessionID,
        delegationId: params.delegationId,
        cancelled: true,
      },
      output: `Cancelled delegation ${params.delegationId}.`,
    }
  },
})
