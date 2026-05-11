import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { For, Show, createSignal, createMemo, onMount } from "solid-js"
import type { Message, Provider, Session } from "@nikcli-ai/sdk/v2"

// Format helpers
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

// Types
interface SessionStats {
  sessionID: string
  title: string
  messages: number
  tokens: { input: number; output: number; reasoning: number; cache: number }
  cost: number
  model: string
  provider: string
  updated: number
  created: number
}

interface ProviderStats {
  providerID: string
  sessions: number
  messages: number
  tokens: { input: number; output: number; reasoning: number; cache: number }
  cost: number
  models: Set<string>
}

interface DayStats {
  date: string
  sessions: number
  tokens: number
  cost: number
}

// Color helper - convert RGBA to hex string
function colorToString(color: string | { r: number; g: number; b: number; a?: number }): string {
  if (typeof color === "string") return color
  const { r, g, b, a = 1 } = color
  if (a === 1) {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${Math.round(
    a * 255,
  )
    .toString(16)
    .padStart(2, "0")}`
}

// Box drawing characters
const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  cross: "┼",
  teeDown: "┬",
  teeUp: "┴",
  bullet: "◆",
  lineDownRight: "╰",
  lineDownLeft: "╯",
  lineUpRight: "╭",
  lineUpLeft: "╮",
}

// Line Chart Component
function LineChart(props: {
  data: { label: string; value: number }[]
  width: number
  height: number
  color: string
  title?: string
}) {
  const { theme } = useTheme()
  const colorStr = () => colorToString(props.color)

  const chart = createMemo(() => {
    const data = props.data
    if (data.length === 0) return { lines: [], xLabels: [], yLabels: [], max: 0 }

    const width = props.width
    const height = props.height

    const max = Math.max(...data.map((d) => d.value), 1)
    const min = 0

    // Build grid - rows are top to bottom (height rows, index 0 is top)
    const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => " "))

    // Draw Y-axis
    for (let y = 0; y < height; y++) {
      grid[y][0] = BOX.vertical
    }

    // Calculate points
    const padding = 2 // padding on left and right for labels
    const plotWidth = width - padding
    const points: { x: number; y: number; value: number }[] = data.map((d, i) => {
      const x = Math.round((i / (data.length - 1 || 1)) * (plotWidth - 1)) + padding
      const normalized = (d.value - min) / (max - min || 1)
      const y = Math.round((1 - normalized) * (height - 1))
      return { x, y: Math.max(0, Math.min(height - 1, y)), value: d.value }
    })

    // Draw the line with step pattern (┄ or ╱ ╲)
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y

      if (dx === 0) {
        // Vertical line
        const startY = Math.min(p1.y, p2.y)
        const endY = Math.max(p1.y, p2.y)
        for (let y = startY; y <= endY; y++) {
          grid[y][p1.x] = "│"
        }
      } else {
        // Horizontal then vertical (step pattern) - more readable
        for (let x = p1.x; x < p2.x; x++) {
          if (x >= 0 && x < width) {
            grid[p1.y][x] = "─"
          }
        }
        // Vertical connector
        const startY = Math.min(p1.y, p2.y)
        const endY = Math.max(p1.y, p2.y)
        for (let y = startY; y <= endY; y++) {
          if (y >= 0 && y < height && p2.x >= 0 && p2.x < width) {
            grid[y][p2.x] = "│"
          }
        }
      }
    }

    // Draw data points as dots
    for (const p of points) {
      if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
        grid[p.y][p.x] = "●"
      }
    }

    // Convert grid to lines
    const lines = grid.map((row) => row.join(""))

    // X-axis labels (show first, middle, last)
    const xLabels: { pos: number; label: string }[] = []
    if (data.length >= 1) {
      xLabels.push({ pos: points[0]?.x ?? 0, label: data[0].label })
    }
    if (data.length >= 3) {
      const midIdx = Math.floor(data.length / 2)
      xLabels.push({ pos: points[midIdx]?.x ?? 0, label: data[midIdx].label })
    }
    if (data.length >= 2) {
      xLabels.push({ pos: points[points.length - 1]?.x ?? 0, label: data[data.length - 1].label })
    }

    // Y-axis labels
    const yLabels: { pos: number; label: string }[] = []
    for (let i = 0; i <= 2; i++) {
      const value = min + ((max - min) * (2 - i)) / 2
      const y = Math.round((i / 2) * (height - 1))
      yLabels.push({ pos: y, label: formatTokens(value) })
    }

    return { lines, xLabels, yLabels, max }
  })

  return (
    <box gap={0}>
      <Show when={props.title}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
      </Show>
      <box flexDirection="row" gap={0}>
        {/* Y-axis labels */}
        <box flexDirection="column" gap={0}>
          <For each={chart().yLabels}>
            {(yl) => (
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD} width={6} wrapMode="none">
                {yl.label.padEnd(6)}
              </text>
            )}
          </For>
        </box>
        {/* Chart area */}
        <box flexDirection="column" gap={0}>
          <For each={chart().lines}>
            {(line) => (
              <text fg={colorStr()} wrapMode="none">
                {line}
              </text>
            )}
          </For>
          {/* X-axis labels */}
          {(() => {
            const xLabels = chart().xLabels
            let result = " "
            for (const xl of xLabels) {
              const spaces = Math.max(0, xl.pos - 1)
              result += " ".repeat(spaces) + xl.label + " "
            }
            const labelStr = String(result.trimEnd())
            return (
              <text fg={theme.textMuted} wrapMode="none">
                {labelStr}
              </text>
            )
          })()}
        </box>
      </box>
    </box>
  )
}

// Horizontal Bar Component
function HBar(props: { label: string; value: number; max: number; width: number; color: string }) {
  const { theme } = useTheme()
  const filled = createMemo(() => Math.max(1, Math.floor((props.value / props.max) * props.width)))
  const empty = createMemo(() => props.width - filled())
  const filledBars = createMemo(() => "█".repeat(filled()))
  const emptyBars = createMemo(() => "░".repeat(empty()))

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={theme.textMuted} width={8}>
        {props.label}
      </text>
      <text fg={props.color}>{filledBars()}</text>
      <text fg={props.color}>{emptyBars()}</text>
      <text fg={theme.textMuted}>{formatTokens(props.value)}</text>
    </box>
  )
}

// Global Stats Box Component
function GlobalStatsBox(props: { sessions: number; messages: number; cost: number; tokens: number }) {
  const { theme } = useTheme()
  const colorStr = (c: string) => colorToString(c)
  const h = BOX.horizontal

  // Calculate box width based on content
  const sessionsLabel = `Sessions: ${props.sessions}`
  const messagesLabel = `Messages: ${props.messages}`
  const costLabel = `Cost: ${money.format(props.cost)}`
  const tokensLabel = `Tokens: ${formatTokens(props.tokens)}`

  const maxLen = Math.max(sessionsLabel.length, messagesLabel.length, costLabel.length, tokensLabel.length)
  const boxWidth = maxLen + 8 // padding

  // Pre-compute spacing to avoid reactive expression issues
  const spacing1 = " ".repeat(maxLen - sessionsLabel.length + 1)
  const spacing2 = " ".repeat(maxLen - messagesLabel.length + 1)
  const spacing3 = " ".repeat(maxLen - costLabel.length + 1)
  const spacing4 = " ".repeat(maxLen - tokensLabel.length + 1)

  return (
    <box gap={0}>
      {/* Top border */}
      <text fg={theme.border} wrapMode="none">
        {BOX.topLeft}
        {h.repeat(boxWidth)}
        {BOX.teeDown}
        {h.repeat(boxWidth)}
        {BOX.teeDown}
        {h.repeat(boxWidth)}
        {BOX.teeDown}
        {h.repeat(boxWidth)}
        {BOX.topRight}
      </text>

      {/* Stats row */}
      <text fg={theme.border} wrapMode="none">
        {BOX.vertical}
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
          {" Sessions: "}
        </text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {props.sessions}
        </text>
        {spacing1}
        {BOX.vertical}
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
          {" Messages: "}
        </text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {props.messages}
        </text>
        {spacing2}
        {BOX.vertical}
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
          {" Cost: "}
        </text>
        <text fg={theme.success} attributes={TextAttributes.BOLD}>
          {money.format(props.cost)}
        </text>
        {spacing3}
        {BOX.vertical}
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
          {" Tokens: "}
        </text>
        <text fg={theme.warning} attributes={TextAttributes.BOLD}>
          {formatTokens(props.tokens)}
        </text>
        {spacing4}
        {BOX.vertical}
      </text>

      {/* Bottom border */}
      <text fg={theme.border} wrapMode="none">
        {BOX.bottomLeft}
        {h.repeat(boxWidth)}
        {BOX.cross}
        {h.repeat(boxWidth)}
        {BOX.cross}
        {h.repeat(boxWidth)}
        {BOX.cross}
        {h.repeat(boxWidth)}
        {BOX.bottomRight}
      </text>
    </box>
  )
}

// Section Header Component
function SectionHeader(props: { title: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        {props.icon || "◆"} {props.title}
      </text>
      <text fg={theme.borderSubtle}>{BOX.horizontal.repeat(20)}</text>
    </box>
  )
}

// Mini Sparkline Component
function Sparkline(props: { data: number[]; width: number; color: string }) {
  const colorStr = () => colorToString(props.color)

  const line = createMemo(() => {
    if (props.data.length === 0) return " ".repeat(props.width)
    const max = Math.max(...props.data, 1)
    const min = Math.min(...props.data, 0)
    const range = max - min || 1

    let result = ""
    for (let i = 0; i < props.width; i++) {
      const dataIdx = Math.floor((i / (props.width - 1)) * (props.data.length - 1))
      const value = props.data[dataIdx] ?? 0
      const normalized = (value - min) / range

      // Map to a vertical character
      const bucket = Math.floor(normalized * 4)
      const chars = ["▁", "▂", "▃", "▅", "▆", "▇", "█"]
      result += chars[Math.min(bucket, chars.length - 1)]
    }
    return result
  })

  return <text fg={colorStr()}>{line()}</text>
}

// Main Dialog
export function DialogAnalytics() {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()

  const [loading, setLoading] = createSignal(true)
  const [sessionStats, setSessionStats] = createSignal<SessionStats[]>([])
  const [providerStats, setProviderStats] = createSignal<Map<string, ProviderStats>>(new Map())
  const [dayStats, setDayStats] = createSignal<DayStats[]>([])
  const [totalStats, setTotalStats] = createSignal({
    sessions: 0,
    messages: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: 0 },
    cost: 0,
  })

  onMount(async () => {
    await loadAnalytics()
  })

  async function loadAnalytics() {
    setLoading(true)
    try {
      // Get all sessions from sync store
      const sessions = sync.data.session

      // Aggregate stats from each session's messages
      const statsMap = new Map<string, SessionStats>()
      const providerMap = new Map<string, ProviderStats>()
      const dayMap = new Map<string, DayStats>()

      let totalInput = 0
      let totalOutput = 0
      let totalReasoning = 0
      let totalCache = 0
      let totalCost = 0
      let totalMessages = 0

      for (const session of sessions) {
        const messages = sync.data.message[session.id] ?? []
        const assistantMessages = messages.filter((m) => m.role === "assistant")

        let sessionInput = 0
        let sessionOutput = 0
        let sessionReasoning = 0
        let sessionCache = 0
        let sessionCost = 0
        let lastModel = "unknown"
        let lastProvider = "unknown"

        for (const msg of assistantMessages) {
          if (msg.tokens) {
            sessionInput += msg.tokens.input || 0
            sessionOutput += msg.tokens.output || 0
            sessionReasoning += msg.tokens.reasoning || 0
            sessionCache += (msg.tokens.cache?.read || 0) + (msg.tokens.cache?.write || 0)
            totalMessages++
          }
          if (msg.cost) {
            sessionCost += msg.cost
            totalCost += msg.cost
          }
          if (msg.modelID) lastModel = msg.modelID
          if (msg.providerID) lastProvider = msg.providerID
        }

        totalInput += sessionInput
        totalOutput += sessionOutput
        totalReasoning += sessionReasoning
        totalCache += sessionCache

        const sessionTokens = sessionInput + sessionOutput + sessionReasoning
        const dateKey = new Date(session.time.updated).toISOString().split("T")[0]

        statsMap.set(session.id, {
          sessionID: session.id,
          title: session.title || session.id.slice(-8),
          messages: messages.length,
          tokens: {
            input: sessionInput,
            output: sessionOutput,
            reasoning: sessionReasoning,
            cache: sessionCache,
          },
          cost: sessionCost,
          model: lastModel,
          provider: lastProvider,
          updated: session.time.updated,
          created: session.time.created,
        })

        // Provider stats
        const pKey = lastProvider
        const pStats = providerMap.get(pKey) || {
          providerID: pKey,
          sessions: 0,
          messages: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: 0 },
          cost: 0,
          models: new Set<string>(),
        }
        pStats.sessions++
        pStats.messages += assistantMessages.length
        pStats.tokens.input += sessionInput
        pStats.tokens.output += sessionOutput
        pStats.tokens.reasoning += sessionReasoning
        pStats.tokens.cache += sessionCache
        pStats.cost += sessionCost
        pStats.models.add(lastModel)
        providerMap.set(pKey, pStats)

        // Day stats
        const dStats = dayMap.get(dateKey) || { date: dateKey, sessions: 0, tokens: 0, cost: 0 }
        dStats.sessions++
        dStats.tokens += sessionTokens
        dStats.cost += sessionCost
        dayMap.set(dateKey, dStats)
      }

      // Convert to sorted arrays
      const sortedSessions = Array.from(statsMap.values()).sort(
        (a, b) => b.tokens.input + b.tokens.output - (a.tokens.input + a.tokens.output),
      )

      const sortedDays = Array.from(dayMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14) // Last 14 days

      setSessionStats(sortedSessions.slice(0, 10))
      setProviderStats(providerMap)
      setDayStats(sortedDays)
      setTotalStats({
        sessions: sessions.length,
        messages: totalMessages,
        tokens: {
          input: totalInput,
          output: totalOutput,
          reasoning: totalReasoning,
          cache: totalCache,
        },
        cost: totalCost,
      })
    } catch (e) {
      console.error("Failed to load analytics:", e)
    } finally {
      setLoading(false)
    }
  }

  const totalTokens = createMemo(
    () => totalStats().tokens.input + totalStats().tokens.output + totalStats().tokens.reasoning,
  )

  const providers = createMemo(() => {
    const sorted = Array.from(providerStats().values()).sort((a, b) => b.cost - a.cost)
    return sorted
  })

  const maxDayTokens = createMemo(() => {
    const days = dayStats()
    if (days.length === 0) return 1
    return Math.max(...days.map((d) => d.tokens), 1)
  })

  const maxSessionTokens = createMemo(() => {
    const sessions = sessionStats()
    if (sessions.length === 0) return 1
    return Math.max(...sessions.map((s) => s.tokens.input + s.tokens.output + s.tokens.reasoning), 1)
  })

  const dayTokensData = createMemo(() =>
    dayStats().map((d) => ({
      label: d.date.slice(5), // "MM-DD"
      value: d.tokens,
    })),
  )

  const dayCostData = createMemo(() =>
    dayStats().map((d) => ({
      label: d.date.slice(5),
      value: d.cost,
    })),
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={0}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          ◈ Analytics
        </text>
        <text fg={theme.textMuted}>esc to close</text>
      </box>

      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading analytics...</text>
      </Show>

      <Show when={!loading()}>
        {/* Global Stats Box */}
        <GlobalStatsBox
          sessions={totalStats().sessions}
          messages={totalStats().messages}
          cost={totalStats().cost}
          tokens={totalTokens()}
        />

        {/* Token Breakdown with Sparkline */}
        <box gap={0}>
          <SectionHeader title="Token Breakdown" icon="◆" />
          <box flexDirection="row" gap={2}>
            {/* Bars */}
            <box flexDirection="column" gap={0} flexGrow={1}>
              <HBar
                label="input"
                value={totalStats().tokens.input}
                max={totalTokens()}
                width={20}
                color={colorToString(theme.primary)}
              />
              <HBar
                label="output"
                value={totalStats().tokens.output}
                max={totalTokens()}
                width={20}
                color={colorToString(theme.error)}
              />
              <HBar
                label="reason"
                value={totalStats().tokens.reasoning}
                max={totalTokens()}
                width={20}
                color={colorToString(theme.warning)}
              />
              <HBar
                label="cache"
                value={totalStats().tokens.cache}
                max={totalTokens()}
                width={20}
                color={colorToString(theme.textMuted)}
              />
            </box>
            {/* Mini sparkline */}
            <box justifyContent="center">
              <Sparkline data={dayStats().map((d) => d.tokens)} width={20} color={colorToString(theme.primary)} />
            </box>
          </box>
        </box>

        {/* Daily Usage - Line Chart */}
        <Show when={dayStats().length > 0}>
          <box gap={0}>
            <SectionHeader title="Daily Usage (14 days)" icon="◆" />
            <box flexDirection="row" gap={3}>
              {/* Tokens line chart */}
              <box flexGrow={1}>
                <LineChart
                  data={dayTokensData()}
                  width={25}
                  height={5}
                  color={colorToString(theme.primary)}
                  title="Tokens"
                />
              </box>
              {/* Cost bar chart */}
              <box flexGrow={1}>
                <LineChart
                  data={dayCostData()}
                  width={25}
                  height={5}
                  color={colorToString(theme.success)}
                  title="Cost ($)"
                />
              </box>
            </box>
          </box>
        </Show>

        {/* Provider Usage - Two columns */}
        <Show when={providers().length > 0}>
          <box gap={0}>
            <SectionHeader title="Provider Usage" icon="◆" />
            <box flexDirection="row" gap={3}>
              {/* Left column - Providers */}
              <box flexDirection="column" gap={0} flexGrow={1}>
                <For each={providers()}>
                  {(prov) => (
                    <box flexDirection="row" gap={1} alignItems="center">
                      <text fg={theme.primary} width={10}>
                        {prov.providerID}
                      </text>
                      <text fg={theme.textMuted} width={12}>
                        {prov.sessions}s / {prov.messages}m
                      </text>
                      <text fg={theme.success}>{money.format(prov.cost)}</text>
                    </box>
                  )}
                </For>
              </box>
              {/* Right column - Model list */}
              <box flexDirection="column" gap={0} flexGrow={1}>
                <For each={providers().slice(0, 3)}>
                  {(prov) => (
                    <box flexDirection="column" gap={0}>
                      <text fg={theme.text} attributes={TextAttributes.BOLD}>
                        {prov.providerID}
                      </text>
                      <For each={Array.from(prov.models).slice(0, 2)}>
                        {(model) => (
                          <text fg={theme.textMuted} paddingLeft={1}>
                            • {model}
                          </text>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            </box>
          </box>
        </Show>

        {/* Top Sessions */}
        <Show when={sessionStats().length > 0}>
          <box gap={0}>
            <SectionHeader title="Top Sessions" icon="◆" />
            <For each={sessionStats().slice(0, 5)}>
              {(session) => {
                const total = session.tokens.input + session.tokens.output + session.tokens.reasoning
                const pct = Math.round((total / maxSessionTokens()) * 100)
                const dashes = "─".repeat(Math.min(15, Math.floor(pct / 7)))
                return (
                  <box flexDirection="row" gap={1} alignItems="center">
                    <text fg={theme.text} width={14} wrapMode="none">
                      {session.title.slice(0, 14)}
                    </text>
                    <text fg={theme.primary} width={6}>
                      {pct}%
                    </text>
                    <text fg={theme.borderSubtle}>{dashes}</text>
                    <text fg={theme.textMuted} wrapMode="none">
                      {formatTokens(total)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  )
}
