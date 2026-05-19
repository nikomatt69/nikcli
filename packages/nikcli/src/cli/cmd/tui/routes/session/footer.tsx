import { createMemo, Match, onCleanup, onMount, Show, Switch, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { withInstanceAsync } from "@/effect"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const instanceDirectory = () => sync.data.path.directory || process.cwd()
  const connected = useConnected()

  const [brainEnabled, setBrainEnabled] = createSignal<boolean | null>(null)
  const [brainLastAt, setBrainLastAt] = createSignal(0)
  const [brainSessionsPending, setBrainSessionsPending] = createSignal(0)

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
    const refreshBrainStatus = async () => {
      try {
        const { getBrainConfig, readLastBrainAt, getSessionsCountSince } = await import("@/brain")
        const { config, lastAt, count } = await withInstanceAsync({ directory: instanceDirectory() }, async () => {
          const config = await getBrainConfig()
          const lastAt = await readLastBrainAt()
          const count = await getSessionsCountSince(lastAt)
          return { config, lastAt, count }
        })
        setBrainEnabled(config.enabled)
        setBrainLastAt(lastAt)
        setBrainSessionsPending(count)
      } catch {
        setBrainEnabled(false)
        setBrainLastAt(0)
        setBrainSessionsPending(0)
      }

      return undefined
    }

    void refreshBrainStatus()
    const timer = setInterval(() => {
      void refreshBrainStatus()
    }, 60_000)

    onCleanup(() => clearInterval(timer))
  })

  const brainStatus = createMemo(() => {
    if (brainEnabled() !== true) return null
    const lastAt = brainLastAt()
    if (lastAt === 0) return { hours: 0, sessions: brainSessionsPending(), never: true }
    const hours = Math.round((Date.now() - lastAt) / 3_600_000)
    return { hours, sessions: brainSessionsPending(), never: false }
  })

  const activeCommand = createMemo(() => {
    if (route.data.type !== "session") return undefined
    const s = sync.session.get(route.data.sessionID)
    return s?.activeCommand
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
            <Show when={brainStatus()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.textMuted }}>Brain: </span>
                {brainStatus()!.never ? "never" : `${brainStatus()!.hours}h ago`}
                {brainStatus()!.sessions > 0 && (
                  <span style={{ fg: theme.success }}> ({brainStatus()!.sessions} sessions)</span>
                )}
              </text>
            </Show>
            <Show when={activeCommand()}>
              <text fg={theme.accent}>
                <span style={{ fg: theme.accent }}>◉</span> /{activeCommand()}
              </text>
            </Show>
            <Show when={brainEnabled() === null}>
              <text fg={theme.textMuted}>Brain: ...</text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
