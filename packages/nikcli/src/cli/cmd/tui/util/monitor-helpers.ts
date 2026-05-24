/**
 * Helper functions for extracting monitor information from sync data.
 * Monitors are stored in tool parts (type="tool", tool="monitor") with metadata.
 */

import type { useSync } from "../context/sync"

export type MonitorInfo = {
  id: string
  title: string
  command: string
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | string
  logPath?: string
  exitCode?: number
  preview?: string
  bytes?: number
}

type Sync = ReturnType<typeof useSync>

/**
 * Extract all monitors for a session from message tool parts.
 */
export function getMonitorsForSession(sync: Sync, sessionID: string): MonitorInfo[] {
  const seen = new Map<string, MonitorInfo>()
  const msgs = sync.data.message[sessionID] ?? []

  for (const msg of msgs) {
    const parts = sync.data.part[msg.id] ?? []
    for (const part of parts) {
      if (part.type !== "tool" || part.tool !== "monitor") continue

      const state = part.state as { input?: Record<string, unknown>; metadata?: Record<string, unknown> }
      const input = state.input ?? {}
      const meta = state.metadata ?? {}

      const monitorID = typeof meta.monitorId === "string" ? meta.monitorId : undefined
      if (!monitorID) continue

      // Don't overwrite if we already have this monitor (earlier message wins)
      if (seen.has(monitorID)) continue

      const title =
        (typeof meta.title === "string" && meta.title.trim()) ||
        (typeof input.title === "string" && input.title.trim()) ||
        (typeof input.command === "string" && input.command.trim()) ||
        "monitor"

      const command = typeof input.command === "string" ? input.command : ""
      const status = (typeof meta.status === "string" ? meta.status : "running") as MonitorInfo["status"]
      const logPath = typeof meta.logPath === "string" ? meta.logPath : undefined
      const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : undefined
      const preview = typeof meta.recentOutput === "string" ? meta.recentOutput : undefined
      const bytes = typeof meta.bytes === "number" ? meta.bytes : undefined

      seen.set(monitorID, { id: monitorID, title, command, status, logPath, exitCode, preview, bytes })
    }
  }

  return [...seen.values()]
}

/**
 * Get only active (running) monitors for a session.
 */
export function getActiveMonitors(sync: Sync, sessionID: string): MonitorInfo[] {
  return getMonitorsForSession(sync, sessionID).filter((m) => m.status === "running")
}

/**
 * Get monitors sorted by status (running first) and then by title.
 */
export function getMonitorsSorted(sync: Sync, sessionID: string): MonitorInfo[] {
  return getMonitorsForSession(sync, sessionID).sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1
    if (a.status !== "running" && b.status === "running") return 1
    return a.title.localeCompare(b.title)
  })
}

/**
 * Format monitor status for display.
 */
export function formatMonitorStatus(status: string, exitCode?: number): string {
  switch (status) {
    case "running":
      return "running"
    case "complete":
      return typeof exitCode === "number" ? `done (exit ${exitCode})` : "done"
    case "timeout":
      return "timed out"
    case "cancelled":
      return "cancelled"
    case "error":
      return typeof exitCode === "number" ? `error (exit ${exitCode})` : "error"
    default:
      return status
  }
}
