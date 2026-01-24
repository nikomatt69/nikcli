import { remoteService } from "./remote-service"
import type { InputPrompt, SubagentResult, TaskInfo } from "./types"

export interface SubagentRemoteHooks {
  onStart(agentName: string, task: string): void
  onProgress(agentName: string, progress: number, message: string): void
  onComplete(agentName: string, result: SubagentResult): void
  onError(agentName: string, error: Error): void
  onRequiresInput(agentName: string, prompt: InputPrompt): void
}

export function createSubagentRemoteHooks(): SubagentRemoteHooks {
  return {
    onStart(agentName: string, task: string) {
      if (!remoteService.hasActiveSession()) return
      remoteService.broadcast({
        type: "subagent:start",
        payload: {
          agentName,
          task,
          timestamp: Date.now(),
        },
      })
    },

    onProgress(agentName: string, progress: number, message: string) {
      if (!remoteService.hasActiveSession()) return
      remoteService.broadcast({
        type: "subagent:progress",
        payload: {
          agentName,
          progress,
          message,
          timestamp: Date.now(),
        },
      })
    },

    onComplete(agentName: string, result: SubagentResult) {
      if (!remoteService.hasActiveSession()) return
      remoteService.broadcast({
        type: "subagent:complete",
        payload: {
          agentName,
          result,
          timestamp: Date.now(),
        },
      })

      remoteService.notifyTaskComplete({
        name: agentName,
        summary: result.summary,
        success: result.success,
        duration: result.duration,
        agentName,
      })
    },

    onError(agentName: string, error: Error) {
      if (!remoteService.hasActiveSession()) return
      remoteService.broadcast({
        type: "subagent:error",
        payload: {
          agentName,
          error: error.message,
          timestamp: Date.now(),
        },
      })
      remoteService.notifyError(agentName, error.message)
    },

    onRequiresInput(agentName: string, prompt: InputPrompt) {
      if (!remoteService.hasActiveSession()) return
      remoteService.broadcast({
        type: "subagent:input_required",
        payload: {
          agentName,
          prompt,
          timestamp: Date.now(),
        },
      })
      remoteService.notifyInputRequired(agentName, prompt.message)
    },
  }
}

let _hooks: SubagentRemoteHooks | null = null

export function getSubagentRemoteHooks(): SubagentRemoteHooks {
  if (!_hooks) {
    _hooks = createSubagentRemoteHooks()
  }
  return _hooks
}

export function attachRemoteHooksToAgentService(agentService: any): void {
  const hooks = getSubagentRemoteHooks()
  if (!agentService?.on) return

  agentService.on("task_start", (task: any) => {
    hooks.onStart(task.agentType ?? "agent", task.task ?? task.description ?? "Task")
  })

  agentService.on("task_progress", (task: any, update: any) => {
    hooks.onProgress(
      task.agentType ?? "agent",
      update.progress ?? 0,
      update.description ?? update.message ?? "",
    )
  })

  agentService.on("task_complete", (task: any, result: any) => {
    hooks.onComplete(task.agentType ?? "agent", {
      success: result?.success ?? true,
      summary: result?.summary ?? "Task completed",
      duration: result?.duration ?? 0,
      output: result?.output,
    })
  })

  agentService.on("task_error", (task: any, error: any) => {
    hooks.onError(task.agentType ?? "agent", error instanceof Error ? error : new Error(String(error)))
  })

  agentService.on("input_required", (task: any, prompt: any) => {
    hooks.onRequiresInput(task.agentType ?? "agent", {
      message: prompt?.message ?? "Input required",
      type: prompt?.type ?? "text",
      options: prompt?.options,
      required: prompt?.required,
    })
  })
}

export function createTaskInfo(
  name: string,
  summary: string,
  options?: {
    success?: boolean
    duration?: number
    agentName?: string
  },
): TaskInfo {
  return {
    name,
    summary,
    success: options?.success ?? true,
    duration: options?.duration,
    agentName: options?.agentName ?? name,
  }
}
