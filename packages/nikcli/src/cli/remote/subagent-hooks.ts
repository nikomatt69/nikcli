import { remoteService } from "./remote-service"
import type { InputPrompt, SubagentResult, TaskInfo } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "subagent-hooks" })

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
      if (!remoteService.hasActiveSession()) {
        log.debug("No active session, skipping subagent start broadcast")
        return
      }
      log.debug("Subagent started", { agentName, task })
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
      if (!remoteService.hasActiveSession()) {
        log.debug("No active session, skipping subagent progress broadcast")
        return
      }
      log.debug("Subagent progress", { agentName, progress, message })
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
      if (!remoteService.hasActiveSession()) {
        log.debug("No active session, skipping subagent complete broadcast")
        return
      }
      log.debug("Subagent completed", { agentName, success: result.success, duration: result.duration })
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
      if (!remoteService.hasActiveSession()) {
        log.debug("No active session, skipping subagent error broadcast")
        return
      }
      log.error("Subagent error", { agentName, error: error.message })
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
      if (!remoteService.hasActiveSession()) {
        log.debug("No active session, skipping subagent input required broadcast")
        return
      }
      log.debug("Subagent requires input", { agentName, message: prompt.message })
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
    log.debug("Created new subagent hooks instance")
  }
  return _hooks
}

export function attachRemoteHooksToAgentService(agentService: {
  on(event: string, handler: (...args: unknown[]) => void): void
} | null): void {
  if (!agentService) {
    log.warn("No agent service provided to attach hooks")
    return
  }

  const hooks = getSubagentRemoteHooks()
  log.debug("Attaching remote hooks to agent service")

  agentService.on("task_start", (task: unknown) => {
    const typedTask = task as { agentType?: string; task?: string; description?: string }
    hooks.onStart(
      typedTask.agentType ?? "agent",
      typedTask.task ?? typedTask.description ?? "Task",
    )
  })

  agentService.on("task_progress", (task: unknown, update: unknown) => {
    const typedTask = task as { agentType?: string }
    const typedUpdate = update as { progress?: number; description?: string; message?: string }
    hooks.onProgress(
      typedTask.agentType ?? "agent",
      typedUpdate.progress ?? 0,
      typedUpdate.description ?? typedUpdate.message ?? "",
    )
  })

  agentService.on("task_complete", (task: unknown, result: unknown) => {
    const typedTask = task as { agentType?: string }
    const typedResult = result as {
      success?: boolean
      summary?: string
      duration?: number
      output?: string
    }
    hooks.onComplete(typedTask.agentType ?? "agent", {
      success: typedResult?.success ?? true,
      summary: typedResult?.summary ?? "Task completed",
      duration: typedResult?.duration ?? 0,
      output: typedResult?.output,
    })
  })

  agentService.on("task_error", (task: unknown, error: unknown) => {
    const typedTask = task as { agentType?: string }
    const errorMessage = error instanceof Error ? error.message : String(error ?? "Unknown error")
    hooks.onError(
      typedTask.agentType ?? "agent",
      error instanceof Error ? error : new Error(errorMessage),
    )
  })

  agentService.on("input_required", (task: unknown, prompt: unknown) => {
    const typedTask = task as { agentType?: string }
    const typedPrompt = prompt as {
      message?: string
      type?: string
      options?: string[]
      required?: boolean
    }
    hooks.onRequiresInput(typedTask.agentType ?? "agent", {
      message: typedPrompt?.message ?? "Input required",
      type: (typedPrompt?.type as InputPrompt["type"]) ?? "text",
      options: typedPrompt?.options,
      required: typedPrompt?.required,
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
