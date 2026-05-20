import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show, Switch, Match } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import type { OpenTUIVizSpecType, VizComponent } from "@/tool/opentui"

export type DialogOpenTUIVizProps = {
  spec: OpenTUIVizSpecType
}

type BarChartItem = Extract<VizComponent, { type: "bar_chart" }>
type TableItem = Extract<VizComponent, { type: "table" }>
type KeyValueItem = Extract<VizComponent, { type: "key_value" }>
type ProgressBarsItem = Extract<VizComponent, { type: "progress_bars" }>
type TextItem = Extract<VizComponent, { type: "text" }>
type TimelineItem = Extract<VizComponent, { type: "timeline" }>

const TYPE_LABEL: Record<string, string> = {
  bar_chart: "Bar Chart",
  table: "Table",
  key_value: "Key/Value",
  progress_bars: "Progress",
  text: "Text",
  timeline: "Timeline",
}

function componentTabLabel(comp: VizComponent): string {
  const title = "title" in comp ? comp.title : undefined
  if (title) return title
  return TYPE_LABEL[comp.type] ?? comp.type
}

function BarChartRenderer(props: { comp: BarChartItem }) {
  const { theme } = useTheme()
  const barWidth = () => props.comp.barWidth ?? 40
  const items = () => props.comp.items
  const maxVal = createMemo(() => {
    if (props.comp.maxValue != null) return props.comp.maxValue
    return Math.max(...items().map((i) => i.value), 1)
  })
  const labelWidth = createMemo(() => Math.max(...items().map((i) => i.label.length), 4))

  return (
    <box gap={0}>
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <For each={items()}>
        {(item) => {
          const filled = createMemo(() => Math.round(Math.min(item.value / maxVal(), 1) * barWidth()))
          const empty = createMemo(() => barWidth() - filled())
          const bar = createMemo(() => "█".repeat(filled()) + "░".repeat(empty()))
          const valueStr = createMemo(() => `${item.value}${item.unit ?? ""}`)
          const label = createMemo(() => item.label.padEnd(labelWidth(), " "))
          return (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>{label()}</text>
              <text fg={theme.primary}>{bar()}</text>
              <text fg={theme.text}>{valueStr()}</text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function TableRenderer(props: { comp: TableItem }) {
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()

  const tableMarkdown = createMemo(() => {
    const { headers, rows } = props.comp
    const sep = headers.map(() => "---")
    const lines = [
      `| ${headers.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...rows.map((row) => `| ${row.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`),
    ]
    return lines.join("\n")
  })

  const tight = createMemo(() => dimensions().width < 84)

  return (
    <box gap={0}>
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <markdown
        content={tableMarkdown()}
        syntaxStyle={syntax()}
        fg={theme.text}
        conceal={false}
        tableOptions={{
          widthMode: "full",
          wrapMode: "word",
          cellPadding: tight() ? 0 : 1,
          borders: !tight(),
          outerBorder: false,
          borderColor: theme.borderSubtle,
        }}
      />
    </box>
  )
}

function KeyValueRenderer(props: { comp: KeyValueItem }) {
  const { theme } = useTheme()
  const keyWidth = createMemo(() => Math.max(...props.comp.items.map((i) => i.key.length), 8))

  function valueColor(status?: string) {
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

  return (
    <box gap={0}>
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <For each={props.comp.items}>
        {(item) => (
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>{item.key.padEnd(keyWidth(), " ")}</text>
            <text fg={valueColor(item.status)} wrapMode="word" flexGrow={1}>
              {item.value}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

function ProgressBarsRenderer(props: { comp: ProgressBarsItem }) {
  const { theme } = useTheme()
  const barWidth = () => props.comp.barWidth ?? 40
  const labelWidth = createMemo(() => Math.max(...props.comp.items.map((i) => i.label.length), 4))

  function barColor(pct: number) {
    if (pct >= 0.9) return theme.error
    if (pct >= 0.7) return theme.warning
    return theme.success
  }

  return (
    <box gap={0}>
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <For each={props.comp.items}>
        {(item) => {
          const pct = createMemo(() => Math.min(item.value / item.max, 1))
          const filled = createMemo(() => Math.round(pct() * barWidth()))
          const empty = createMemo(() => barWidth() - filled())
          const bar = createMemo(() => "█".repeat(filled()) + "░".repeat(empty()))
          const pctStr = createMemo(() => `${Math.round(pct() * 100)}%`)
          const valueStr = createMemo(() => `${item.value}/${item.max}${item.unit ?? ""}`)
          return (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>{item.label.padEnd(labelWidth(), " ")}</text>
              <text fg={barColor(pct())}>{bar()}</text>
              <text fg={theme.textMuted}>{pctStr()}</text>
              <text fg={theme.text}>{valueStr()}</text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function TextRenderer(props: { comp: TextItem }) {
  const { theme, syntax } = useTheme()

  const textColor = createMemo(() => {
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
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <Show
        when={props.comp.style === "code"}
        fallback={
          <text fg={textColor()} wrapMode="word">
            {props.comp.content}
          </text>
        }
      >
        <markdown
          content={`\`\`\`\n${props.comp.content}\n\`\`\``}
          syntaxStyle={syntax()}
          fg={theme.text}
          conceal={false}
        />
      </Show>
    </box>
  )
}

const TIMELINE_ICON = {
  done: "✓",
  active: "●",
  pending: "○",
  error: "✗",
} as const

function TimelineRenderer(props: { comp: TimelineItem }) {
  const { theme } = useTheme()

  function iconColor(status: keyof typeof TIMELINE_ICON) {
    switch (status) {
      case "done":
        return theme.success
      case "active":
        return theme.primary
      case "pending":
        return theme.textMuted
      case "error":
        return theme.error
    }
  }

  return (
    <box gap={0}>
      <Show when={props.comp.title}>
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {props.comp.title}
        </text>
      </Show>
      <For each={props.comp.events}>
        {(event) => (
          <box gap={0}>
            <box flexDirection="row" gap={1}>
              <text fg={iconColor(event.status)} flexShrink={0}>
                {TIMELINE_ICON[event.status]}
              </text>
              <text fg={event.status === "active" ? theme.text : theme.textMuted} wrapMode="word" flexGrow={1}>
                {event.label}
              </text>
              <Show when={event.time}>
                <text fg={theme.textMuted} flexShrink={0}>
                  {event.time}
                </text>
              </Show>
            </box>
            <Show when={event.detail}>
              <text fg={theme.textMuted} paddingLeft={2} wrapMode="word">
                {event.detail}
              </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

function ComponentRenderer(props: { component: VizComponent }) {
  return (
    <Switch>
      <Match when={props.component.type === "bar_chart"}>
        <BarChartRenderer comp={props.component as BarChartItem} />
      </Match>
      <Match when={props.component.type === "table"}>
        <TableRenderer comp={props.component as TableItem} />
      </Match>
      <Match when={props.component.type === "key_value"}>
        <KeyValueRenderer comp={props.component as KeyValueItem} />
      </Match>
      <Match when={props.component.type === "progress_bars"}>
        <ProgressBarsRenderer comp={props.component as ProgressBarsItem} />
      </Match>
      <Match when={props.component.type === "text"}>
        <TextRenderer comp={props.component as TextItem} />
      </Match>
      <Match when={props.component.type === "timeline"}>
        <TimelineRenderer comp={props.component as TimelineItem} />
      </Match>
    </Switch>
  )
}

export function DialogOpenTUIViz(props: DialogOpenTUIVizProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [activeIdx, setActiveIdx] = createSignal(0)

  const components = createMemo(() => props.spec.components)
  const active = createMemo(() => components()[activeIdx()] ?? components()[0]!)
  const multiTab = createMemo(() => components().length > 1)

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    const reserved = multiTab() ? 9 : 7
    return Math.max(10, Math.min(h - reserved, Math.floor(h * 0.7)))
  })

  onMount(() => {
    dialog.setSize("xlarge")
  })

  useKeyboard((evt) => {
    if (!multiTab()) return
    if (evt.name === "tab" && !evt.shift) {
      setActiveIdx((i) => (i + 1) % components().length)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "tab" && evt.shift) {
      setActiveIdx((i) => (i - 1 + components().length) % components().length)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          ◈ {props.spec.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={multiTab()}>
        <box flexDirection="row" gap={2} flexShrink={0} flexWrap="wrap">
          <For each={components()}>
            {(comp, i) => {
              const label = componentTabLabel(comp)
              const isActive = createMemo(() => i() === activeIdx())
              return (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isActive() ? theme.backgroundElement : undefined}
                  onMouseUp={() => setActiveIdx(i())}
                >
                  <text
                    fg={isActive() ? theme.primary : theme.textMuted}
                    attributes={isActive() ? TextAttributes.BOLD : undefined}
                  >
                    {i() + 1} {label}
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

      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.textMuted}>j/k scroll</text>
        <Show when={multiTab()}>
          <text fg={theme.textMuted}>tab next</text>
          <text fg={theme.textMuted}>shift+tab prev</text>
        </Show>
      </box>
    </box>
  )
}
