import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSessionTabs, type SessionTabState } from "@tui/context/session-tabs"
import { useTheme } from "@tui/context/theme"
import { Logo } from "@tui/component/logo"
import { SplitBorder } from "@tui/component/border"
import { DialogSessionLink } from "@tui/component/dialog-session-link"
import { sessionLinkOf } from "@tui/util/session-link"

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
  const tabs = useSessionTabs()

  function openLinkDialog(id: string) {
    dialog.replace(() => <DialogSessionLink sessionID={id} />)
  }

  const activeID = tabs.active
  const byID = createMemo(() => new Map(tabs.list().map((tab) => [tab.id, tab])))
  const layout = createMemo(() => layoutSessionTabs(tabs.ids(), activeID(), dimensions().width))

  useKeyboard((event) => {
    if (!event.ctrl) return
    if (event.name === "tab") {
      event.preventDefault()
      tabs.cycle(event.shift ? -1 : 1)
      return
    }
    // Ctrl-O steps back through focused tabs, browser style.
    //
    // Forward has no key binding on purpose. Ctrl-I — the obvious pair, and what editors use — is
    // encoded by terminals as ASCII TAB, so it arrives indistinguishable from the Ctrl+Tab handled
    // above and would silently cycle instead of stepping forward. Ctrl+Shift+O was tried and could
    // not be shown to reach this handler, and no other binding in this TUI relies on shift with a
    // letter. Rather than ship a key that quietly does nothing, forward stays available through
    // `tabs.forward()` (plugins reach it via `ui.tabs`) until it can be wired to a leader chord
    // through the keybind config, the way `session_new` is.
    if (event.name === "o") {
      event.preventDefault()
      tabs.back()
    }
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
            const state = createMemo<SessionTabState | undefined>(() => byID().get(id))
            const selected = () => state()?.active === true
            const session = createMemo(() => sync.session.get(id))
            const status = createMemo(() => sync.data.session_status[id]?.type ?? "idle")
            // Semantic precedence: what blocks the user outranks what is merely running, which
            // outranks work they have not looked at yet. Only one marker fits in a tab.
            const marker = createMemo(() => {
              if (state()?.attention) return { glyph: "◆", color: theme.warning }
              if (state()?.busy || status() === "busy") return { glyph: "●", color: theme.info }
              if (status() === "retry") return { glyph: "●", color: theme.warning }
              if (state()?.unread) return { glyph: "●", color: theme.primary }
              return { glyph: "·", color: theme.textMuted }
            })
            const linkedID = createMemo(() => sessionLinkOf(kv, id))
            const title = () =>
              truncateTabTitle(
                session()?.title ?? state()?.title ?? `Session ${id.slice(-5)}`,
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
                onMouseDown={() => tabs.open(id)}
                backgroundColor={selected() ? theme.backgroundElement : undefined}
                border={selected() ? ["left"] : undefined}
                borderColor={selected() ? theme.primary : undefined}
                customBorderChars={selected() ? SplitBorder.customBorderChars : undefined}
              >
                <text fg={marker().color} wrapMode="none">
                  {` ${marker().glyph} `}
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
                      tabs.close(id)
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
        onMouseDown={tabs.createSession}
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
