import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Usage } from "../util/usage"
import type { SessionContextResponse } from "@nikcli-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const BAR_WIDTH = 40

type Breakdown = SessionContextResponse
type Source = Breakdown["sources"][number]

const CATEGORY_ORDER: Source["category"][] = [
  "system",
  "instructions",
  "skills",
  "mcp",
  "tools",
  "agents",
  "messages",
]

const CATEGORY_LABEL: Record<Source["category"], string> = {
  system: "System prompt",
  instructions: "Instructions",
  skills: "Skills · /skills",
  mcp: "MCP servers · /mcp",
  tools: "Tools",
  agents: "Agents · /agents",
  messages: "Conversation",
}

export function DialogUsage() {
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const dimensions = useTerminalDimensions()

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const [data, { mutate, refetch }] = createResource(sessionID, async (sid) => {
    const result = await sdk.client.session.context({ sessionID: sid })
    return result.data as Breakdown | undefined
  })

  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined

  // Sources ordered by category, in a stable display order.
  const sources = createMemo(() => {
    const all = data()?.sources ?? []
    return [...all].sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category)
      const cb = CATEGORY_ORDER.indexOf(b.category)
      if (ca !== cb) return ca - cb
      return b.tokens - a.tokens
    })
  })

  const contextLimit = createMemo(() => data()?.model?.contextLimit ?? 0)
  const reportedTotal = createMemo(() => data()?.reported.total ?? 0)
  const estimatedTotal = createMemo(() => data()?.estimatedTotal ?? 0)

  // Reserve a buffer for auto-compaction, matching the conversation runtime.
  const autocompactReserved = createMemo(() => (contextLimit() > 0 ? Math.min(20_000, contextLimit()) : 0))

  const segments = createMemo(() => {
    const limit = contextLimit()
    if (limit <= 0) return { used: BAR_WIDTH, reserved: 0, free: 0 }
    const usedRaw = Math.min(reportedTotal(), limit)
    const reservedRaw = Math.min(autocompactReserved(), Math.max(0, limit - usedRaw))
    const used = Math.max(0, Math.round((usedRaw / limit) * BAR_WIDTH))
    const reserved = Math.max(0, Math.round((reservedRaw / limit) * BAR_WIDTH))
    const free = Math.max(0, BAR_WIDTH - used - reserved)
    return { used, reserved, free }
  })

  function rowID(index: number) {
    return "ctx-row-" + index
  }

  function clamp(index: number) {
    const length = sources().length
    if (length === 0) return 0
    return Math.max(0, Math.min(index, length - 1))
  }

  function scrollToSelected(index: number) {
    if (!scroll) return
    const target = scroll.getChildren().find((child) => child.id === rowID(index))
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y < 0) scroll.scrollBy(y)
  }

  function move(direction: number) {
    const length = sources().length
    if (length === 0) return
    let next = selected() + direction
    if (next < 0) next = length - 1
    if (next >= length) next = 0
    setSelected(next)
    scrollToSelected(next)
  }

  async function toggle(source: Source) {
    if (!source.togglable || !source.toggleKind || !source.toggleKey) return
    const sid = sessionID()
    if (!sid || busy()) return
    setBusy(true)
    const nextEnabled = !source.enabled
    try {
      const result = await sdk.client.session.contextToggle({
        sessionID: sid,
        kind: source.toggleKind,
        key: source.toggleKey,
        enabled: nextEnabled,
      })
      if (result.data) mutate(result.data as Breakdown)
      toast.show({
        message: `${source.label} ${nextEnabled ? "enabled" : "disabled"}`,
        variant: "success",
      })
    } catch (err: any) {
      toast.show({ message: `Failed to toggle ${source.label}: ${err?.message ?? err}`, variant: "error" })
      void refetch()
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p") || evt.name === "k") {
      move(-1)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n") || evt.name === "j") {
      move(1)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "space" || evt.name === "return") {
      const source = sources()[clamp(selected())]
      if (source) {
        evt.preventDefault()
        evt.stopPropagation()
        void toggle(source)
      }
    }
  })

  const listHeight = createMemo(() => Math.max(5, dimensions().height - 18))

  function tokenPct(value: number) {
    const limit = contextLimit()
    if (limit > 0) return Usage.formatPct(value, limit)
    const total = estimatedTotal()
    return total > 0 ? Usage.formatPct(value, total) : "—"
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context Usage
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show
        when={data()?.model}
        fallback={
          <box>
            <Show
              when={!data.loading}
              fallback={<text fg={theme.textMuted}>Computing context breakdown…</text>}
            >
              <text fg={theme.textMuted}>No active session or no assistant messages yet.</text>
              <text fg={theme.textMuted}>Send a message to populate context usage.</text>
            </Show>
          </box>
        }
      >
        {(model) => (
          <>
            <box>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {model().name}
              </text>
              <text fg={theme.textMuted}>
                {model().providerID}/{model().modelID}
              </text>
              <text fg={theme.text}>
                <b>{Usage.formatTokens(reportedTotal())}</b>
                <span style={{ fg: theme.textMuted }}>
                  {" "}
                  / {Usage.formatTokens(model().contextLimit)} tokens reported{" "}
                  {contextLimit() > 0 && `(${Usage.formatPct(reportedTotal(), contextLimit())})`}
                </span>
              </text>
              <text fg={theme.textMuted}>
                ≈ {Usage.formatTokens(estimatedTotal())} tokens estimated across the sources below
              </text>
            </box>

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

            <scrollbox
              scrollbarOptions={{ visible: false }}
              ref={(r: ScrollBoxRenderable) => (scroll = r)}
              maxHeight={listHeight()}
            >
              <For each={sources()}>
                {(source, index) => {
                  const active = createMemo(() => index() === selected())
                  const prev = createMemo(() => sources()[index() - 1])
                  const showHeader = createMemo(() => index() === 0 || prev()?.category !== source.category)
                  const indicator = () => {
                    if (!source.togglable) return "•"
                    return source.enabled ? "[x]" : "[ ]"
                  }
                  const indicatorColor = () => {
                    if (!source.togglable) return theme.textMuted
                    return source.enabled ? theme.success : theme.textMuted
                  }
                  const labelColor = () => (source.enabled ? theme.text : theme.textMuted)
                  return (
                    <>
                      <Show when={showHeader()}>
                        <box paddingTop={index() > 0 ? 1 : 0}>
                          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                            {CATEGORY_LABEL[source.category]}
                          </text>
                        </box>
                      </Show>
                      <box
                        id={rowID(index())}
                        flexDirection="row"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={active() ? theme.backgroundElement : undefined}
                        onMouseUp={() => {
                          setSelected(index())
                          void toggle(source)
                        }}
                      >
                        <text flexShrink={0} fg={indicatorColor()}>
                          {indicator()}
                        </text>
                        <box flexGrow={1} flexShrink={1} flexDirection="row" justifyContent="space-between" gap={2}>
                          <text flexShrink={1} wrapMode="none" fg={labelColor()}>
                            <b>{source.label}</b>
                            <Show when={source.detail}>
                              <span style={{ fg: theme.textMuted }}> — {source.detail}</span>
                            </Show>
                          </text>
                          <text flexShrink={0} fg={source.enabled ? theme.text : theme.textMuted}>
                            {Usage.formatTokens(source.tokens)}
                            <span style={{ fg: theme.textMuted }}>
                              {" "}
                              {source.enabled ? tokenPct(source.tokens) : "(off)"}
                            </span>
                          </text>
                        </box>
                      </box>
                    </>
                  )
                }}
              </For>
            </scrollbox>

            <Show when={data()?.reported && reportedTotal() > 0}>
              <box flexDirection="row" flexWrap="wrap" gap={2}>
                <text fg={theme.textMuted}>
                  cache read {Usage.formatTokens(data()!.reported.cacheRead)}
                </text>
                <text fg={theme.textMuted}>
                  cache write {Usage.formatTokens(data()!.reported.cacheWrite)}
                </text>
                <text fg={theme.textMuted}>output {Usage.formatTokens(data()!.reported.output)}</text>
                <Show when={data()!.reported.reasoning > 0}>
                  <text fg={theme.textMuted}>reasoning {Usage.formatTokens(data()!.reported.reasoning)}</text>
                </Show>
              </box>
            </Show>

            <box paddingTop={1} flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
              <text fg={theme.textMuted}>↑↓ navigate</text>
              <text fg={theme.borderSubtle}>·</text>
              <text fg={busy() ? theme.warning : theme.textMuted}>{busy() ? "saving…" : "space toggle"}</text>
              <text fg={theme.borderSubtle}>·</text>
              <text fg={theme.textMuted}>esc close</text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
