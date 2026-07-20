import { createMemo, onMount } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { Spinner } from "../../component/spinner"
import { dismissBackground, getBackgroundDismissed } from "../../util/background"

type MonitorOption = {
  kind: "monitor"
  id: string
  title: string
  command: string
  status: string
  logPath?: string
  exitCode?: number
}

type JobOption = {
  kind: "job"
  id: string
  title: string
  agent: string
  status: string
  workerSessionID?: string
  delegatorSessionID?: string
}

type BgOption = MonitorOption | JobOption

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

function jobStatusLabel(status: string) {
  switch (status) {
    case "running":
      return "running"
    case "synthesizing":
      return "synthesizing"
    case "complete":
      return "ready"
    default:
      return status
  }
}

function isActiveStatus(status: string) {
  return status === "running" || status === "synthesizing"
}

function statusSymbol(status: string) {
  switch (status) {
    case "running":
    case "synthesizing":
      return "●"
    case "complete":
      return "✓"
    case "timeout":
      return "!"
    case "cancelled":
      return "-"
    case "error":
      return "×"
    default:
      return "○"
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

  const dismissed = createMemo(() => getBackgroundDismissed(kv, props.sessionID))

  // Force sync when dialog opens to ensure we have all message parts (including monitors)
  onMount(() => {
    dialog.setSize("xlarge")
    void sync.session.sync(props.sessionID, { full: true })
  })

  function dismissJob(delegationID: string) {
    dismissBackground(kv, props.sessionID, delegationID)
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

    // Get jobs from current session and parent session
    const currentJobs = sync.background.list(props.sessionID)
    const parentSession = sync.session.get(props.sessionID)
    const parentJobs = parentSession?.parentID ? sync.background.list(parentSession.parentID) : []
    const allJobs = [...currentJobs, ...parentJobs]

    const jobs = [...allJobs].sort((a, b) => {
      const activeA = isActiveStatus(a.status)
      const activeB = isActiveStatus(b.status)
      if (activeA !== activeB) return activeA ? -1 : 1
      const hiddenA = dismissed().has(a.rootDelegationID)
      const hiddenB = dismissed().has(b.rootDelegationID)
      if (hiddenA !== hiddenB) return hiddenA ? 1 : -1
      return b.updatedAt - a.updatedAt
    })
    const visibleJobs = jobs.filter((job) => !dismissed().has(job.rootDelegationID))
    const activeJobCount = visibleJobs.filter((job) => isActiveStatus(job.status)).length
    const inactiveJobCount = visibleJobs.length - activeJobCount
    const monitorCount = monitors().length
    const activeMonitorCount = monitors().filter((monitor) => monitor.status === "running").length

    for (const job of visibleJobs) {
      const active = isActiveStatus(job.status)
      const color = local.agent.color(job.agent)
      const category = active ? `Active Background Jobs (${activeJobCount})` : `Background Jobs (${inactiveJobCount})`
      out.push({
        title: job.title,
        value: {
          kind: "job",
          id: job.rootDelegationID,
          title: job.title,
          agent: job.agent,
          status: job.status,
          workerSessionID: job.workerSessionID,
          delegatorSessionID: job.delegatorSessionID,
        } satisfies BgOption,
        description: `${jobStatusLabel(job.status)} · open session`,
        category,
        footer: `@${Locale.truncateMiddle(job.agent, 18)}`,
        gutter: active ? (
          <box flexDirection="row" gap={1}>
            <Spinner />
            <text fg={color ?? theme.accent}>@</text>
          </box>
        ) : (
          <text fg={color ?? theme.textMuted}>{statusSymbol(job.status)}</text>
        ),
      })
    }

    for (const mon of monitors()) {
      const isRunning = mon.status === "running"
      const statusColor =
        mon.status === "complete"
          ? theme.success
          : mon.status === "running"
            ? theme.accent
            : mon.status === "cancelled"
              ? theme.textMuted
              : theme.error
      const category =
        activeMonitorCount > 0 && activeMonitorCount !== monitorCount
          ? `Monitors (${activeMonitorCount}/${monitorCount} running)`
          : `Monitors (${monitorCount})`
      out.push({
        title: mon.title,
        value: mon satisfies BgOption,
        description: `${monitorStatusLabel(mon.status, mon.exitCode)} · open logs`,
        category,
        footer: mon.command ? Locale.truncateMiddle(mon.command, 40) : undefined,
        gutter: isRunning ? <Spinner /> : <text fg={statusColor}>{statusSymbol(mon.status)}</text>,
      })
    }

    return out
  })

  const hasAgents = createMemo(() => options().length > 0)

  return (
    <DialogSelect
      title="Background Agents"
      placeholder="Search jobs, monitors, agents"
      skipFilter={!hasAgents()}
      options={options()}
      onSelect={(opt) => {
        const value = opt.value
        if (value.kind === "job") {
          const sessionID = value.workerSessionID ?? value.delegatorSessionID
          if (!sessionID) return
          void sync.session.sync(sessionID, { full: true })
          route.navigate({
            type: "session",
            sessionID,
            workspaceID: sync.session.get(sessionID)?.workspaceID,
          })
          dialog.clear()
        } else {
          props.onOpenMonitor(value.id, value.title, value.command, value.status, value.logPath)
        }
      }}
      keybind={[
        {
          keybind: Keybind.parse("x")[0],
          title: "cancel / dismiss",
          onTrigger: (opt) => {
            const value = opt.value
            if (value.kind === "job") {
              dismissJob(value.id)
              if (value.status === "running" || value.status === "synthesizing") {
                sdk.client.session.background2
                  .cancel({ sessionID: props.sessionID, delegationID: value.id })
                  .catch(() => {})
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
