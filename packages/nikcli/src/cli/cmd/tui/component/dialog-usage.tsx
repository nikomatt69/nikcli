import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import { Usage } from "../util/usage"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const BAR_WIDTH = 40

export function DialogUsage() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const usage = createMemo(() => {
    const sid = sessionID()
    const messages = sid ? (sync.data.message[sid] ?? []) : []
    return Usage.fromMessages(messages, sync.data.provider)
  })

  const contextLimit = createMemo(() => usage().model?.contextLimit ?? 0)

  const segments = createMemo(() => {
    const u = usage()
    const limit = contextLimit()
    if (limit <= 0) return { used: BAR_WIDTH, reserved: 0, free: 0 }
    const usedRaw = Math.min(u.tokens, limit)
    const reservedRaw = Math.min(u.autocompactReserved, Math.max(0, limit - usedRaw))
    const used = Math.max(0, Math.round((usedRaw / limit) * BAR_WIDTH))
    const reserved = Math.max(0, Math.round((reservedRaw / limit) * BAR_WIDTH))
    const free = Math.max(0, BAR_WIDTH - used - reserved)
    return { used, reserved, free }
  })

  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp))
  const customAgents = createMemo(() =>
    sync.data.agent.filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)),
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context Usage
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show
        when={usage().model}
        fallback={
          <box>
            <text fg={theme.textMuted}>No active session or no assistant messages yet.</text>
            <text fg={theme.textMuted}>Send a message to populate context usage.</text>
          </box>
        }
      >
        {(model) => (
          <box>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {model().name}
            </text>
            <text fg={theme.textMuted}>
              {model().providerID}/{model().modelID}
            </text>
            <text fg={theme.text}>
              <b>{Usage.formatTokens(usage().tokens)}</b>
              <span style={{ fg: theme.textMuted }}>
                {" "}
                / {Usage.formatTokens(model().contextLimit)} tokens{" "}
                {usage().percent !== undefined && `(${Usage.formatPct(usage().tokens, model().contextLimit)})`}
              </span>
            </text>
          </box>
        )}
      </Show>

      <Show when={contextLimit() > 0}>
        <box flexDirection="row">
          <text bg={theme.primary} fg={theme.primary}>
            {"█".repeat(segments().used)}
          </text>
          <text bg={theme.warning} fg={theme.warning}>
            {"█".repeat(segments().reserved)}
          </text>
          <text bg={theme.backgroundElement} fg={theme.backgroundElement}>
            {"█".repeat(segments().free)}
          </text>
        </box>
      </Show>

      <Show when={usage().model}>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Breakdown (from provider)
          </text>
          <For
            each={[
              { label: "Input", value: usage().components.input, color: theme.primary },
              { label: "Output", value: usage().components.output, color: theme.primary },
              { label: "Reasoning", value: usage().components.reasoning, color: theme.primary },
              { label: "Cache read", value: usage().components.cacheRead, color: theme.primary },
              { label: "Cache write", value: usage().components.cacheWrite, color: theme.primary },
              { label: "Autocompact buffer", value: usage().autocompactReserved, color: theme.warning },
              { label: "Free space", value: usage().free ?? 0, color: theme.textMuted },
            ]}
          >
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={item.color} flexShrink={0}>
                  •
                </text>
                <text fg={theme.text} wrapMode="none">
                  <b>{item.label}:</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {Usage.formatTokens(item.value)}
                    {contextLimit() > 0 && ` (${Usage.formatPct(item.value, contextLimit())})`}
                  </span>
                </text>
              </box>
            )}
          </For>
          <Show when={usage().cost > 0}>
            <text fg={theme.text}>
              <b>Cost:</b> <span style={{ fg: theme.textMuted }}>{money.format(usage().cost)}</span>
            </text>
          </Show>
        </box>
      </Show>

      <Show when={mcpEntries().length > 0} fallback={<text fg={theme.textMuted}>No MCP Servers</text>}>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            MCP · /mcp
          </text>
          <For each={mcpEntries()}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: (
                      {
                        connected: theme.success,
                        failed: theme.error,
                        disabled: theme.textMuted,
                        needs_auth: theme.warning,
                        needs_client_registration: theme.error,
                      } as Record<string, typeof theme.success>
                    )[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "disabled"}>Disabled</Match>
                      <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={customAgents().length > 0}>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Agents · /agents
          </text>
          <For each={customAgents()}>
            {(agent) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.success}>
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{agent.name}</b>
                  <Show when={agent.description}>
                    <span style={{ fg: theme.textMuted }}> — {agent.description}</span>
                  </Show>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
