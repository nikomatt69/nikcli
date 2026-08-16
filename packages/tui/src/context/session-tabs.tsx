import {
  batch,
  createContext,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from "solid-js"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"

export const MAX_OPEN_TABS = 12
// Long enough for the initial route render and first paint to settle before we start fetching.
const TAB_PREFETCH_DELAY_MS = 300

export type OpenSessionTab = {
  id: string
  title: string
  workspaceID?: string
}

/** What a tab is doing right now, for both the tab strip and the plugin-facing `ui.tabs` API. */
export type SessionTabState = OpenSessionTab & {
  /** The tab currently shown. */
  active: boolean
  /** A turn is running in this tab. */
  busy: boolean
  /** Blocked on the user: a permission request or a question is waiting. */
  attention: boolean
  /** Finished work this tab has not been looked at since. */
  unread: boolean
}

export type SessionTabsContext = {
  list(): SessionTabState[]
  ids(): string[]
  active(): string | undefined
  open(sessionID: string): void
  close(sessionID: string): void
  /** Closes every open tab and lands on the home route. No-op when nothing is open. */
  closeAll(): void
  cycle(direction: 1 | -1): void
  /** Browser-style history over focused tabs. */
  back(): boolean
  forward(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  createSession(): void
  persist(tabs: OpenSessionTab[]): void
}

const ctx = createContext<SessionTabsContext>()

export function SessionTabsProvider(props: ParentProps) {
  const route = useRoute()
  const sync = useSync()
  const kv = useKV()
  const [openTabs, setOpenTabs] = kv.signal<OpenSessionTab[]>("session_tabs_v2", [])

  const active = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const ids = createMemo(() => openTabs().map((tab: OpenSessionTab) => tab.id))

  const persist = (tabs: OpenSessionTab[]) => {
    // KV's public setter accepts values at runtime but currently exposes a nested Setter type.
    const write = setOpenTabs as unknown as (value: OpenSessionTab[]) => void
    write(tabs)
  }

  // Focus history is process-local on purpose: restoring a previous session's back-stack across
  // restarts would let Ctrl-O jump to tabs the user never opened this run.
  let history: string[] = []
  let cursor = -1
  // Set while history navigation is driving the route, so the observer below does not record the
  // move it just performed as a new entry (which would make back/forward walk in circles).
  let navigating = false

  const recordFocus = (id: string) => {
    if (navigating) return
    if (history[cursor] === id) return
    // A fresh selection truncates the forward branch, exactly like a browser.
    history = history.slice(0, cursor + 1)
    history.push(id)
    cursor = history.length - 1
  }

  const step = (direction: -1 | 1) => {
    const open = new Set(ids())
    let next = cursor + direction
    // Closed tabs stay in history but must be skipped rather than navigated to.
    while (next >= 0 && next < history.length && !open.has(history[next]!)) next += direction
    if (next < 0 || next >= history.length) return false
    const target = history[next]!
    cursor = next
    navigating = true
    try {
      open_(target)
    } finally {
      navigating = false
    }
    return true
  }

  const canStep = (direction: -1 | 1) => {
    const open = new Set(ids())
    let next = cursor + direction
    while (next >= 0 && next < history.length && !open.has(history[next]!)) next += direction
    return next >= 0 && next < history.length
  }

  function open_(id: string) {
    const tab = openTabs().find((candidate: OpenSessionTab) => candidate.id === id)
    const session = sync.session.get(id)
    route.navigate({
      type: "session",
      sessionID: id,
      workspaceID: tab?.workspaceID ?? session?.workspaceID,
    })
  }

  function createSession() {
    route.navigate({ type: "home", workspaceID: route.data.workspaceID })
  }

  function close(id: string) {
    const current = openTabs()
    const index = current.findIndex((tab: OpenSessionTab) => tab.id === id)
    const next = current.filter((tab: OpenSessionTab) => tab.id !== id)
    if (active() !== id) {
      persist(next)
      return
    }
    // Prefer where the user came from; the neighbour is only a fallback.
    const previous = history
      .slice(0, cursor)
      .reverse()
      .find((candidate) => candidate !== id && next.some((tab: OpenSessionTab) => tab.id === candidate))
    const fallback = previous ?? next[Math.min(index, next.length - 1)]?.id
    batch(() => {
      persist(next)
      if (fallback) open_(fallback)
      else createSession()
    })
  }

  function closeAll() {
    if (openTabs().length === 0) return
    // Focus history is left alone: `step` already skips ids that are no longer open, so with an
    // empty tab list back/forward simply report that there is nowhere to go.
    batch(() => {
      persist([])
      createSession()
    })
  }

  function cycle(direction: 1 | -1) {
    const all = ids()
    if (all.length === 0) return
    const index = Math.max(0, all.indexOf(active() ?? ""))
    open_(all[(index + direction + all.length) % all.length]!)
  }

  // Keep the persisted tab list in step with wherever the route currently is, and record the focus.
  createEffect(() => {
    const id = active()
    if (!id) return
    const session = sync.session.get(id)
    const next: OpenSessionTab = {
      id,
      title: session?.title ?? `Session ${id.slice(-5)}`,
      workspaceID: route.data.workspaceID ?? session?.workspaceID,
    }
    recordFocus(id)
    const current = openTabs()
    const index = current.findIndex((tab: OpenSessionTab) => tab.id === id)
    if (index < 0) {
      persist([...current, next].slice(-MAX_OPEN_TABS))
      return
    }
    const previous = current[index]!
    if (previous.title === next.title && previous.workspaceID === next.workspaceID) return
    persist(current.map((tab: OpenSessionTab) => (tab.id === id ? next : tab)))
  })

  // Sessions whose work finished while the user was looking elsewhere. Cleared on focus.
  const seen = new Map<string, string>()
  const unread = (id: string) => {
    const messages = sync.data.message[id] ?? []
    const last = messages.at(-1)?.id
    if (!last) return false
    if (active() === id) {
      seen.set(id, last)
      return false
    }
    return seen.get(id) !== undefined && seen.get(id) !== last
  }

  const list = createMemo<SessionTabState[]>(() =>
    openTabs().map((tab: OpenSessionTab) => {
      const status = sync.session.status(tab.id)
      const blocked = (sync.data.permission[tab.id]?.length ?? 0) > 0 || (sync.data.question[tab.id]?.length ?? 0) > 0
      return {
        ...tab,
        active: active() === tab.id,
        busy: status === "working" || status === "compacting",
        attention: blocked,
        unread: unread(tab.id),
      }
    }),
  )

  // Warm open tabs in the background shortly after mount. Without this, the first switch to a
  // never-visited tab runs `session.sync` inside the switch gesture and leaves the transcript blank
  // until it resolves; afterwards the store already holds the data and the switch is immediate.
  // Sequential on purpose — a parallel fan-out over a full tab strip is a request storm.
  onMount(() => {
    const timer = setTimeout(async () => {
      for (const id of ids()) {
        if (id === active()) continue
        // `sync` returns early on a cache hit, so clicking faster than the warm-up just falls back
        // to the old behaviour rather than fetching twice.
        await sync.session.sync(id).catch(() => undefined)
      }
    }, TAB_PREFETCH_DELAY_MS)
    onCleanup(() => clearTimeout(timer))
  })

  const value: SessionTabsContext = {
    list,
    ids,
    active,
    open: open_,
    close,
    closeAll,
    cycle,
    back: () => step(-1),
    forward: () => step(1),
    canGoBack: () => canStep(-1),
    canGoForward: () => canStep(1),
    createSession,
    persist,
  }

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useSessionTabs(): SessionTabsContext {
  const value = useContext(ctx)
  if (!value) throw new Error("useSessionTabs must be used within a SessionTabsProvider")
  return value
}
