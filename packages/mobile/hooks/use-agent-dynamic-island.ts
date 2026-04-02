import { useCallback } from "react"
import type { SessionStreamEvent, ToolState } from "@/lib/types"
import { useDynamicIslandForSession, type ApprovalRequest } from "@/components/DynamicIsland"
import { inferAgentType } from "@/lib/live-activity"

interface ToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

function isToolPartRunning(part: { type: string; state: ToolState }): boolean {
  if (part.type !== "tool") return false
  return part.state.status === "running"
}

function isToolPartCompleted(part: { type: string; state: ToolState }): boolean {
  if (part.type !== "tool") return false
  return part.state.status === "completed"
}

function isToolPartError(part: { type: string; state: ToolState }): boolean {
  if (part.type !== "tool") return false
  return part.state.status === "error"
}

function getToolTitle(state: ToolState): string | undefined {
  if (state.status === "completed" && "title" in state) return state.title as string
  if (state.status === "running" && "title" in state) return state.title as string
  return undefined
}

function getToolDuration(state: ToolState): number | undefined {
  if ("time" in state && state.time?.start) {
    return Date.now() - (state.time.start as number)
  }
  return undefined
}

/**
 * Hook integrato con useAgentLiveActivity
 * Usa questo nelle sessioni per sincronizzare sia Live Activities che Dynamic Island
 */
export function useAgentDynamicIsland(sessionId: string | undefined) {
  const island = useDynamicIslandForSession(sessionId)

  const handleStreamEvent = useCallback(
    (event: SessionStreamEvent) => {
      if (!sessionId) return

      const agentType = inferAgentType(
        event as { type: string; properties?: { part?: { type: string; tool?: string } } },
      )

      switch (event.type) {
        case "message.part.updated": {
          const part = event.properties.part as ToolPart | { type: string; synthetic?: boolean; state?: ToolState }

          if (part.type === "tool" && part.state) {
            const toolPart = part as ToolPart
            const toolTitle = getToolTitle(toolPart.state)

            if (isToolPartRunning(toolPart)) {
              island.updateActivity({
                status: "working",
                progressMessage: toolTitle || `Running ${toolPart.tool}...`,
                tool: {
                  name: toolPart.tool || "unknown",
                  status: "running",
                },
              })
            } else if (isToolPartCompleted(toolPart)) {
              island.updateActivity({
                status: "working",
                progressMessage: toolTitle || `${toolPart.tool} done`,
                tool: {
                  name: toolPart.tool || "unknown",
                  status: "completed",
                  duration: getToolDuration(toolPart.state),
                },
              })
            } else if (isToolPartError(toolPart)) {
              island.updateActivity({
                status: "failed",
                progressMessage: `Error in ${toolPart.tool}`,
              })
            }
          } else if (part.type === "reasoning" && event.properties.delta) {
            island.updateActivity({
              status: "thinking",
              progressMessage: "Analyzing request...",
            })
          } else if (part.type === "text" && event.properties.delta) {
            const isReasoning = (part as { synthetic?: boolean }).synthetic
            if (!isReasoning) {
              island.updateActivity({
                status: "thinking",
                progressMessage: "Generating response...",
              })
            }
          } else if (part.type === "patch") {
            island.updateActivity({
              status: "working",
              progressMessage: "Applying changes...",
            })
          }
          break
        }

        case "session.status": {
          if (event.properties.status.type === "idle") {
            island.endActivity("completed")
          } else if (event.properties.status.type === "busy") {
            island.updateActivity({
              status: "working",
              progressMessage: "Processing...",
            })
          } else if (event.properties.status.type === "retry") {
            island.updateActivity({
              status: "thinking",
              progressMessage: `Retrying: ${event.properties.status.message}`,
            })
          }
          break
        }

        case "session.permission.request": {
          const { permission, actions } = event.properties
          island.requestApproval({
            type: "permission",
            title: permission.title || "Permission Required",
            description: permission.description,
            agentType,
            agentName: "nikcli",
            options: {
              approve: {
                label: actions?.approve?.label || "Allow",
                action: () => {
                  // Invia risposta al server
                  console.log("Approved:", permission.id)
                },
              },
              deny: {
                label: actions?.deny?.label || "Deny",
                action: () => {
                  console.log("Denied:", permission.id)
                },
              },
            },
          })
          break
        }

        case "session.idle": {
          island.endActivity("completed")
          break
        }
      }
    },
    [sessionId, island],
  )

  const startAgent = useCallback(
    (agentId: string, agentName: string) => {
      island.startActivity(agentId, agentName, "coding")
    },
    [island],
  )

  const requestToolApproval = useCallback(
    (toolName: string, description?: string) => {
      return new Promise<boolean>((resolve) => {
        island.requestApproval({
          type: "tool",
          title: `Run ${toolName}?`,
          description,
          options: {
            approve: {
              label: "Run",
              action: () => resolve(true),
            },
            deny: {
              label: "Skip",
              action: () => resolve(false),
            },
          },
        })
      })
    },
    [island],
  )

  return {
    ...island,
    handleStreamEvent,
    startAgent,
    requestToolApproval,
  }
}
