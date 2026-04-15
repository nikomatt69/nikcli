import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./delegator.txt"
import { Delegation } from "@/delegation/manager"

const parameters = z.object({
  delegationId: z.string().describe("The delegation ID to monitor"),
  action: z.enum(["status", "summarize", "progress"]).describe("Action to perform on the delegation"),
})

type DelegatorMetadata = {
  delegationId: string
  delegatorId?: string
  action: string
  result?: string
}

export const DelegatorTool = Tool.define<typeof parameters, DelegatorMetadata>("delegator", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute({ delegationId, action }, ctx) {
      const delegation = await Delegation.inspectForSession(ctx.sessionID, delegationId)

      if (!delegation) {
        return {
          title: "Delegator (not found)",
          output: `Delegation "${delegationId}" not found or is not accessible from this session.`,
          metadata: {
            delegationId,
            action,
          },
        }
      }

      switch (action) {
        case "status": {
          const isRunning = delegation.status === "running"

          return {
            title: `Delegator · ${delegation.status}`,
            output: [
              `**Delegation ID:** ${delegationId}`,
              `**Status:** ${delegation.status}`,
              `**Agent:** ${delegation.agent}`,
              `**Session:** ${delegation.sessionID || "N/A"}`,
              `**Started:** ${new Date(delegation.createdAt).toISOString()}`,
              isRunning
                ? `**Completed:** Still running...`
                : `**Completed:** ${delegation.completedAt ? new Date(delegation.completedAt).toISOString() : "N/A"}`,
              `**Last Activity:** ${delegation.lastActivityAt ? new Date(delegation.lastActivityAt).toISOString() : "N/A"}`,
              delegation.progressSummary ? `**Progress:** ${delegation.progressSummary}` : "",
              "",
              isRunning
                ? 'The delegation is still running in the background. Use `delegation(action="read", delegationId="' +
                  delegationId +
                  '")` to see current progress.'
                : 'The delegation has completed. Use `delegation(action="read", delegationId="' +
                  delegationId +
                  '")` to see the full result.',
            ].join("\n"),
            metadata: {
              delegationId,
              action,
            },
          }
        }

        case "progress": {
          const progress = Delegation.outputPreview({
            status: delegation.status,
            progressSummary: delegation.progressSummary,
            resultSummary: delegation.resultSummary,
          })

          if (!progress) {
            return {
              title: "Delegator · Progress",
              output: "The delegation is still running or no progress has been recorded yet. Check back shortly.",
              metadata: {
                delegationId,
                action,
              },
            }
          }

          const preview = progress.slice(0, 500)
          const truncated = progress.length > 500

          return {
            title: "Delegator · Progress",
            output:
              (truncated ? "[Progress preview - first 500 chars]\n\n" : "[Progress]\n\n") +
              preview +
              (truncated ? '\n\n... (truncated, use `delegation(action="read")` for full result)' : ""),
            metadata: {
              delegationId,
              action,
              result: truncated ? "(truncated)" : progress,
            },
          }
        }

        case "summarize": {
          const summarySource = delegation.resultSummary ?? delegation.progressSummary

          if (!summarySource) {
            return {
              title: "Delegator · Summary",
              output:
                delegation.status === "running"
                  ? "The delegation is still running. No summary is available yet."
                  : `The delegation ended with status: ${delegation.status}. No summary is available.`,
              metadata: {
                delegationId,
                action,
              },
            }
          }

          const summary = `**Task:** ${delegation.title}
**Agent:** ${delegation.agent}
**Status:** ${delegation.status}

**Summary:**
${summarySource.slice(0, 800)}${summarySource.length > 800 ? "\n\n...(truncated)" : ""}

---
Use \`delegation(action=\"read\", delegationId=\"${delegationId}\")\` for full result.`

          return {
            title: "Delegator · Summary",
            output: summary,
            metadata: {
              delegationId,
              action,
              result: summarySource.slice(0, 1000),
            },
          }
        }

        default:
          return {
            title: "Delegator (unknown action)",
            output: `Unknown action: ${action}. Use status, summarize, or progress.`,
            metadata: {
              delegationId,
              action,
            },
          }
      }
    },
  }
})
