import { createMemo } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { type DialogContext } from "@tui/ui/dialog"
import { Keybind } from "@/util/keybind"
import { useTheme } from "@tui/context/theme"

type BackgroundDismissedMap = Record<string, string[]>

function statusLabel(status: string) {
  switch (status) {
    case "running":
      return "running"
    case "synthesizing":
      return "synthesizing"
    case "complete":
      return "ready"
    case "cancelled":
      return "cancelled"
    case "timeout":
      return "timed out"
    case "orphaned":
      return "orphaned"
    default:
      return status
  }
}

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const sync = useSync()
  const kv = useKV()
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()

  const dismissed = createMemo(() => {
    const map = (kv.get("background_subtasks_dismissed", {}) ?? {}) as BackgroundDismissedMap
    return new Set(map[props.sessionID] ?? [])
  })

  function dismissJob(delegationID: string) {
    const map = (kv.get("background_subtasks_dismissed", {}) ?? {}) as BackgroundDismissedMap
    const next = Array.from(new Set([...(map[props.sessionID] ?? []), delegationID]))
    kv.set("background_subtasks_dismissed", { ...map, [props.sessionID]: next })
  }

  const options = createMemo(() => {
    const out = sync.background
      .list(props.sessionID)
      .filter((job) => !dismissed().has(job.rootDelegationID))
      .map((job) => ({
        title: job.title,
        value: job.rootDelegationID,
        description: statusLabel(job.status),
        agent: job.agent,
        status: job.status,
        workerSessionID: job.workerSessionID,
        delegatorSessionID: job.delegatorSessionID,
      }))

    out.sort((a, b) => {
      const activeA = a.status === "running" || a.status === "synthesizing"
      const activeB = b.status === "running" || b.status === "synthesizing"
      if (activeA !== activeB) return activeA ? -1 : 1
      return a.title.localeCompare(b.title)
    })
    return out
  })

  return (
    <DialogSelect
      title="Background Subtasks"
      options={options().map((opt) => {
        const color = local.agent.color(opt.agent)
        return {
          title: opt.title,
          value: opt.value,
          description: opt.description,
          bg: color,
          gutter: <text fg={color ?? theme.textMuted}>@{opt.agent}</text>,
          onSelect: (ctx: DialogContext) => {
            const sessionID = opt.workerSessionID ?? opt.delegatorSessionID
            if (!sessionID) return
            route.navigate({
              type: "session",
              sessionID,
              workspaceID: sync.session.get(sessionID)?.workspaceID,
            })
            ctx.clear()
          },
        }
      })}
      keybind={[
        {
          keybind: Keybind.parse("k")[0],
          title: "Cancel / Dismiss",
          onTrigger: (option) => {
            dismissJob(option.value)
            const job = sync.background.get(props.sessionID, option.value)
            if (!job) return
            if (job.status === "running" || job.status === "synthesizing") {
              sdk.client.session.background2
                .cancel({ sessionID: props.sessionID, delegationID: option.value })
                .catch(() => {})
            }
          },
        },
        {
          keybind: Keybind.parse("escape")[0],
          title: "Close",
          onTrigger: () => {
            dialog.clear()
          },
        },
      ]}
    />
  )
}
