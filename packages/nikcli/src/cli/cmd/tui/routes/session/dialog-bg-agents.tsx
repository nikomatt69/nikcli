import { createMemo } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { Keybind } from "@/util/keybind"
import { Spinner } from "../../component/spinner"

type SessionOption = {
  kind: "session"
  id: string
}

type MonitorOption = {
  kind: "monitor"
  id: string
  title: string
  command: string
  status: string
  logPath?: string
  exitCode?: number
}

type BgOption = SessionOption | MonitorOption

type BackgroundSubtasksMap = Record<string, string[]>
type BackgroundDismissedMap = Record<string, string[]>

function getSupervisorInfo(title: string): { isSupervisor: boolean; taskTitle: string } {
  const supervisorMatch = title.match(/^(?:supervisor|delegator):\s*(.+)$/i)
  if (supervisorMatch) {
    return { isSupervisor: true, taskTitle: supervisorMatch[1] }
  }
  return { isSupervisor: false, taskTitle: title }
}

function monitorStatusLabel(status: string, exitCode?: number) {
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

export function DialogBgAgents(props: {
  sessionID: string
  onOpenMonitor: (monitorID: string, title: string, command: string, status: string, logPath?: string) => void
}) {
  const route = useRoute()
  const sync = useSync()
  const kv = useKV()
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()

  const backgroundedIDs = createMemo(() => {
    const map = (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
    return map[props.sessionID] ?? []
  })

  function removeFromBackground(childID: string) {
    const map = (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
    const list = map[props.sessionID] ?? []
    const next = list.filter((x) => x !== childID)
    if (next.length === list.length) return
    kv.set("background_subtasks", { ...map, [props.sessionID]: next })
    const dismissedMap = (kv.get("background_subtasks_dismissed", {}) ?? {}) as BackgroundDismissedMap
    const dismissed = Array.from(new Set([...(dismissedMap[props.sessionID] ?? []), childID]))
    kv.set("background_subtasks_dismissed", { ...dismissedMap, [props.sessionID]: dismissed })
  }

  const monitors = createMemo(() => {
    const seen = new Map<string, MonitorOption>()
    const msgs = sync.data.message[props.sessionID] ?? []
    for (const msg of msgs) {
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool" || part.tool !== "monitor") continue
        const state = part.state as { input?: Record<string, unknown>; metadata?: Record<string, unknown> }
        const input = state.input ?? {}
        const meta = state.metadata ?? {}
        const monitorID = typeof meta.monitorId === "string" ? meta.monitorId : undefined
        if (!monitorID) continue
        const title =
          (typeof meta.title === "string" && meta.title.trim()) ||
          (typeof input.title === "string" && input.title.trim()) ||
          (typeof input.command === "string" && input.command.trim()) ||
          "monitor"
        const command = typeof input.command === "string" ? input.command : ""
        const status = typeof meta.status === "string" ? meta.status : "running"
        const logPath = typeof meta.logPath === "string" ? meta.logPath : undefined
        const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : undefined
        seen.set(monitorID, { kind: "monitor", id: monitorID, title, command, status, logPath, exitCode })
      }
    }
    return [...seen.values()].sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1
      if (a.status !== "running" && b.status === "running") return 1
      return a.title.localeCompare(b.title)
    })
  })

  const options = createMemo((): DialogSelectOption<BgOption>[] => {
    const out: DialogSelectOption<BgOption>[] = []
    const sessionsByID = new Map(sync.data.session.map((s) => [s.id, s] as const))

    for (const id of backgroundedIDs()) {
      const session = sessionsByID.get(id)
      if (!session) continue
      const statusType = sync.data.session_status[id]?.type ?? "idle"
      const isRunning = statusType === "busy" || statusType === "retry"
      const label = statusType === "busy" ? "running" : statusType === "retry" ? "retrying" : "ready"
      const agent = session.title.match(/\(@([^\s]+)\s+subagent\)$/)?.[1]
      const { isSupervisor, taskTitle } = getSupervisorInfo(session.title)

      // Check if this is a supervisor/delegator session
      if (isSupervisor) {
        const color = theme.primary
        out.push({
          title: taskTitle,
          value: { kind: "session", id } satisfies BgOption,
          description: label,
          category: "Supervisors",
          footer: "supervisor",
          gutter: isRunning ? <Spinner /> : <text fg={color}>◉</text>,
        })
        continue
      }

      const title = session.title.replace(/\s*\(@[^\s]+\s+subagent\)$/, "")
      const color = agent ? local.agent.color(agent) : undefined
      out.push({
        title,
        value: { kind: "session", id } satisfies BgOption,
        description: label,
        category: "Background Sessions",
        footer: agent ? `@${agent}` : undefined,
        gutter: isRunning ? (
          <Spinner />
        ) : agent ? (
          <text fg={color ?? theme.textMuted}>@{agent.slice(0, 8)}</text>
        ) : undefined,
      })
    }

    for (const mon of monitors()) {
      const isRunning = mon.status === "running"
      const statusColor =
        mon.status === "complete" ? theme.success : mon.status === "running" ? theme.text : theme.error
      out.push({
        title: mon.title,
        value: mon satisfies BgOption,
        description: monitorStatusLabel(mon.status, mon.exitCode),
        category: "Monitors",
        footer: mon.command ? mon.command.slice(0, 40) : undefined,
        gutter: isRunning ? <Spinner /> : <text fg={statusColor}>◌</text>,
      })
    }

    return out
  })

  const hasAgents = createMemo(() => options().length > 0)

  return (
    <DialogSelect
      title="Background Agents"
      skipFilter={!hasAgents()}
      options={options()}
      onSelect={(opt) => {
        const value = opt.value
        if (value.kind === "session") {
          removeFromBackground(value.id)
          route.navigate({
            type: "session",
            sessionID: value.id,
            workspaceID: sync.session.get(value.id)?.workspaceID,
          })
          dialog.clear()
        } else {
          props.onOpenMonitor(value.id, value.title, value.command, value.status, value.logPath)
        }
      }}
      keybind={[
        {
          keybind: Keybind.parse("x")[0],
          title: "cancel / remove",
          onTrigger: (opt) => {
            const value = opt.value
            if (value.kind === "session") {
              removeFromBackground(value.id)
              if ((sync.data.session_status[value.id]?.type ?? "idle") !== "idle") {
                sdk.client.session.abort({ sessionID: value.id }).catch(() => {})
              }
            } else if (value.status === "running") {
              sdk.client.session.monitorCancel({ sessionID: props.sessionID, monitorID: value.id }).catch(() => {})
            }
          },
        },
      ]}
    />
  )
}
