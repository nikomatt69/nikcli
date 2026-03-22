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

function stripSubagentSuffix(title: string): string {
  return title.replace(/\s*\(@[^\s]+\s+subagent\)$/, "")
}

type BackgroundSubtasksMap = Record<string, string[]>

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
    const out: { title: string; value: string; description?: string; agent?: string }[] = []

    for (const id of backgroundedIDs()) {
      const session = sessionsByID.get(id)
      if (!session) continue

      const status = sync.data.session_status[id]?.type ?? "idle"
      const agent = parseSubagentFromTitle(session.title)
      const title = stripSubagentSuffix(session.title)

      out.push({ title, value: id, description: status, agent })
    }

    out.sort((a, b) => a.title.localeCompare(b.title))
    return out
  })

  function removeFromBackground(parentID: string, childID: string) {
    const map = (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
    const list = map[parentID] ?? []
    const next = list.filter((x) => x !== childID)
    if (next.length === list.length) return
    kv.set("background_subtasks", { ...map, [parentID]: next })
  }

  return (
    <DialogSelect
      title="Background Subtasks"
      options={options().map((opt) => {
        const color = opt.agent ? local.agent.color(opt.agent) : undefined
        return {
          title: opt.title,
          value: opt.value,
          description: opt.description,
          bg: color,
          gutter: opt.agent ? <text fg={color ?? theme.textMuted}>@{opt.agent}</text> : undefined,
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
          title: "Kill",
          onTrigger: (option) => {
            sdk.client.session.abort({ sessionID: option.value }).catch(() => {})
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
