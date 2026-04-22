// Computer-Use Permissions Module
// Handles macOS permission checks and user guidance

import { bridgeCommand } from "./bridge"
import type { PermissionStatus } from "./types"

export interface PermissionCheckResult {
  status: PermissionStatus
  missing: ("accessibility" | "screenRecording")[]
  ready: boolean
}

/**
 * Check current permission status from the helper
 */
export async function checkPermissions(signal?: AbortSignal): Promise<PermissionStatus> {
  const result = await bridgeCommand<{
    accessibility: boolean
    screenRecording: boolean
  }>("checkPermissions", {}, { signal })

  return {
    accessibility: result.accessibility === true,
    screenRecording: result.screenRecording === true,
  }
}

/**
 * Open the macOS System Settings pane for a specific permission
 */
export async function openPermissionPane(kind: "accessibility" | "screenRecording"): Promise<void> {
  await bridgeCommand("openPermissionPane", { kind })
}

/**
 * Check permissions and return detailed status
 */
export async function checkPermissionStatus(signal?: AbortSignal): Promise<PermissionCheckResult> {
  const status = await checkPermissions(signal)
  const missing: ("accessibility" | "screenRecording")[] = []

  if (!status.accessibility) {
    missing.push("accessibility")
  }
  if (!status.screenRecording) {
    missing.push("screenRecording")
  }

  return {
    status,
    missing,
    ready: missing.length === 0,
  }
}

/**
 * Guide user through permission setup
 */
export async function ensurePermissions(
  onMissing: (missing: ("accessibility" | "screenRecording")[]) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<PermissionStatus> {
  const initial = await checkPermissionStatus(signal)

  if (initial.ready) {
    return initial.status
  }

  // Notify about missing permissions
  await onMissing(initial.missing)

  // Open the appropriate permission panes
  for (const kind of initial.missing) {
    await openPermissionPane(kind)
  }

  // Wait a moment for user to grant permissions
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Check again
  const updated = await checkPermissionStatus(signal)

  if (!updated.ready) {
    const stillMissing = updated.missing.join(" and ")
    throw new Error(
      `Computer-use requires ${stillMissing} permission(s). ` +
        `Please grant the required permissions in System Settings > Privacy & Security, ` +
        `then add the helper to the allowed apps: ~/.nikcli/helpers/computer-use/bridge`,
    )
  }

  return updated.status
}

/**
 * Format permission status for display
 */
export function formatPermissionStatus(status: PermissionStatus): string {
  const parts: string[] = []
  parts.push(`Accessibility: ${status.accessibility ? "✓ granted" : "✗ missing"}`)
  parts.push(`Screen Recording: ${status.screenRecording ? "✓ granted" : "✗ missing"}`)
  return parts.join("\n")
}

/**
 * Get instructions for granting permissions
 */
export function getPermissionInstructions(): string {
  return `
To use computer-use tools, please grant the following permissions in macOS:

1. Open System Settings > Privacy & Security > Accessibility
   - Add: ~/.nikcli/helpers/computer-use/bridge

2. Open System Settings > Privacy & Security > Screen Recording
   - Add: ~/.nikcli/helpers/computer-use/bridge

These permissions allow the agent to:
- Capture screenshots of application windows
- Click and interact with UI elements
- Type text into form fields

Without these permissions, computer-use tools will not function.
`
}
