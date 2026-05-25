import { TextAttributes, RGBA } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show, Switch, Match } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useTheme, type Theme } from "@tui/context/theme"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "@tui/ui/toast"
import { createTwoFilesPatch } from "diff"
import type {
  OpenTUIVizSpecType,
  VizComponent,
  VizLeaf,
  VizColorToken,
  VizNumberFormat,
  VizSeverity,
  VizTreeNode,
  VizThreshold,
} from "@/tool/opentui"

export type DialogOpenTUIVizProps = {
  spec: OpenTUIVizSpecType
}

// ──────────────────────────────────────────────────────────────────────────
// Discriminated extractors
// ──────────────────────────────────────────────────────────────────────────

type Of<T extends VizComponent["type"]> = Extract<VizComponent, { type: T }>

const TYPE_LABEL: Record<VizComponent["type"], string> = {
  text: "Text",
  markdown: "Notes",
  code: "Code",
  diff: "Diff",
  alert: "Alert",
  table: "Table",
  key_value: "Properties",
  tree: "Tree",
  stat: "Stat",
  stat_grid: "Metrics",
  bar_chart: "Bars",
  line_chart: "Trend",
  histogram: "Histogram",
  heatmap: "Heatmap",
  gauge: "Gauge",
  progress_bars: "Progress",
  timeline: "Timeline",
  status_grid: "Status",
  section: "Section",
  grid: "Grid",
}

const TYPE_ICON: Record<VizComponent["type"], string> = {
  text: "¶",
  markdown: "M↓",
  code: "</>",
  diff: "±",
  alert: "!",
  table: "▦",
  key_value: "≡",
  tree: "⇲",
  stat: "▤",
  stat_grid: "▤▤",
  bar_chart: "▮",
  line_chart: "∿",
  histogram: "▥",
  heatmap: "▩",
  gauge: "◔",
  progress_bars: "▰",
  timeline: "⋮",
  status_grid: "⊞",
  section: "§",
  grid: "▦▦",
}

function tabLabel(comp: VizComponent): string {
  const title = "title" in comp ? comp.title : undefined
  if (title) return title
  return TYPE_LABEL[comp.type] ?? comp.type
}

// ──────────────────────────────────────────────────────────────────────────
// Color resolver
// ──────────────────────────────────────────────────────────────────────────

function resolveColor(theme: Theme, token: VizColorToken | undefined): RGBA {
  switch (token) {
    case "primary":
      return theme.primary
    case "secondary":
      return theme.secondary
    case "accent":
      return theme.accent
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "info":
      return theme.info
    case "muted":
      return theme.textMuted
    case "default":
    default:
      return theme.text
  }
}

function severityColor(theme: Theme, sev: VizSeverity): RGBA {
  switch (sev) {
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "info":
      return theme.info
  }
}

const SEVERITY_ICON: Record<VizSeverity, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
}

// ──────────────────────────────────────────────────────────────────────────
// Number / sparkline helpers
// ──────────────────────────────────────────────────────────────────────────

const SPARK_CHARS = "▁▂▃▄▅▆▇█"

function sparkline(values: ReadonlyArray<number>): string {
  if (values.length === 0) return ""
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  let out = ""
  for (const v of values) {
    const idx = Math.max(0, Math.min(SPARK_CHARS.length - 1, Math.floor(((v - min) / range) * (SPARK_CHARS.length - 1))))
    out += SPARK_CHARS[idx]
  }
  return out
}

function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + "T"
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return abs < 1 && abs > 0 ? n.toPrecision(2) : n.toString()
}

function formatBytes(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1024 ** 4) return (n / 1024 ** 4).toFixed(2) + " TB"
  if (abs >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB"
  if (abs >= 1024 ** 2) return (n / 1024 ** 2).toFixed(2) + " MB"
  if (abs >= 1024) return (n / 1024).toFixed(1) + " KB"
  return n + " B"
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1) return ms.toFixed(2) + "ms"
  if (abs < 1000) return ms.toFixed(1) + "ms"
  if (abs < 60_000) return (ms / 1000).toFixed(2) + "s"
  if (abs < 3_600_000) return (ms / 60_000).toFixed(1) + "m"
  if (abs < 86_400_000) return (ms / 3_600_000).toFixed(1) + "h"
  return (ms / 86_400_000).toFixed(1) + "d"
}

function formatValue(value: string | number, format?: VizNumberFormat, unit?: string): string {
  if (typeof value === "string") return unit ? `${value}${unit}` : value
  const n = value
  let str: string
  switch (format) {
    case "compact":
      str = formatCompact(n)
      break
    case "percent":
      str = `${(n * 100).toFixed(Math.abs(n * 100) < 10 ? 1 : 0)}%`
      break
    case "currency":
      try {
        str = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
        }).format(n)
      } catch {
        str = `$${n.toFixed(2)}`
      }
      break
    case "bytes":
      str = formatBytes(n)
      break
    case "duration":
      str = formatDuration(n)
      break
    case "plain":
    default:
      str = Math.abs(n) >= 10_000 ? n.toLocaleString("en-US") : n.toString()
  }
  return unit && format !== "percent" && format !== "currency" && format !== "bytes" && format !== "duration"
    ? `${str}${unit}`
    : unit && (format === "percent" || format === "currency")
      ? str // unit already implicit
      : unit
        ? `${str} ${unit}`
        : str
}

function thresholdColor(
  theme: Theme,
  pctOrValue: number,
  thresholds: ReadonlyArray<VizThreshold> | undefined,
  defaultColor: RGBA,
): RGBA {
  if (!thresholds || thresholds.length === 0) return defaultColor
  const sorted = [...thresholds].sort((a, b) => a.at - b.at)
  let color = defaultColor
  for (const t of sorted) {
    if (pctOrValue >= t.at) color = resolveColor(theme, t.color)
  }
  return color
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Text
// ──────────────────────────────────────────────────────────────────────────

function Title(props: { title?: string }) {
  const { theme } = useTheme()
  return (
    <Show when={props.title}>
      <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
    </Show>
  )
}

function TextRenderer(props: { comp: Of<"text"> }) {
  const { theme, syntax } = useTheme()
  const fg = createMemo(() => {
    switch (props.comp.style) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      case "info":
        return theme.primary
      case "muted":
        return theme.textMuted
      default:
        return theme.text
    }
  })
  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <Show
        when={props.comp.style === "code"}
        fallback={
          <text fg={fg()} wrapMode="word">
            {props.comp.content}
          </text>
        }
      >
        <markdown
          content={"```\n" + props.comp.content + "\n```"}
          syntaxStyle={syntax()}
          fg={theme.text}
          conceal={false}
          concealCode={false}
        />
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Markdown
// ──────────────────────────────────────────────────────────────────────────

function MarkdownRenderer(props: { comp: Of<"markdown"> }) {
  const { theme, syntax } = useTheme()
  const dims = useTerminalDimensions()
  const tight = createMemo(() => dims().width < 84)
  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <markdown
        content={props.comp.content}
        syntaxStyle={syntax()}
        fg={theme.text}
        conceal={true}
        concealCode={false}
        tableOptions={{
          widthMode: "full",
          wrapMode: "word",
          cellPadding: tight() ? 0 : 1,
          borders: true,
          outerBorder: !tight(),
          borderColor: theme.borderSubtle,
        }}
      />
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Code
// ──────────────────────────────────────────────────────────────────────────

function CodeRenderer(props: { comp: Of<"code"> }) {
  const { theme, syntax } = useTheme()
  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <Show
        when={props.comp.showLineNumbers}
        fallback={
          <code
            content={props.comp.content}
            filetype={props.comp.filetype}
            syntaxStyle={syntax()}
            fg={theme.text}
            conceal={false}
          />
        }
      >
        <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
          <code
            content={props.comp.content}
            filetype={props.comp.filetype}
            syntaxStyle={syntax()}
            fg={theme.text}
            conceal={false}
          />
        </line_number>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Diff
// ──────────────────────────────────────────────────────────────────────────

function DiffRenderer(props: { comp: Of<"diff"> }) {
  const { theme, syntax } = useTheme()
  const dims = useTerminalDimensions()
  const patch = createMemo(() =>
    createTwoFilesPatch(
      props.comp.title ?? "before",
      props.comp.title ?? "after",
      props.comp.before,
      props.comp.after,
      "",
      "",
      { context: 3 },
    ),
  )
  const view = createMemo<"unified" | "split">(() => {
    const mode = props.comp.mode
    if (mode === "split") return dims().width >= 100 ? "split" : "unified"
    return mode ?? "unified"
  })
  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <diff
        diff={patch()}
        view={view()}
        filetype={props.comp.filetype ?? "diff"}
        syntaxStyle={syntax()}
        fg={theme.text}
        wrapMode="word"
        showLineNumbers={true}
        addedBg={theme.diffAddedBg}
        removedBg={theme.diffRemovedBg}
        contextBg={theme.diffContextBg}
        addedSignColor={theme.diffAdded}
        removedSignColor={theme.diffRemoved}
        lineNumberFg={theme.diffLineNumber}
      />
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Alert
// ──────────────────────────────────────────────────────────────────────────

function AlertRenderer(props: { comp: Of<"alert"> }) {
  const { theme } = useTheme()
  const color = createMemo(() => severityColor(theme, props.comp.severity))
  return (
    <box
      border
      borderColor={color()}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
    >
      <box flexDirection="row" gap={1}>
        <text fg={color()} attributes={TextAttributes.BOLD}>
          {SEVERITY_ICON[props.comp.severity]}
        </text>
        <Show
          when={props.comp.title}
          fallback={
            <text fg={theme.text} wrapMode="word" flexGrow={1}>
              {props.comp.message}
            </text>
          }
        >
          <text fg={color()} attributes={TextAttributes.BOLD}>
            {props.comp.title}
          </text>
        </Show>
      </box>
      <Show when={props.comp.title}>
        <text fg={theme.text} wrapMode="word">
          {props.comp.message}
        </text>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Table
// ──────────────────────────────────────────────────────────────────────────

function statusToColor(theme: Theme, status: VizColorToken | undefined): RGBA {
  return resolveColor(theme, status)
}

function TableRenderer(props: { comp: Of<"table"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const align = createMemo(() => props.comp.align ?? [])
  const colCount = createMemo(() => props.comp.headers.length)
  const tight = createMemo(() => dims().width < 84)

  // Per-column max content width
  const colWidths = createMemo(() => {
    const widths: number[] = props.comp.headers.map((h) => h.length)
    for (const row of props.comp.rows) {
      for (let i = 0; i < colCount(); i++) {
        const cell = (row[i] ?? "").toString()
        if (cell.length > widths[i]) widths[i] = cell.length
      }
    }
    if (props.comp.totals) {
      for (let i = 0; i < colCount(); i++) {
        const cell = (props.comp.totals[i] ?? "").toString()
        if (cell.length > widths[i]) widths[i] = cell.length
      }
    }
    return widths
  })

  function padCell(value: string, idx: number): string {
    const width = colWidths()[idx] ?? value.length
    const a = align()[idx] ?? "left"
    if (a === "right") return value.padStart(width)
    if (a === "center") {
      const total = width - value.length
      const left = Math.floor(total / 2)
      const right = total - left
      return " ".repeat(Math.max(0, left)) + value + " ".repeat(Math.max(0, right))
    }
    return value.padEnd(width)
  }

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      {/* Header row */}
      <box flexDirection="row" gap={tight() ? 1 : 2}>
        <For each={props.comp.headers}>
          {(h, i) => (
            <text fg={theme.secondary} attributes={TextAttributes.BOLD} flexShrink={0}>
              {padCell(h, i())}
            </text>
          )}
        </For>
      </box>
      {/* Separator */}
      <box flexDirection="row" gap={tight() ? 1 : 2}>
        <For each={props.comp.headers}>
          {(_, i) => (
            <text fg={theme.borderSubtle} flexShrink={0}>
              {"─".repeat(colWidths()[i()] ?? 3)}
            </text>
          )}
        </For>
      </box>
      {/* Rows */}
      <For each={props.comp.rows}>
        {(row, rIdx) => {
          const rowColor = createMemo(() => {
            const tok = props.comp.rowColors?.[rIdx()]
            return tok ? statusToColor(theme, tok) : theme.text
          })
          return (
            <box flexDirection="row" gap={tight() ? 1 : 2}>
              <For each={row}>
                {(cell, cIdx) => (
                  <text fg={rowColor()} flexShrink={0}>
                    {padCell(cell, cIdx())}
                  </text>
                )}
              </For>
            </box>
          )
        }}
      </For>
      {/* Totals row */}
      <Show when={props.comp.totals}>
        <box flexDirection="row" gap={tight() ? 1 : 2}>
          <For each={props.comp.headers}>
            {(_, i) => (
              <text fg={theme.borderSubtle} flexShrink={0}>
                {"═".repeat(colWidths()[i()] ?? 3)}
              </text>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={tight() ? 1 : 2}>
          <For each={props.comp.totals}>
            {(cell, i) => (
              <text fg={theme.text} attributes={TextAttributes.BOLD} flexShrink={0}>
                {padCell(cell, i())}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: KeyValue
// ──────────────────────────────────────────────────────────────────────────

function KeyValueRenderer(props: { comp: Of<"key_value"> }) {
  const { theme } = useTheme()
  const keyWidth = createMemo(() => Math.max(...props.comp.items.map((i) => i.key.length), 8))

  function valueColor(status?: string): RGBA {
    switch (status) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      case "info":
        return theme.primary
      default:
        return theme.text
    }
  }

  // Group items by `group`
  const grouped = createMemo(() => {
    const result: Array<{ group?: string; items: typeof props.comp.items }> = []
    for (const item of props.comp.items) {
      const last = result[result.length - 1]
      if (last && last.group === item.group) {
        last.items = [...last.items, item]
      } else {
        result.push({ group: item.group, items: [item] })
      }
    }
    return result
  })

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={grouped()}>
        {(grp) => (
          <box gap={0} marginTop={grp.group ? 1 : 0}>
            <Show when={grp.group}>
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                ── {grp.group} ──
              </text>
            </Show>
            <For each={grp.items}>
              {(item) => (
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {item.key.padEnd(keyWidth(), " ")}
                  </text>
                  <text fg={valueColor(item.status)} wrapMode="word" flexGrow={1}>
                    {item.value}
                  </text>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Tree
// ──────────────────────────────────────────────────────────────────────────

function TreeRenderer(props: { comp: Of<"tree"> }) {
  const { theme } = useTheme()

  function renderNodes(nodes: ReadonlyArray<VizTreeNode>, prefix: string, isRoot: boolean) {
    return (
      <For each={nodes}>
        {(node, idx) => {
          const last = idx() === nodes.length - 1
          const connector = isRoot ? "" : last ? "└─ " : "├─ "
          const nextPrefix = isRoot ? "" : prefix + (last ? "   " : "│  ")
          const statusColor = node.status ? severityColor(theme, node.status) : theme.text
          return (
            <box gap={0}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.borderSubtle} flexShrink={0}>
                  {prefix + connector}
                </text>
                <text fg={statusColor} flexShrink={0}>
                  {node.label}
                </text>
                <Show when={node.value}>
                  <text fg={theme.textMuted} flexGrow={1}>
                    {" " + node.value}
                  </text>
                </Show>
              </box>
              <Show when={node.children && node.children.length > 0}>
                {renderNodes(node.children!, nextPrefix, false)}
              </Show>
            </box>
          )
        }}
      </For>
    )
  }

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      {renderNodes(props.comp.nodes, "", true)}
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Stat (KPI tile)
// ──────────────────────────────────────────────────────────────────────────

type StatLike = Of<"stat"> | Of<"stat_grid">["items"][number]

function isStatComp(s: StatLike): s is Of<"stat"> {
  return (s as Of<"stat">).type === "stat"
}

function StatTile(props: { stat: StatLike; compact?: boolean }) {
  const { theme } = useTheme()
  const valueText = createMemo(() =>
    formatValue(props.stat.value, props.stat.format, props.stat.unit),
  )
  const valueColor = createMemo(() => resolveColor(theme, props.stat.color))
  const deltaText = createMemo(() => {
    if (props.stat.delta === undefined) return undefined
    const sign = props.stat.delta > 0 ? "+" : props.stat.delta < 0 ? "−" : ""
    const abs = Math.abs(props.stat.delta)
    const num = props.stat.format === "percent" ? `${(abs * 100).toFixed(1)}` : formatCompact(abs)
    return `${sign}${num}${props.stat.deltaUnit ?? ""}`
  })
  const trendArrow = createMemo(() =>
    props.stat.trend === "up" ? "▲" : props.stat.trend === "down" ? "▼" : props.stat.trend === "flat" ? "▬" : "",
  )
  const trendColor = createMemo<RGBA>(() => {
    const t = props.stat.trend
    if (!t) return theme.textMuted
    const good = props.stat.trendIsGood !== false // default true
    if (t === "flat") return theme.textMuted
    const positiveIsUp = t === "up"
    return positiveIsUp === good ? theme.success : theme.error
  })

  return (
    <box
      border={!props.compact}
      borderColor={theme.borderSubtle}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={props.compact ? 0 : 0}
      paddingBottom={props.compact ? 0 : 0}
      flexDirection="column"
      gap={0}
      flexGrow={1}
      flexShrink={1}
      minWidth={20}
    >
      <text fg={theme.textMuted}>{props.stat.label}</text>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={valueColor()} attributes={TextAttributes.BOLD}>
          {valueText()}
        </text>
        <Show when={props.stat.trend}>
          <text fg={trendColor()}>{trendArrow()}</text>
        </Show>
        <Show when={deltaText()}>
          <text fg={trendColor()}>{deltaText()}</text>
        </Show>
      </box>
      <Show when={props.stat.sparkline && props.stat.sparkline.length > 0}>
        <text fg={resolveColor(theme, props.stat.color ?? "primary")}>{sparkline(props.stat.sparkline!)}</text>
      </Show>
      <Show when={props.stat.hint}>
        <text fg={theme.textMuted}>{props.stat.hint}</text>
      </Show>
    </box>
  )
}

function StatRenderer(props: { comp: Of<"stat"> }) {
  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <StatTile stat={props.comp} />
    </box>
  )
}

function StatGridRenderer(props: { comp: Of<"stat_grid"> }) {
  const dims = useTerminalDimensions()
  const columns = createMemo(() => {
    if (props.comp.columns) return props.comp.columns
    const w = dims().width
    if (w >= 130) return 4
    if (w >= 96) return 3
    if (w >= 60) return 2
    return 1
  })

  const rows = createMemo(() => {
    const c = columns()
    const out: Array<typeof props.comp.items> = []
    for (let i = 0; i < props.comp.items.length; i += c) {
      out.push(props.comp.items.slice(i, i + c) as typeof props.comp.items)
    }
    return out
  })

  return (
    <box gap={1}>
      <Title title={props.comp.title} />
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1}>
            <For each={row}>{(item) => <StatTile stat={item} />}</For>
          </box>
        )}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: BarChart
// ──────────────────────────────────────────────────────────────────────────

function BarChartRenderer(props: { comp: Of<"bar_chart"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const orientation = createMemo(() => props.comp.orientation ?? "horizontal")
  const items = () => props.comp.items
  const maxVal = createMemo(() => {
    if (props.comp.maxValue != null) return props.comp.maxValue
    return Math.max(...items().map((i) => i.value), 1)
  })
  const labelWidth = createMemo(() => Math.max(...items().map((i) => i.label.length), 4))

  const horizontalBarWidth = createMemo(() => {
    if (props.comp.barWidth) return props.comp.barWidth
    const w = dims().width - labelWidth() - 28
    return Math.max(10, Math.min(60, w))
  })

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <Switch>
        <Match when={orientation() === "horizontal"}>
          <For each={items()}>
            {(item) => {
              const pct = createMemo(() => Math.min(item.value / maxVal(), 1))
              const filled = createMemo(() => Math.round(pct() * horizontalBarWidth()))
              const empty = createMemo(() => horizontalBarWidth() - filled())
              const bar = createMemo(() => "█".repeat(filled()) + "░".repeat(empty()))
              const color = createMemo(() => resolveColor(theme, item.color ?? "primary"))
              const suffix = createMemo(() => {
                const parts: string[] = []
                if (props.comp.showValues !== false) {
                  parts.push(`${item.value}${item.unit ?? ""}`)
                }
                if (props.comp.showPercentages) {
                  parts.push(`(${Math.round(pct() * 100)}%)`)
                }
                return parts.join(" ")
              })
              return (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {item.label.padEnd(labelWidth(), " ")}
                  </text>
                  <text fg={color()} flexShrink={0}>
                    {bar()}
                  </text>
                  <text fg={theme.text} flexShrink={0}>
                    {suffix()}
                  </text>
                </box>
              )
            }}
          </For>
        </Match>
        <Match when={orientation() === "vertical"}>
          <VerticalBarChart comp={props.comp} maxVal={maxVal()} />
        </Match>
      </Switch>
    </box>
  )
}

function VerticalBarChart(props: { comp: Of<"bar_chart">; maxVal: number }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const height = createMemo(() => Math.max(4, Math.min(14, Math.floor(dims().height / 5))))
  const cellWidth = createMemo(() => {
    const labels = props.comp.items.map((i) => i.label.length)
    return Math.max(...labels, 3) + 2
  })

  // For each row (top to bottom), emit a cell per item
  const rows = createMemo(() => {
    const h = height()
    const rs: string[][] = []
    for (let r = 0; r < h; r++) {
      const row: string[] = []
      for (const item of props.comp.items) {
        const norm = Math.min(item.value / props.maxVal, 1)
        const filledRows = Math.round(norm * h)
        // r=0 is top
        const filled = h - 1 - r < filledRows
        row.push(filled ? "█".repeat(cellWidth() - 1) : " ".repeat(cellWidth() - 1))
      }
      rs.push(row)
    }
    return rs
  })

  return (
    <box gap={0}>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1}>
            <For each={row}>
              {(seg, i) => {
                const color = createMemo(() => resolveColor(theme, props.comp.items[i()].color ?? "primary"))
                return (
                  <text fg={color()} flexShrink={0}>
                    {seg}
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </For>
      {/* Baseline */}
      <box flexDirection="row" gap={1}>
        <For each={props.comp.items}>
          {() => (
            <text fg={theme.borderSubtle} flexShrink={0}>
              {"─".repeat(cellWidth() - 1)}
            </text>
          )}
        </For>
      </box>
      {/* Labels */}
      <box flexDirection="row" gap={1}>
        <For each={props.comp.items}>
          {(item) => (
            <text fg={theme.textMuted} flexShrink={0}>
              {item.label.padEnd(cellWidth() - 1).slice(0, cellWidth() - 1)}
            </text>
          )}
        </For>
      </box>
      {/* Values */}
      <Show when={props.comp.showValues !== false}>
        <box flexDirection="row" gap={1}>
          <For each={props.comp.items}>
            {(item) => (
              <text fg={theme.text} flexShrink={0}>
                {`${item.value}${item.unit ?? ""}`.padEnd(cellWidth() - 1).slice(0, cellWidth() - 1)}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: LineChart
// ──────────────────────────────────────────────────────────────────────────

function resample(values: ReadonlyArray<number>, targetLen: number): number[] {
  if (values.length === 0) return Array(targetLen).fill(0)
  if (values.length === targetLen) return [...values]
  const out: number[] = new Array(targetLen)
  for (let i = 0; i < targetLen; i++) {
    const t = (i / Math.max(1, targetLen - 1)) * (values.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(values.length - 1, Math.ceil(t))
    const frac = t - lo
    out[i] = values[lo] * (1 - frac) + values[hi] * frac
  }
  return out
}

const LINE_MARKERS = ["●", "■", "▲", "◆", "◉", "★"]

function LineChartRenderer(props: { comp: Of<"line_chart"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const height = createMemo(() => props.comp.height ?? 8)

  const allValues = createMemo(() => props.comp.series.flatMap((s) => s.values))
  const yMin = createMemo(() => (props.comp.yMin ?? Math.min(...allValues())))
  const yMax = createMemo(() => {
    const m = props.comp.yMax ?? Math.max(...allValues())
    return m === yMin() ? m + 1 : m
  })
  const axisWidth = 8

  const width = createMemo(() => {
    return Math.max(20, Math.min(140, dims().width - axisWidth - 6))
  })

  const seriesSamples = createMemo(() =>
    props.comp.series.map((s, idx) => ({
      ...s,
      colorToken: s.color ?? defaultSeriesColorToken(idx),
      marker: LINE_MARKERS[idx % LINE_MARKERS.length],
      sampled: resample(s.values, width()),
    })),
  )

  type Cell = { ch: string; color: VizColorToken | undefined } | null
  const grid = createMemo<Cell[][]>(() => {
    const h = height()
    const w = width()
    const g: Cell[][] = Array.from({ length: h }, () => Array(w).fill(null))
    const min = yMin()
    const max = yMax()
    const range = max - min || 1
    for (const s of seriesSamples()) {
      const prev = { y: -1 }
      for (let x = 0; x < w; x++) {
        const v = s.sampled[x]
        const norm = (v - min) / range
        const y = Math.max(0, Math.min(h - 1, h - 1 - Math.round(norm * (h - 1))))
        // connect with vertical glyphs between prev.y and y
        if (prev.y !== -1 && Math.abs(prev.y - y) > 1) {
          const [from, to] = prev.y < y ? [prev.y + 1, y - 1] : [y + 1, prev.y - 1]
          for (let yi = from; yi <= to; yi++) {
            if (g[yi][x - 1] === null) g[yi][x - 1] = { ch: "│", color: s.colorToken }
          }
        }
        g[y][x] = { ch: s.marker, color: s.colorToken }
        prev.y = y
      }
    }
    return g
  })

  // Collapse same-color runs in a row into <text> spans
  function rowRuns(row: Cell[]): Array<{ text: string; color: RGBA }> {
    const runs: Array<{ text: string; color: RGBA }> = []
    let current: { text: string; color: RGBA } | null = null
    for (const cell of row) {
      const ch = cell?.ch ?? " "
      const color = cell ? resolveColor(theme, cell.color) : theme.text
      if (current && current.color.r === color.r && current.color.g === color.g && current.color.b === color.b) {
        current.text += ch
      } else {
        current = { text: ch, color }
        runs.push(current)
      }
    }
    return runs
  }

  function axisLabel(rowIdx: number): string {
    const h = height()
    if (rowIdx === 0) return formatYTick(yMax(), props.comp.yUnit).padStart(axisWidth - 1)
    if (rowIdx === h - 1) return formatYTick(yMin(), props.comp.yUnit).padStart(axisWidth - 1)
    if (rowIdx === Math.floor((h - 1) / 2))
      return formatYTick((yMin() + yMax()) / 2, props.comp.yUnit).padStart(axisWidth - 1)
    return " ".repeat(axisWidth - 1)
  }

  const showLegend = createMemo(() => props.comp.showLegend ?? props.comp.series.length > 1)
  const showAxis = createMemo(() => props.comp.showAxis !== false)

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={grid()}>
        {(row, rIdx) => (
          <box flexDirection="row" gap={0} flexShrink={0}>
            <Show when={showAxis()}>
              <text fg={theme.textMuted} flexShrink={0}>
                {axisLabel(rIdx())}
              </text>
              <text fg={theme.borderSubtle} flexShrink={0}>
                {rIdx() === height() - 1 ? "└" : "│"}
              </text>
            </Show>
            <For each={rowRuns(row)}>
              {(run) => (
                <text fg={run.color} flexShrink={0}>
                  {run.text}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
      {/* X axis labels */}
      <Show when={showAxis() && props.comp.labels && props.comp.labels.length > 0}>
        <box flexDirection="row" gap={0} flexShrink={0}>
          <text fg={theme.textMuted} flexShrink={0}>
            {" ".repeat(axisWidth)}
          </text>
          <text fg={theme.textMuted} flexShrink={0}>
            {sparseAxisLabels(props.comp.labels!, width())}
          </text>
        </box>
      </Show>
      {/* Legend */}
      <Show when={showLegend()}>
        <box flexDirection="row" gap={2} flexWrap="wrap" marginTop={1}>
          <For each={seriesSamples()}>
            {(s) => (
              <box flexDirection="row" gap={1}>
                <text fg={resolveColor(theme, s.colorToken)}>{s.marker}</text>
                <text fg={theme.text}>{s.name}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function defaultSeriesColorToken(idx: number): VizColorToken {
  const tokens: VizColorToken[] = ["primary", "accent", "secondary", "info", "warning", "success"]
  return tokens[idx % tokens.length]
}

function formatYTick(v: number, unit?: string): string {
  const s = Math.abs(v) >= 1000 ? formatCompact(v) : Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1)
  return unit ? `${s}${unit}` : s
}

function sparseAxisLabels(labels: ReadonlyArray<string>, width: number): string {
  if (labels.length === 0 || width <= 0) return ""
  const stride = Math.max(1, Math.ceil(labels.length / Math.floor(width / 8)))
  let out = ""
  for (let i = 0; i < labels.length; i += stride) {
    const pos = Math.floor((i / Math.max(1, labels.length - 1)) * (width - 1))
    while (out.length < pos) out += " "
    out += labels[i]
  }
  return out.slice(0, width)
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Histogram
// ──────────────────────────────────────────────────────────────────────────

function HistogramRenderer(props: { comp: Of<"histogram"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const maxCount = createMemo(() => Math.max(...props.comp.bins.map((b) => b.count), 1))
  const labelWidth = createMemo(() => Math.max(...props.comp.bins.map((b) => b.label.length), 4))
  const barWidth = createMemo(() => Math.max(10, Math.min(60, dims().width - labelWidth() - 18)))

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={props.comp.bins}>
        {(bin) => {
          const filled = createMemo(() => Math.round((bin.count / maxCount()) * barWidth()))
          const empty = createMemo(() => barWidth() - filled())
          const bar = createMemo(() => "▆".repeat(filled()) + "·".repeat(empty()))
          return (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted} flexShrink={0}>
                {bin.label.padEnd(labelWidth(), " ")}
              </text>
              <text fg={theme.secondary} flexShrink={0}>
                {bar()}
              </text>
              <text fg={theme.text} flexShrink={0}>
                {bin.count}
                {props.comp.unit ? ` ${props.comp.unit}` : ""}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Heatmap
// ──────────────────────────────────────────────────────────────────────────

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
}

function heatmapColor(theme: Theme, t: number, scale: "mono" | "diverge" | "traffic"): RGBA {
  const clamped = Math.max(0, Math.min(1, t))
  if (scale === "mono") {
    return lerpColor(theme.backgroundElement, theme.primary, clamped)
  }
  if (scale === "diverge") {
    // -1..0..1 mapped from 0..0.5..1
    if (clamped < 0.5) return lerpColor(theme.info, theme.backgroundElement, clamped * 2)
    return lerpColor(theme.backgroundElement, theme.error, (clamped - 0.5) * 2)
  }
  // traffic: green → yellow → red
  if (clamped < 0.5) return lerpColor(theme.success, theme.warning, clamped * 2)
  return lerpColor(theme.warning, theme.error, (clamped - 0.5) * 2)
}

function HeatmapRenderer(props: { comp: Of<"heatmap"> }) {
  const { theme } = useTheme()
  const scale = createMemo(() => props.comp.colorScale ?? "mono")
  const flat = createMemo(() => props.comp.values.flat())
  const min = createMemo(() => props.comp.min ?? Math.min(...flat()))
  const max = createMemo(() => {
    const m = props.comp.max ?? Math.max(...flat())
    return m === min() ? m + 1 : m
  })
  const cellWidth = 6
  const rowLabelW = createMemo(() => Math.max(...props.comp.rowLabels.map((l) => l.length), 4))

  function colorFor(value: number): RGBA {
    const norm = (value - min()) / (max() - min())
    return heatmapColor(theme, norm, scale())
  }

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      {/* Column headers */}
      <box flexDirection="row" gap={0}>
        <text fg={theme.textMuted} flexShrink={0}>
          {" ".repeat(rowLabelW() + 1)}
        </text>
        <For each={props.comp.colLabels}>
          {(c) => (
            <text fg={theme.textMuted} flexShrink={0}>
              {c.slice(0, cellWidth).padStart(cellWidth)}
            </text>
          )}
        </For>
      </box>
      {/* Rows */}
      <For each={props.comp.rowLabels}>
        {(rowLabel, rIdx) => (
          <box flexDirection="row" gap={0} flexShrink={0}>
            <text fg={theme.text} flexShrink={0}>
              {rowLabel.padEnd(rowLabelW(), " ") + " "}
            </text>
            <For each={props.comp.colLabels}>
              {(_c, cIdx) => {
                const v = createMemo(() => props.comp.values[rIdx()]?.[cIdx()] ?? 0)
                const bg = createMemo(() => colorFor(v()))
                const luminance = createMemo(() => 0.299 * bg().r + 0.587 * bg().g + 0.114 * bg().b)
                const fg = createMemo(() => (luminance() > 0.55 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)))
                const txt = createMemo(() => {
                  const n = v()
                  const s = Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1)
                  return s.padStart(cellWidth - 1).slice(0, cellWidth - 1) + " "
                })
                return (
                  <box backgroundColor={bg()} flexShrink={0}>
                    <text fg={fg()}>{txt()}</text>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </For>
      {/* Legend */}
      <box flexDirection="row" gap={1} marginTop={1}>
        <text fg={theme.textMuted}>
          {props.comp.unit ? `${formatCompact(min())} ${props.comp.unit}` : formatCompact(min())}
        </text>
        <For each={Array.from({ length: 10 })}>
          {(_, i) => {
            const t = i() / 9
            return (
              <box backgroundColor={heatmapColor(theme, t, scale())}>
                <text fg={theme.textMuted}> </text>
              </box>
            )
          }}
        </For>
        <text fg={theme.textMuted}>
          {props.comp.unit ? `${formatCompact(max())} ${props.comp.unit}` : formatCompact(max())}
        </text>
      </box>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Gauge
// ──────────────────────────────────────────────────────────────────────────

function GaugeRenderer(props: { comp: Of<"gauge"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const min = createMemo(() => props.comp.min ?? 0)
  const max = createMemo(() => props.comp.max)
  const range = createMemo(() => max() - min() || 1)
  const pct = createMemo(() => Math.max(0, Math.min(1, (props.comp.value - min()) / range())))
  const pctNum = createMemo(() => pct() * 100)
  const barWidth = createMemo(() => Math.max(20, Math.min(60, dims().width - 28)))
  const filled = createMemo(() => Math.round(pct() * barWidth()))
  const empty = createMemo(() => barWidth() - filled())
  const color = createMemo(() => thresholdColor(theme, pctNum(), props.comp.thresholds, theme.primary))

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <text fg={theme.textMuted}>{props.comp.label}</text>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={color()} attributes={TextAttributes.BOLD}>
          {"█".repeat(filled())}
        </text>
        <text fg={theme.borderSubtle}>{"░".repeat(empty())}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={color()} attributes={TextAttributes.BOLD}>
          {`${props.comp.value}${props.comp.unit ?? ""} / ${props.comp.max}${props.comp.unit ?? ""}`}
        </text>
        <text fg={theme.textMuted}>{`(${pctNum().toFixed(1)}%)`}</text>
      </box>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: ProgressBars
// ──────────────────────────────────────────────────────────────────────────

function ProgressBarsRenderer(props: { comp: Of<"progress_bars"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const labelWidth = createMemo(() => Math.max(...props.comp.items.map((i) => i.label.length), 4))
  const barWidth = createMemo(() => {
    if (props.comp.barWidth) return props.comp.barWidth
    return Math.max(15, Math.min(50, dims().width - labelWidth() - 28))
  })

  function defaultColor(pct: number): RGBA {
    if (pct >= 0.9) return theme.error
    if (pct >= 0.7) return theme.warning
    return theme.success
  }

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={props.comp.items}>
        {(item) => {
          const pct = createMemo(() => Math.min(item.value / item.max, 1))
          const pctNum = createMemo(() => pct() * 100)
          const filled = createMemo(() => Math.round(pct() * barWidth()))
          const empty = createMemo(() => barWidth() - filled())
          const bar = createMemo(() => "█".repeat(filled()) + "░".repeat(empty()))
          const color = createMemo(() =>
            thresholdColor(theme, pctNum(), props.comp.thresholds, defaultColor(pct())),
          )
          return (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted} flexShrink={0}>
                {item.label.padEnd(labelWidth(), " ")}
              </text>
              <text fg={color()} flexShrink={0}>
                {bar()}
              </text>
              <text fg={theme.textMuted} flexShrink={0}>
                {`${Math.round(pctNum())}%`.padStart(4)}
              </text>
              <text fg={theme.text} flexShrink={0}>
                {`${item.value}/${item.max}${item.unit ?? ""}`}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: Timeline
// ──────────────────────────────────────────────────────────────────────────

const TIMELINE_ICON = {
  done: "✓",
  active: "●",
  pending: "○",
  error: "✗",
  skipped: "∅",
} as const

function TimelineRenderer(props: { comp: Of<"timeline"> }) {
  const { theme } = useTheme()

  function iconColor(status: keyof typeof TIMELINE_ICON): RGBA {
    switch (status) {
      case "done":
        return theme.success
      case "active":
        return theme.primary
      case "pending":
        return theme.textMuted
      case "error":
        return theme.error
      case "skipped":
        return theme.textMuted
    }
  }

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={props.comp.events}>
        {(event, idx) => {
          const last = idx() === props.comp.events.length - 1
          return (
            <box gap={0}>
              <box flexDirection="row" gap={1}>
                <text fg={iconColor(event.status)} flexShrink={0}>
                  {TIMELINE_ICON[event.status]}
                </text>
                <text
                  fg={event.status === "active" || event.status === "error" ? theme.text : theme.textMuted}
                  attributes={event.status === "active" ? TextAttributes.BOLD : undefined}
                  wrapMode="word"
                  flexGrow={1}
                >
                  {event.label}
                </text>
                <Show when={event.duration}>
                  <text fg={theme.secondary} flexShrink={0}>
                    {event.duration}
                  </text>
                </Show>
                <Show when={event.time}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {event.time}
                  </text>
                </Show>
              </box>
              <Show when={event.detail}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.borderSubtle} flexShrink={0}>
                    {last ? "  " : "│ "}
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {event.detail}
                  </text>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Renderer: StatusGrid
// ──────────────────────────────────────────────────────────────────────────

function StatusGridRenderer(props: { comp: Of<"status_grid"> }) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const columns = createMemo(() => {
    if (props.comp.columns) return props.comp.columns
    const w = dims().width
    if (w >= 130) return 4
    if (w >= 96) return 3
    if (w >= 60) return 2
    return 1
  })

  const rows = createMemo(() => {
    const c = columns()
    const out: Array<typeof props.comp.items> = []
    for (let i = 0; i < props.comp.items.length; i += c) {
      out.push(props.comp.items.slice(i, i + c) as typeof props.comp.items)
    }
    return out
  })

  return (
    <box gap={0}>
      <Title title={props.comp.title} />
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <For each={row}>
              {(item) => {
                const color = createMemo(() => severityColor(theme, item.status))
                return (
                  <box
                    border
                    borderColor={color()}
                    paddingLeft={1}
                    paddingRight={1}
                    flexDirection="column"
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={18}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={color()} attributes={TextAttributes.BOLD}>
                        {SEVERITY_ICON[item.status]}
                      </text>
                      <text fg={theme.text} attributes={TextAttributes.BOLD} flexGrow={1}>
                        {item.label}
                      </text>
                    </box>
                    <Show when={item.detail}>
                      <text fg={theme.textMuted} wrapMode="word">
                        {item.detail}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Container renderers
// ──────────────────────────────────────────────────────────────────────────

function SectionRenderer(props: { comp: Of<"section"> }) {
  const { theme } = useTheme()
  return (
    <box
      gap={1}
      border
      borderColor={theme.borderSubtle}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
    >
      <Show when={props.comp.title}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <Show when={props.comp.description}>
        <text fg={theme.textMuted} wrapMode="word">
          {props.comp.description}
        </text>
      </Show>
      <For each={props.comp.children}>{(child) => <ComponentRenderer component={child} />}</For>
    </box>
  )
}

function GridRenderer(props: { comp: Of<"grid"> }) {
  const dims = useTerminalDimensions()
  const columns = createMemo(() => {
    if (props.comp.columns) return props.comp.columns
    const w = dims().width
    if (w >= 130) return Math.min(props.comp.children.length, 3)
    if (w >= 96) return Math.min(props.comp.children.length, 2)
    return 1
  })

  const rows = createMemo(() => {
    const c = columns()
    const out: Array<typeof props.comp.children> = []
    for (let i = 0; i < props.comp.children.length; i += c) {
      out.push(props.comp.children.slice(i, i + c) as typeof props.comp.children)
    }
    return out
  })

  return (
    <box gap={1}>
      <Title title={props.comp.title} />
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={2} flexShrink={0}>
            <For each={row}>
              {(child) => (
                <box flexGrow={1} flexShrink={1} minWidth={0}>
                  <ComponentRenderer component={child} />
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Dispatcher
// ──────────────────────────────────────────────────────────────────────────

function ComponentRenderer(props: { component: VizComponent }) {
  return (
    <Switch>
      <Match when={props.component.type === "text"}>
        <TextRenderer comp={props.component as Of<"text">} />
      </Match>
      <Match when={props.component.type === "markdown"}>
        <MarkdownRenderer comp={props.component as Of<"markdown">} />
      </Match>
      <Match when={props.component.type === "code"}>
        <CodeRenderer comp={props.component as Of<"code">} />
      </Match>
      <Match when={props.component.type === "diff"}>
        <DiffRenderer comp={props.component as Of<"diff">} />
      </Match>
      <Match when={props.component.type === "alert"}>
        <AlertRenderer comp={props.component as Of<"alert">} />
      </Match>
      <Match when={props.component.type === "table"}>
        <TableRenderer comp={props.component as Of<"table">} />
      </Match>
      <Match when={props.component.type === "key_value"}>
        <KeyValueRenderer comp={props.component as Of<"key_value">} />
      </Match>
      <Match when={props.component.type === "tree"}>
        <TreeRenderer comp={props.component as Of<"tree">} />
      </Match>
      <Match when={props.component.type === "stat"}>
        <StatRenderer comp={props.component as Of<"stat">} />
      </Match>
      <Match when={props.component.type === "stat_grid"}>
        <StatGridRenderer comp={props.component as Of<"stat_grid">} />
      </Match>
      <Match when={props.component.type === "bar_chart"}>
        <BarChartRenderer comp={props.component as Of<"bar_chart">} />
      </Match>
      <Match when={props.component.type === "line_chart"}>
        <LineChartRenderer comp={props.component as Of<"line_chart">} />
      </Match>
      <Match when={props.component.type === "histogram"}>
        <HistogramRenderer comp={props.component as Of<"histogram">} />
      </Match>
      <Match when={props.component.type === "heatmap"}>
        <HeatmapRenderer comp={props.component as Of<"heatmap">} />
      </Match>
      <Match when={props.component.type === "gauge"}>
        <GaugeRenderer comp={props.component as Of<"gauge">} />
      </Match>
      <Match when={props.component.type === "progress_bars"}>
        <ProgressBarsRenderer comp={props.component as Of<"progress_bars">} />
      </Match>
      <Match when={props.component.type === "timeline"}>
        <TimelineRenderer comp={props.component as Of<"timeline">} />
      </Match>
      <Match when={props.component.type === "status_grid"}>
        <StatusGridRenderer comp={props.component as Of<"status_grid">} />
      </Match>
      <Match when={props.component.type === "section"}>
        <SectionRenderer comp={props.component as Of<"section">} />
      </Match>
      <Match when={props.component.type === "grid"}>
        <GridRenderer comp={props.component as Of<"grid">} />
      </Match>
    </Switch>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Dialog shell
// ──────────────────────────────────────────────────────────────────────────

function specToMarkdown(spec: OpenTUIVizSpecType): string {
  const lines: string[] = []
  lines.push(`# ${spec.title}`)
  if (spec.subtitle) lines.push(`_${spec.subtitle}_`)
  lines.push("")
  for (const c of spec.components) componentToMarkdown(c, lines)
  return lines.join("\n").trim() + "\n"
}

function componentToMarkdown(c: VizComponent, lines: string[]): void {
  const title = "title" in c ? c.title : undefined
  if (title) {
    lines.push(`## ${title}`)
    lines.push("")
  }
  switch (c.type) {
    case "text":
      lines.push(c.content)
      break
    case "markdown":
      lines.push(c.content)
      break
    case "code":
      lines.push("```" + c.filetype)
      lines.push(c.content)
      lines.push("```")
      break
    case "diff":
      lines.push("```diff")
      lines.push(createTwoFilesPatch(c.title ?? "before", c.title ?? "after", c.before, c.after, "", ""))
      lines.push("```")
      break
    case "alert":
      lines.push(`> **[${c.severity.toUpperCase()}]${c.title ? " " + c.title : ""}** — ${c.message}`)
      break
    case "table":
      lines.push(`| ${c.headers.join(" | ")} |`)
      lines.push(`| ${c.headers.map(() => "---").join(" | ")} |`)
      for (const row of c.rows) lines.push(`| ${row.map((x) => x.replace(/\|/g, "\\|")).join(" | ")} |`)
      if (c.totals) lines.push(`| ${c.totals.map((x) => `**${x}**`).join(" | ")} |`)
      break
    case "key_value":
      for (const item of c.items) lines.push(`- **${item.key}**: ${item.value}`)
      break
    case "stat":
      lines.push(`**${c.label}** ${formatValue(c.value, c.format, c.unit)}`)
      break
    case "stat_grid":
      for (const it of c.items) lines.push(`- **${it.label}**: ${formatValue(it.value, it.format, it.unit)}`)
      break
    case "section":
      if (c.description) lines.push(`_${c.description}_`)
      lines.push("")
      for (const child of c.children) componentToMarkdown(child, lines)
      break
    case "grid":
      for (const child of c.children) componentToMarkdown(child, lines)
      break
    default:
      lines.push(`_(${TYPE_LABEL[c.type]} component)_`)
  }
  lines.push("")
}

export function DialogOpenTUIViz(props: DialogOpenTUIVizProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [activeIdx, setActiveIdx] = createSignal(0)
  const [showHelp, setShowHelp] = createSignal(false)

  const components = createMemo(() => props.spec.components)
  const active = createMemo(() => components()[activeIdx()] ?? components()[0]!)
  const multiTab = createMemo(() => components().length > 1)

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    const reserved = multiTab() ? 11 : 9
    return Math.max(12, Math.min(h - reserved, Math.floor(h * 0.78)))
  })

  onMount(() => {
    dialog.setSize("xlarge")
  })

  useKeyboard((evt) => {
    // Number keys 1-9: jump to tab
    if (multiTab() && /^[1-9]$/.test(evt.name)) {
      const target = parseInt(evt.name, 10) - 1
      if (target < components().length) {
        setActiveIdx(target)
        evt.preventDefault()
        evt.stopPropagation()
      }
      return
    }
    if (evt.name === "tab" && !evt.shift && multiTab()) {
      setActiveIdx((i) => (i + 1) % components().length)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "tab" && evt.shift && multiTab()) {
      setActiveIdx((i) => (i - 1 + components().length) % components().length)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "e" && !evt.ctrl && !evt.shift && !evt.meta) {
      const md = specToMarkdown(props.spec)
      void Clipboard.copy(md)
        .then(() => toast.show({ variant: "success", message: "Visualization exported as markdown" }))
        .catch(toast.error)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "?" || (evt.name === "h" && evt.shift)) {
      setShowHelp((v) => !v)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="column" gap={0}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            ◈ {props.spec.title}
          </text>
          <Show when={props.spec.subtitle}>
            <text fg={theme.textMuted}>{props.spec.subtitle}</text>
          </Show>
        </box>
        <text fg={theme.textMuted}>esc · ? help</text>
      </box>

      <Show when={multiTab()}>
        <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
          <For each={components()}>
            {(comp, i) => {
              const label = tabLabel(comp)
              const icon = TYPE_ICON[comp.type] ?? "•"
              const isActive = createMemo(() => i() === activeIdx())
              return (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isActive() ? theme.backgroundElement : undefined}
                  borderColor={isActive() ? theme.borderActive : undefined}
                  onMouseUp={() => setActiveIdx(i())}
                >
                  <text
                    fg={isActive() ? theme.primary : theme.textMuted}
                    attributes={isActive() ? TextAttributes.BOLD : undefined}
                  >
                    {i() + 1} {icon} {label}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>

      <box border borderColor={theme.border} height={contentHeight()} flexShrink={0}>
        <scrollbox height={contentHeight() - 2} focused={true}>
          <box paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1} gap={1}>
            <ComponentRenderer component={active()} />
          </box>
        </scrollbox>
      </box>

      <Show
        when={showHelp()}
        fallback={
          <box flexDirection="row" gap={2} flexShrink={0}>
            <text fg={theme.textMuted}>j/k scroll</text>
            <Show when={multiTab()}>
              <text fg={theme.textMuted}>tab · 1-9 jump</text>
            </Show>
            <text fg={theme.textMuted}>e export</text>
            <text fg={theme.textMuted}>? help</text>
          </box>
        }
      >
        <box
          border
          borderColor={theme.borderSubtle}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          flexShrink={0}
        >
          <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
            Keybinds
          </text>
          <text fg={theme.textMuted}>j / k or arrows · scroll content</text>
          <Show when={multiTab()}>
            <text fg={theme.textMuted}>tab / shift+tab · next / prev tab</text>
            <text fg={theme.textMuted}>1 - 9 · jump to tab N</text>
          </Show>
          <text fg={theme.textMuted}>e · copy visualization as markdown</text>
          <text fg={theme.textMuted}>? · toggle this help</text>
          <text fg={theme.textMuted}>esc · close</text>
        </box>
      </Show>
    </box>
  )
}
