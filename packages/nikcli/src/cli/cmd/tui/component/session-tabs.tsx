import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Logo } from "@tui/component/logo"
import { SplitBorder } from "@tui/component/border"
import { DialogSessionLink } from "@tui/component/dialog-session-link"
import { sessionLinkOf } from "@tui/util/session-link"

const MAX_OPEN_TABS = 12
const TAB_MIN_WIDTH = 12
const TAB_MAX_WIDTH = 28
const FIXED_CHROME_WIDTH = 17
const TAB_GAP = 1
const OVERFLOW_WIDTH = 6

export type SessionTabLayout = {
  ids: string[]
  hidden: number
  width: number
}

type OpenSessionTab = {
  id: string
  title: string
  workspaceID?: string
}

export function truncateTabTitle(title: string, width: number) {
  const clean = title.replace(/\s+/g, " ").trim() || "Untitled session"
  if (Bun.stringWidth(clean) <= width) return clean
  if (width <= 1) return "…"
  let result = ""
  for (const character of clean) {
    if (Bun.stringWidth(result + character) > width - 1) break
    result += character
  }
  return `${result}…`
}

export function layoutSessionTabs(
  ids: string[],
  activeID: string | undefined,
  terminalWidth: number,
): SessionTabLayout {
  const available = Math.max(TAB_MIN_WIDTH, terminalWidth - FIXED_CHROME_WIDTH)
  const initialCapacity = Math.max(1, Math.floor((available + TAB_GAP) / (TAB_MIN_WIDTH + TAB_GAP)))
  const capacity =
    ids.length > initialCapacity
      ? Math.max(1, Math.floor((available - OVERFLOW_WIDTH + TAB_GAP) / (TAB_MIN_WIDTH + TAB_GAP)))
      : initialCapacity
  const visibleCount = Math.min(ids.length, capacity)
  let start = Math.max(0, ids.length - visibleCount)

  if (activeID) {
    const activeIndex = ids.indexOf(activeID)
    if (activeIndex >= 0 && activeIndex < start) start = activeIndex
  }

  const visible = ids.slice(start, start + visibleCount)
  const hidden = ids.length - visible.length
  const overflowWidth = hidden > 0 ? OVERFLOW_WIDTH : 0
  const gapsWidth = Math.max(0, visible.length - 1) * TAB_GAP
  // Subtract 1 to leave a one-cell margin between tabs and the chrome
  // edge. The previous formula returned off-by-one values that
  // overflowed the terminal in practice; the -1 keeps the rendered
  // tabs within bounds while respecting TAB_MIN_WIDTH as a floor.
  const width = Math.max(
    TAB_MIN_WIDTH,
    Math.min(TAB_MAX_WIDTH, Math.floor((available - overflowWidth - gapsWidth) / Math.max(1, visible.length)) - 1),
  )
  return { ids: visible, hidden, width }
}

export function SessionTabs() {
  const route = useRoute()
  const sync = useSync()
  const kv = useKV()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [openTabs, setOpenTabs] = kv.signal<OpenSessionTab[]>("session_tabs_v2", [])

  function openLinkDialog(id: string) {
    dialog.replace(() => <DialogSessionLink sessionID={id} />)
  }

  const activeID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const openIDs = createMemo(() => openTabs().map((tab: OpenSessionTab) => tab.id))
  const layout = createMemo(() => layoutSessionTabs(openIDs(), activeID(), dimensions().width))
  const persistOpenTabs = (tabs: OpenSessionTab[]) => {
    // KV's public setter accepts values at runtime but currently exposes a nested Setter type.
    const persist = setOpenTabs as unknown as (value: OpenSessionTab[]) => void
    persist(tabs)
  }

  createEffect(() => {
    const id = activeID()
    if (!id) return
    const session = sync.session.get(id)
    const next: OpenSessionTab = {
      id,
      title: session?.title ?? `Session ${id.slice(-5)}`,
      workspaceID: route.data.workspaceID ?? session?.workspaceID,
    }
    const current = openTabs()
    const index = current.findIndex((tab: OpenSessionTab) => tab.id === id)
    if (index < 0) {
      persistOpenTabs([...current, next].slice(-MAX_OPEN_TABS))
      return
    }
    const previous = current[index]!
    if (previous.title === next.title && previous.workspaceID === next.workspaceID) return
    persistOpenTabs(current.map((tab: OpenSessionTab) => (tab.id === id ? next : tab)))
  })

  function open(id: string) {
    const tab = openTabs().find((candidate: OpenSessionTab) => candidate.id === id)
    const session = sync.session.get(id)
    route.navigate({
      type: "session",
      sessionID: id,
      workspaceID: tab?.workspaceID ?? session?.workspaceID,
    })
  }

  function createSession() {
    route.navigate({
      type: "home",
      workspaceID: route.data.workspaceID,
    })
  }

  function close(id: string) {
    const current = openTabs()
    const index = current.findIndex((tab: OpenSessionTab) => tab.id === id)
    const next = current.filter((tab: OpenSessionTab) => tab.id !== id)
    if (activeID() !== id) {
      persistOpenTabs(next)
      return
    }
    const fallback = next[Math.min(index, next.length - 1)]?.id
    batch(() => {
      persistOpenTabs(next)
      if (fallback) open(fallback)
      else createSession()
    })
  }

  function cycle(direction: 1 | -1) {
    const ids = openIDs()
    if (ids.length === 0) return
    const index = Math.max(0, ids.indexOf(activeID() ?? ""))
    open(ids[(index + direction + ids.length) % ids.length]!)
  }

  useKeyboard((event) => {
    if (!event.ctrl || event.name !== "tab") return
    event.preventDefault()
    cycle(event.shift ? -1 : 1)
  })

  return (
    <box
      flexShrink={0}
      height={4}
      width="100%"
      flexDirection="row"
      alignItems="center"
      backgroundColor={theme.backgroundPanel}
      border={["bottom"]}
      borderColor={theme.borderSubtle}
      overflow="hidden"
    >
      <box width={9} height={3} flexShrink={0} paddingTop={1} paddingBottom={1} paddingLeft={1} flexDirection="column">
        <Logo compact idle={false} />
      </box>
      <box flexDirection="row" flexGrow={1} minWidth={0} height={3} gap={TAB_GAP} overflow="hidden">
        <For each={layout().ids}>
          {(id) => {
            const selected = () => activeID() === id
            const tab = createMemo(() => openTabs().find((candidate: OpenSessionTab) => candidate.id === id))
            const session = createMemo(() => sync.session.get(id))
            const status = createMemo(() => sync.data.session_status[id]?.type ?? "idle")
            const statusColor = () =>
              status() === "busy" ? theme.info : status() === "retry" ? theme.warning : theme.textMuted
            const linkedID = createMemo(() => sessionLinkOf(kv, id))
            const title = () =>
              truncateTabTitle(
                session()?.title ?? tab()?.title ?? `Session ${id.slice(-5)}`,
                layout().width - 8 - (linkedID() ? 3 : 0),
              )
            return (
              <box
                width={layout().width}
                minWidth={TAB_MIN_WIDTH}
                flexShrink={0}
                height={3}
                flexDirection="row"
                paddingTop={1}
                paddingBottom={1}
                overflow="hidden"
                onMouseDown={() => open(id)}
                backgroundColor={selected() ? theme.backgroundElement : undefined}
                border={selected() ? ["left"] : undefined}
                borderColor={selected() ? theme.primary : undefined}
                customBorderChars={selected() ? SplitBorder.customBorderChars : undefined}
              >
                <text fg={statusColor()} wrapMode="none">
                  {` ${status() === "idle" ? "·" : "●"} `}
                </text>
                <Show when={linkedID()}>
                  <text
                    fg={theme.info}
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      openLinkDialog(id)
                    }}
                    wrapMode="none"
                  >
                    {"⇄ "}
                  </text>
                </Show>
                <text
                  fg={selected() ? theme.text : theme.textMuted}
                  attributes={selected() ? TextAttributes.BOLD : TextAttributes.DIM}
                  wrapMode="none"
                  flexGrow={1}
                >
                  {title()}
                </text>
                <Show when={selected()}>
                  <Show when={!linkedID()}>
                    <text
                      fg={theme.textMuted}
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        openLinkDialog(id)
                      }}
                      wrapMode="none"
                    >
                      {" ⇄ "}
                    </text>
                  </Show>
                  <text
                    fg={theme.textMuted}
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      close(id)
                    }}
                    wrapMode="none"
                  >
                    {" × "}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={layout().hidden > 0}>
          <box width={6} height={3} flexShrink={0} paddingTop={1} paddingBottom={1} flexDirection="column">
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {` ·· +${layout().hidden}`}
            </text>
          </box>
        </Show>
      </box>
      <box
        width={8}
        height={3}
        flexShrink={0}
        flexDirection="row"
        paddingTop={1}
        paddingBottom={1}
        justifyContent="center"
        onMouseDown={createSession}
        backgroundColor={route.data.type === "home" ? theme.backgroundElement : undefined}
        border={route.data.type === "home" ? ["left"] : undefined}
        borderColor={route.data.type === "home" ? theme.primary : undefined}
        customBorderChars={route.data.type === "home" ? SplitBorder.customBorderChars : undefined}
      >
        <text
          fg={route.data.type === "home" ? theme.primary : theme.textMuted}
          attributes={route.data.type === "home" ? TextAttributes.BOLD : undefined}
          wrapMode="none"
        >
          {" + new"}
        </text>
      </box>
    </box>
  )
}
