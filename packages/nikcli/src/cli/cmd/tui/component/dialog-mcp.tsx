import { createMemo, createSignal, Show, Switch, Match } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync, type McpServerHealth, type McpReconnectState } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useSDK } from "@tui/context/sdk"
import type { McpStatus } from "@nikcli-ai/sdk/v2"

function HealthIndicator(props: { health?: McpServerHealth; reconnecting?: McpReconnectState }) {
  const { theme } = useTheme()

  return (
    <Show
      when={props.reconnecting}
      fallback={
        <Show when={props.health}>
          <text fg={props.health!.healthy ? theme.success : theme.error}>
            {props.health!.healthy ? "●" : "◌"}
          </text>
          <Show when={props.health!.latencyMs !== null}>
            <text fg={theme.textMuted}> {props.health!.latencyMs}ms</text>
          </Show>
        </Show>
      }
    >
      <text fg={theme.warning}>↻</text>
      <text fg={theme.textMuted}> {props.reconnecting!.attempt}/{props.reconnecting!.maxAttempts}</text>
    </Show>
  )
}

function StatusDisplay(props: {
  status: McpStatus
  enabled: boolean
  loading: boolean
  health?: McpServerHealth
  reconnecting?: McpReconnectState
}) {
  const { theme } = useTheme()

  if (props.loading) {
    return <text fg={theme.textMuted}>⋯ Loading</text>
  }

  return (
    <box flexDirection="row" gap={1}>
      <HealthIndicator health={props.health} reconnecting={props.reconnecting} />
      <Switch>
        <Match when={props.status.status === "connected"}>
          <text fg={theme.success}>✓</text>
        </Match>
        <Match when={props.status.status === "failed"}>
          <text fg={theme.error}>✗</text>
        </Match>
        <Match when={props.status.status === "needs_auth" || props.status.status === "needs_client_registration"}>
          <text fg={theme.warning}>⚠</text>
        </Match>
        <Match when={true}>
          <text fg={theme.textMuted}>○</text>
        </Match>
      </Switch>
    </box>
  )
}

function getStatusError(status: McpStatus): string | undefined {
  if (status.status === "failed" && "error" in status) {
    return status.error
  }
  return undefined
}

function StatusDescription(props: { status: McpStatus }) {
  const { theme } = useTheme()
  const error = getStatusError(props.status)

  return (
    <Switch>
      <Match when={props.status.status === "connected"}>
        <span style={{ fg: theme.success }}>Connected</span>
      </Match>
      <Match when={error !== undefined}>
        <span style={{ fg: theme.error }}>{error || "Connection failed"}</span>
      </Match>
      <Match when={props.status.status === "needs_auth"}>
        <span style={{ fg: theme.warning }}>Needs authentication</span>
      </Match>
      <Match when={props.status.status === "needs_client_registration"}>
        <span style={{ fg: theme.warning }}>Client registration required</span>
      </Match>
      <Match when={true}>
        <span style={{ fg: theme.textMuted }}>Disabled</span>
      </Match>
    </Switch>
  )
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const mcpData = sync.data.mcp
    const mcpHealth = sync.data.mcp_health
    const mcpReconnecting = sync.data.mcp_reconnecting
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: <StatusDescription status={status} />,
        footer: (
          <StatusDisplay
            status={status}
            enabled={local.mcp.isEnabled(name)}
            loading={loadingMcp === name}
            health={mcpHealth[name]}
            reconnecting={mcpReconnecting[name]}
          />
        ),
        category: undefined,
      })),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return <DialogSelect ref={setRef} title="MCPs" options={options()} keybind={keybinds()} onSelect={() => {}} />
}
