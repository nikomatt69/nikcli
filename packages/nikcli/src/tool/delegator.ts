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
      const delegation = await Delegation.read(delegationId).catch(() => null)

      if (!delegation) {
        return {
          title: "Delegator (not found)",
          output: `Delegation "${delegationId}" not found or has been cleaned up.`,
          metadata: {
            delegationId,
            action,
          },
        }
      }

      switch (action) {
        case "status": {
          const statusMatch = delegation.match(/\*\*Status:\*\* (.+)$/m)
          const agentMatch = delegation.match(/\*\*Agent:\*\* (.+)$/m)
          const sessionMatch = delegation.match(/\*\*Session:\*\* (.+)$/m)
          const startedMatch = delegation.match(/\*\*Started:\*\* (.+)$/m)
          const completedMatch = delegation.match(/\*\*Completed:\*\* (.+)$/m)

          const status = statusMatch?.[1]?.trim() || "unknown"
          const isRunning = status === "running"

          return {
            title: `Delegator · ${status}`,
            output: [
              `**Delegation ID:** ${delegationId}`,
              `**Status:** ${status}`,
              `**Agent:** ${agentMatch?.[1]?.trim() || "unknown"}`,
              `**Session:** ${sessionMatch?.[1]?.trim() || "N/A"}`,
              `**Started:** ${startedMatch?.[1]?.trim() || "unknown"}`,
              isRunning ? `**Completed:** Still running...` : `**Completed:** ${completedMatch?.[1]?.trim() || "N/A"}`,
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
          // Extract the result section from the artifact
          const lines = delegation.split("\n---\n")
          const resultSection = lines.slice(1).join("\n---\n").trim()

          if (!resultSection) {
            return {
              title: "Delegator · Progress",
              output: "The delegation is still running or no progress has been recorded yet. Check back shortly.",
              metadata: {
                delegationId,
                action,
              },
            }
          }

          // Get first 500 chars of result for progress preview
          const progress = resultSection.slice(0, 500)
          const truncated = resultSection.length > 500

          return {
            title: "Delegator · Progress",
            output:
              (truncated ? "[Progress preview - first 500 chars]\n\n" : "[Progress]\n\n") +
              progress +
              (truncated ? '\n\n... (truncated, use `delegation(action="read")` for full result)' : ""),
            metadata: {
              delegationId,
              action,
              result: truncated ? "(truncated)" : resultSection,
            },
          }
        }

        case "summarize": {
          // For completed delegations, generate a brief summary
          const statusMatch = delegation.match(/\*\*Status:\*\* (.+)$/m)
          const status = statusMatch?.[1]?.trim()

          if (status !== "complete") {
            return {
              title: "Delegator · Summary",
              output:
                status === "running"
                  ? "The delegation is still running. Unable to provide summary until complete."
                  : `The delegation ended with status: ${status || "unknown"}. No summary available.`,
              metadata: {
                delegationId,
                action,
              },
            }
          }

          const lines = delegation.split("\n---\n")
          const resultSection = lines.slice(1).join("\n---\n").trim()

          if (!resultSection) {
            return {
              title: "Delegator · Summary",
              output: "The delegation completed but produced no output.",
              metadata: {
                delegationId,
                action,
              },
            }
          }

          // Extract task info from header
          const agentMatch = delegation.match(/\*\*Agent:\*\* (.+)$/m)
          const titleMatch = delegation.match(/^# .+? (.+)$/m)
          const agent = agentMatch?.[1]?.trim() || "unknown"
          const title = titleMatch?.[1]?.trim() || delegationId

          // Create a quick summary without calling the model
          const summary = `**Task:** ${title}
**Agent:** ${agent}
**Status:** ✓ Complete

**Summary:**
${resultSection.slice(0, 800)}${resultSection.length > 800 ? "\n\n...(truncated)" : ""}

---
Use \`delegation(action=\"read\", delegationId=\"${delegationId}\")\` for full result.`

          return {
            title: "Delegator · Summary",
            output: summary,
            metadata: {
              delegationId,
              action,
              result: resultSection.slice(0, 1000),
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
