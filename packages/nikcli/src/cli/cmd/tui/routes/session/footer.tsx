import { createMemo, Match, onCleanup, onMount, Show, Switch, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
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
        // `/brain` already computes exactly this triple — config, last run, sessions since — so
        // the footer asks for it instead of recomputing it from three in-process reads.
        const status = await sdk.client.brain.status()
        const data = status.data
        if (!data) throw new Error("no brain status")
        setBrainEnabled(data.enabled)
        setBrainLastAt(data.lastBrainAt ?? 0)
        setBrainSessionsPending(data.sessionsSinceLastBrain)
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
      <text fg={theme.foreground.muted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.foreground.default}>
              Get started <span style={{ fg: theme.foreground.muted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.status.warning.fg}>
                <span style={{ fg: theme.status.warning.fg }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <Show when={brainStatus()}>
              <text fg={theme.foreground.default}>
                <span style={{ fg: theme.foreground.muted }}>Brain: </span>
                {brainStatus()!.never ? "never" : `${brainStatus()!.hours}h ago`}
                {brainStatus()!.sessions > 0 && (
                  <span style={{ fg: theme.status.success.fg }}> ({brainStatus()!.sessions} sessions)</span>
                )}
              </text>
            </Show>
            <Show when={activeCommand()}>
              <text fg={theme.accent.alt}>
                <span style={{ fg: theme.accent.alt }}>◉</span> /{activeCommand()}
              </text>
            </Show>
            <Show when={brainEnabled() === null}>
              <text fg={theme.foreground.muted}>Brain: ...</text>
            </Show>
            <text fg={theme.foreground.default}>
              <span style={{ fg: lsp().length > 0 ? theme.status.success.fg : theme.foreground.muted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.foreground.default}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.status.error.fg }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.status.success.fg }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.foreground.muted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
