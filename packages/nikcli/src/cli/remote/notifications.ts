import { remoteService } from "./remote-service"
import type { RemoteNotification, TaskInfo } from "./types"

export function sendRemoteNotification(notification: RemoteNotification): void {
  if (!remoteService.hasActiveSession()) return
  remoteService.notify(notification)
}

export function notifyTaskStarted(taskName: string, description?: string): void {
  sendRemoteNotification({
    type: "info",
    title: `Task Started: ${taskName}`,
    body: description ?? "Working on your request...",
  })
}

export function notifyTaskCompleted(task: TaskInfo): void {
  remoteService.notifyTaskComplete(task)
}

export function notifyTaskFailed(taskName: string, error: string): void {
  sendRemoteNotification({
    type: "error",
    title: `Task Failed: ${taskName}`,
    body: error,
  })
}

export function notifyInputRequired(agentName: string, prompt: string): void {
  remoteService.notifyInputRequired(agentName, prompt)
}

export function notifyProgress(taskName: string, progress: number, message?: string): void {
  const body = message ?? `Progress: ${progress}%`
  remoteService.broadcast({
    type: "progress",
    payload: {
      taskName,
      progress,
      message: body,
    },
  })
}

export function notifyInfo(title: string, body: string): void {
  sendRemoteNotification({
    type: "info",
    title,
    body,
  })
}

export class RemoteNotificationManager {
  private enabled = true

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled && remoteService.hasActiveSession()
  }

  taskStarted(name: string, description?: string): void {
    if (!this.isEnabled()) return
    notifyTaskStarted(name, description)
  }

  taskCompleted(task: TaskInfo): void {
    if (!this.isEnabled()) return
    notifyTaskCompleted(task)
  }

  taskFailed(name: string, error: string): void {
    if (!this.isEnabled()) return
    notifyTaskFailed(name, error)
  }

  progress(name: string, progress: number, message?: string): void {
    if (!this.isEnabled()) return
    notifyProgress(name, progress, message)
  }

  inputRequired(agentName: string, prompt: string): void {
    if (!this.isEnabled()) return
    notifyInputRequired(agentName, prompt)
  }

  info(title: string, body: string): void {
    if (!this.isEnabled()) return
    notifyInfo(title, body)
  }

  error(title: string, body: string): void {
    if (!this.isEnabled()) return
    sendRemoteNotification({
      type: "error",
      title,
      body,
    })
  }
}

export const remoteNotifications = new RemoteNotificationManager()
