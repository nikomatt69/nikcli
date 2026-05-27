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
  items?: Array<Delegation.ListItem | Delegation.JobItem>
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
      return {
        title: "Delegation access denied",
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
        },
        output: "Delegation management is scoped to the current session only.",
      }
    }

    if (params.action === "list") {
      const items = await Delegation.listJobs(parentSessionID)
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
                ...items.map((item) => `- ${item.rootDelegationID} [${item.status}] @${item.agent} ${item.title}`),
              ].join("\n"),
      }
    }

    if (params.action === "count") {
      const count = (await Delegation.listJobs(parentSessionID)).filter(
        (item) => item.status === "running" || item.status === "synthesizing",
      ).length
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
      return {
        title: "Delegation ID required",
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
        },
        output: `Provide \`delegationId\` for action \`${params.action}\`.`,
      }
    }

    const job = await Delegation.inspectJobForSession(parentSessionID, params.delegationId)
    if (!job) {
      return {
        title: "Delegation not found",
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
          delegationId: params.delegationId,
        },
        output: `Delegation "${params.delegationId}" does not belong to the current session.`,
      }
    }

    await ctx.ask({
      permission: "task",
      patterns: [job.agent],
      always: [job.agent],
      metadata: {
        action: params.action,
        delegationId: params.delegationId,
        agent: job.agent,
      },
    })

    if (params.action === "read") {
      const output = await Delegation.readJobForSession(parentSessionID, params.delegationId)
      return {
        title: `Delegation ${params.delegationId}`,
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
          delegationId: params.delegationId,
        },
        output: output ?? `Delegation "${params.delegationId}" is not available in this session.`,
      }
    }

    const cancelled = await Delegation.cancelJobForSession(parentSessionID, params.delegationId)
    if (!cancelled) {
      return {
        title: "Delegation not running",
        metadata: {
          action: params.action,
          parentSessionId: parentSessionID,
          delegationId: params.delegationId,
          cancelled: false,
        },
        output: `Delegation "${params.delegationId}" is not running or cannot be cancelled from this session.`,
      }
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
