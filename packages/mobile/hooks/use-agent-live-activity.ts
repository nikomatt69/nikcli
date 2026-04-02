import { useEffect, useRef, useCallback } from "react"
import {
  startAgentActivity,
  updateAgentActivity,
  stopAgentActivity,
  setupLiveActivityListeners,
  isLiveActivitySupported,
  inferAgentType,
  addPermissionToActivity,
  removePermissionFromActivity,
  accumulateTokensToActivity,
  type AgentType,
  type SubAgentStatus,
  type ToolExecution,
  type AgentActivity,
} from "@/lib/live-activity"
import type { SessionStreamEvent, ToolState, Part } from "@/lib/types"

interface UseAgentLiveActivityOptions {
  sessionId: string | undefined
  agentId?: string
  agentName?: string
  agentType?: AgentType
  enabled?: boolean
  onActivityStarted?: (activity: AgentActivity) => void
  onActivityEnded?: (activity: AgentActivity) => void
}

function isToolPartRunning(part: Part): boolean {
  if (part.type !== "tool") return false
  const toolPart = part as ToolPart
  return toolPart.state.status === "running"
}

function isToolPartCompleted(part: Part): boolean {
  if (part.type !== "tool") return false
  const toolPart = part as ToolPart
  return toolPart.state.status === "completed"
}

function isToolPartError(part: Part): boolean {
  if (part.type !== "tool") return false
  const toolPart = part as ToolPart
  return toolPart.state.status === "error"
}

function getToolTitle(state: ToolState): string | undefined {
  if (state.status === "completed" && "title" in state) return state.title
  if (state.status === "running" && "title" in state) return state.title
  return undefined
}

function getToolDuration(state: ToolState): number | undefined {
  if ("time" in state && state.time?.start) {
    return Date.now() - state.time.start
  }
  return undefined
}

type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

export function useAgentLiveActivity(options: UseAgentLiveActivityOptions) {
  const currentActivityRef = useRef<AgentActivity | null>(null)
  const listenersSetupRef = useRef(false)
  const lastToolRef = useRef<string>("")

  const cleanupActivity = useCallback(async () => {
    if (currentActivityRef.current) {
      try {
        await stopAgentActivity(currentActivityRef.current.sessionId)
      } catch {
        // Ignore cleanup errors
      }
      options.onActivityEnded?.(currentActivityRef.current)
      currentActivityRef.current = null
    }
  }, [options.onActivityEnded])

  const startActivityFn = useCallback(
    async (agentId: string, agentName: string, agentType?: AgentType) => {
      if (!options.sessionId) return

      try {
        if (!isLiveActivitySupported()) return

        if (
          currentActivityRef.current?.agentId === agentId &&
          currentActivityRef.current?.sessionId === options.sessionId
        ) {
          return
        }

        await cleanupActivity()

        const activity = await startAgentActivity({
          sessionId: options.sessionId,
          agentId,
          agentName,
          agentType,
          initialMessage: "Initializing agent...",
        })

        if (activity) {
          currentActivityRef.current = activity
          options.onActivityStarted?.(activity)
        }
      } catch (error) {
        console.warn("Failed to start Live Activity:", error)
      }
    },
    [options.sessionId, options.onActivityStarted, cleanupActivity],
  )

  const updateActivityFn = useCallback(
    async (status: SubAgentStatus, progressMessage?: string, tool?: ToolExecution) => {
      if (!currentActivityRef.current || !options.sessionId) return

      try {
        await updateAgentActivity({
          sessionId: options.sessionId,
          status,
          progressMessage,
          tool,
        })
      } catch (error) {
        console.warn("Failed to update Live Activity:", error)
      }
    },
    [options.sessionId],
  )

  const endActivityFn = useCallback(
    async (status: "completed" | "failed" = "completed") => {
      if (!currentActivityRef.current) return

      const activity = currentActivityRef.current

      try {
        await stopAgentActivity(activity.sessionId, status)
      } catch {
        // Ignore cleanup errors
      }

      options.onActivityEnded?.(activity)
      currentActivityRef.current = null
    },
    [options.onActivityEnded],
  )

  useEffect(() => {
    if (!isLiveActivitySupported() || listenersSetupRef.current) return

    try {
      const cleanup = setupLiveActivityListeners()
      listenersSetupRef.current = true
      return cleanup
    } catch (error) {
      console.warn("Failed to setup Live Activity listeners:", error)
    }
  }, [])

  useEffect(() => {
    if (options.agentId && options.agentName && options.enabled) {
      startActivityFn(options.agentId, options.agentName, options.agentType)
    }

    return () => {
      cleanupActivity()
    }
  }, [options.agentId, options.agentName, options.enabled, options.agentType, startActivityFn, cleanupActivity])

  const handleStreamEvent = useCallback(
    (event: SessionStreamEvent) => {
      if (!currentActivityRef.current || !options.sessionId) return

      const agentType = inferAgentType(
        event as { type: string; properties?: { part?: { type: string; tool?: string } } },
      )

      switch (event.type) {
        case "message.part.updated": {
          const part = event.properties.part as Part

          if (part.type === "tool") {
            const toolPart = part as ToolPart
            const toolTitle = getToolTitle(toolPart.state)
            const toolDuration = getToolDuration(toolPart.state)

            if (isToolPartRunning(toolPart)) {
              const toolExec: ToolExecution = {
                name: toolPart.tool || "unknown",
                status: "running",
                progress: toolTitle ? undefined : 0.5,
              }
              lastToolRef.current = toolPart.tool

              updateActivityFn("working", toolTitle || `Running ${toolPart.tool}...`, toolExec)
              updateAgentActivity({
                sessionId: options.sessionId,
                agentType: agentType !== currentActivityRef.current?.agentType ? agentType : undefined,
              })
            } else if (isToolPartCompleted(toolPart)) {
              const toolExec: ToolExecution = {
                name: toolPart.tool || "unknown",
                status: "completed",
                duration: toolDuration,
              }
              updateActivityFn("working", toolTitle || `${toolPart.tool} done`, toolExec)
            } else if (isToolPartError(toolPart)) {
              const toolExec: ToolExecution = {
                name: toolPart.tool || "unknown",
                status: "error",
                duration: toolDuration,
              }
              updateActivityFn("failed", `Error in ${toolPart.tool}`, toolExec)
            }
          }

          if (part.type === "reasoning" && event.properties.delta) {
            updateActivityFn("thinking", "Analyzing request...")
          }

          if (part.type === "text" && event.properties.delta) {
            const isReasoning = (part as { synthetic?: boolean }).synthetic
            if (!isReasoning) {
              updateActivityFn("thinking", "Generating response...")
            }
          }

          if (part.type === "patch") {
            updateActivityFn("working", "Applying changes...")
          }

          if (part.type === "step-finish") {
            const sf = part as { cost: number; tokens: { input: number; output: number } }
            if (options.sessionId) {
              accumulateTokensToActivity(options.sessionId, sf.tokens.input, sf.tokens.output, sf.cost)
            }
          }
          break
        }

        case "permission.asked": {
          const perm = event.properties as { id: string; permission: string }
          if (options.sessionId && perm.id) {
            addPermissionToActivity(options.sessionId, perm.id, perm.permission)
            updateActivityFn("reviewing", `Permission: ${perm.permission}`)
          }
          break
        }

        case "permission.replied": {
          const replied = event.properties as { requestID: string }
          if (options.sessionId && replied.requestID) {
            removePermissionFromActivity(options.sessionId, replied.requestID)
          }
          break
        }

        case "session.status": {
          if (event.properties.status.type === "idle") {
            endActivityFn("completed")
          } else if (event.properties.status.type === "busy") {
            updateActivityFn("working", "Processing...")
          } else if (event.properties.status.type === "retry") {
            updateActivityFn("thinking", `Retrying: ${event.properties.status.message}`)
          }
          break
        }

        case "session.idle": {
          endActivityFn("completed")
          break
        }
      }
    },
    [options.sessionId, updateActivityFn, endActivityFn],
  )

  return {
    startActivity: startActivityFn,
    updateActivity: updateActivityFn,
    endActivity: endActivityFn,
    handleStreamEvent,
    isActivityActive: currentActivityRef.current !== null,
    currentActivity: currentActivityRef.current,
  }
}

export { type AgentType, type AgentActivity, type SubAgentStatus, type ToolExecution }
