import { createMemo, Match, onCleanup, onMount, Show, Switch, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useKV } from "../../context/kv"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const kv = useKV()
  const connectedMcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const unhealthyMcp = createMemo(() => Object.values(sync.data.mcp_health).filter((x) => !x.healthy).length)
  const reconnectingMcp = createMemo(() => Object.keys(sync.data.mcp_reconnecting).length)
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const dreamEnabled = createMemo(() => kv.get("dream_enabled", true))
  const [dreamLastAt, setDreamLastAt] = createSignal(0)
  const [dreamSessionsPending, setDreamSessionsPending] = createSignal(0)

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    const timer = setInterval(
      () => {
        if (connected()) return
        setStore("welcome", (prev) => !prev)
      },
      store.welcome ? 5000 : 10_000,
    )

    onCleanup(() => clearInterval(timer))
  })

  onMount(() => {
    void (async () => {
      try {
        const { readLastDreamAt, getSessionsCountSince } = await import("@/dream")
        const lastAt = await readLastDreamAt()
        setDreamLastAt(lastAt)
        if (lastAt > 0) {
          const count = await getSessionsCountSince(lastAt)
          setDreamSessionsPending(count)
        }
      } catch {
        // dream not available
      }
    })()
  })

  const dreamStatus = createMemo(() => {
    if (!dreamEnabled()) return null
    const lastAt = dreamLastAt()
    if (lastAt === 0) return { hours: 0, sessions: 0, never: true }
    const hours = Math.round((Date.now() - lastAt) / 3_600_000)
    return { hours, sessions: dreamSessionsPending(), never: false }
  })

  const vimModeEnabled = createMemo(() => kv.get("vim_mode", false))

  const mcpStatusIcon = createMemo(() => {
    if (unhealthyMcp() > 0) return { icon: "◌", color: theme.error }
    if (reconnectingMcp() > 0) return { icon: "↻", color: theme.warning }
    if (connectedMcp() > 0) return { icon: "●", color: theme.success }
    return { icon: "○", color: theme.textMuted }
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <Show when={dreamEnabled() && dreamStatus()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.textMuted }}>Dream: </span>
                {dreamStatus()!.never ? "never" : `${dreamStatus()!.hours}h ago`}
                {dreamStatus()!.sessions > 0 && (
                  <span style={{ fg: theme.success }}> ({dreamStatus()!.sessions} sessions)</span>
                )}
              </text>
            </Show>
            <Show when={dreamEnabled() && !dreamStatus()}>
              <text fg={theme.textMuted}>Dream: ...</text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={connectedMcp() > 0 || unhealthyMcp() > 0 || reconnectingMcp() > 0}>
              <text fg={theme.text}>
                <span style={{ fg: mcpStatusIcon().color }}>{mcpStatusIcon().icon}</span> {connectedMcp()} MCP
                <Show when={unhealthyMcp() > 0}>
                  <span style={{ fg: theme.textMuted }}>({unhealthyMcp()} unhealthy)</span>
                </Show>
                <Show when={reconnectingMcp() > 0}>
                  <span style={{ fg: theme.warning }}>({reconnectingMcp()} reconnecting)</span>
                </Show>
              </text>
            </Show>
            <Show when={vimModeEnabled()}>
              <text fg={theme.primary}>
                <span style={{ bold: true }}>VIM</span>
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
