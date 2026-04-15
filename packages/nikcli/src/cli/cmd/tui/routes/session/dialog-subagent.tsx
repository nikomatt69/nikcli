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

function parseSubagentFromTitle(title: string): string | undefined {
  const match = title.match(/\(@([^\s]+)\s+subagent\)$/)
  return match?.[1]
}

export function stripSubagentSuffix(title: string): string {
  return title.replace(/\s*\(@[^\s]+\s+subagent\)$/, "")
}

export function isSupervisorSession(title: string): boolean {
  return title.startsWith("supervisor:") || title.startsWith("delegator:")
}

type BackgroundSubtasksMap = Record<string, string[]>
type BackgroundDismissedMap = Record<string, string[]>

function statusLabel(status: string) {
  switch (status) {
    case "busy":
      return "running"
    case "retry":
      return "retrying"
    default:
      return "ready"
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

  const backgroundedIDs = createMemo(() => {
    const map = (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
    return map[props.sessionID] ?? []
  })

  const options = createMemo(() => {
    const sessionsByID = new Map(sync.data.session.map((s) => [s.id, s] as const))
    const out: {
      title: string
      value: string
      description?: string
      agent?: string
      status: string
    }[] = []

    for (const id of backgroundedIDs()) {
      const session = sessionsByID.get(id)

      // Hide supervisor/delegator sessions — only show real worker processes
      if (session && isSupervisorSession(session.title)) continue

      const status = sync.data.session_status[id]?.type ?? "idle"
      const agent = session ? parseSubagentFromTitle(session.title) : undefined
      const title = session ? stripSubagentSuffix(session.title) : "Loading..."
      out.push({ title, value: id, description: statusLabel(status), agent, status })
    }

    out.sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "busy") return -1
        if (b.status === "busy") return 1
      }
      return a.title.localeCompare(b.title)
    })
    return out
  })

  function removeFromBackground(parentID: string, childID: string) {
    const map = (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
    const list = map[parentID] ?? []
    const next = list.filter((x) => x !== childID)
    if (next.length === list.length) return
    kv.set("background_subtasks", { ...map, [parentID]: next })

    const dismissedMap = (kv.get("background_subtasks_dismissed", {}) ?? {}) as BackgroundDismissedMap
    const dismissed = Array.from(new Set([...(dismissedMap[parentID] ?? []), childID]))
    kv.set("background_subtasks_dismissed", { ...dismissedMap, [parentID]: dismissed })
  }

  return (
    <DialogSelect
      title="Background Subtasks"
      options={options().map((opt) => {
        const color = opt.agent ? local.agent.color(opt.agent) : undefined
        const gutterText = opt.agent ? `@${opt.agent}` : undefined
        return {
          title: opt.title,
          value: opt.value,
          description: opt.description,
          bg: color,
          gutter: gutterText ? <text fg={color ?? theme.textMuted}>{gutterText}</text> : undefined,
          onSelect: (ctx: DialogContext) => {
            removeFromBackground(props.sessionID, opt.value)
            route.navigate({
              type: "session",
              sessionID: opt.value,
              workspaceID: sync.session.get(opt.value)?.workspaceID,
            })
            ctx.clear()
          },
        }
      })}
      keybind={[
        {
          keybind: Keybind.parse("k")[0],
          title: "Cancel / Remove",
          onTrigger: (option) => {
            removeFromBackground(props.sessionID, option.value)
            if ((sync.data.session_status[option.value]?.type ?? "idle") !== "idle") {
              sdk.client.session.abort({ sessionID: option.value }).catch(() => {})
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
