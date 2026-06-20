import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short } from "../types"
import type { IntelSection, NikcliIntelSnapshot } from "../nikcli-intel"
import { INTEL_SECTIONS, intelSectionRows } from "../nikcli-intel"

interface NikcliSuiteDashboardViewProps {
  snapshot: NikcliIntelSnapshot
  section: IntelSection
  scrollOff: number
  pageHeight: number
  rowIdx: number
  terminalWidth: number
  onSelectRow: (i: number) => void
  onScroll: (direction: 1 | -1) => void
  onSection: (s: IntelSection) => void
}

export function NikcliSuiteDashboardView(props: NikcliSuiteDashboardViewProps) {
  const rows = createMemo(() => intelSectionRows(props.snapshot, props.section))
  const visible = createMemo(() => {
    const all = rows()
    const start = props.scrollOff
    const end = start + props.pageHeight
    return all.slice(start, end).map((line, i) => ({ line, index: start + i }))
  })

  const categoryStats = createMemo(() => {
    const m = new Map<string, number>()
    for (const p of props.snapshot.packages) m.set(p.category, (m.get(p.category) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" gap={2} height={1} flexShrink={0}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
          nikcli suite intelligence
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          4-agent analysis · live monorepo scan
        </text>
      </box>

      <box flexDirection="row" gap={1} height={1} flexShrink={0} flexWrap="wrap">
        <For each={INTEL_SECTIONS}>
          {(sec) => {
            const active = props.section === sec.key
            return (
              <text
                fg={active ? theme.accent : theme.textMuted}
                attributes={active ? TextAttributes.BOLD : TextAttributes.NONE}
                wrapMode="none"
                onMouseUp={() => props.onSection(sec.key)}
              >
                {active ? "●" : "·"} {sec.keybind}.{sec.label}
              </text>
            )
          }}
        </For>
      </box>

      <Show when={props.section === "overview"}>
        <box flexDirection="row" gap={2} height={3} flexShrink={0}>
          <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexGrow={1}>
            <text fg={theme.textMuted} wrapMode="none">
              packages
            </text>
            <text fg={theme.success} attributes={TextAttributes.BOLD} wrapMode="none">
              {props.snapshot.packageCount}
            </text>
          </box>
          <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexGrow={1}>
            <text fg={theme.textMuted} wrapMode="none">
              src modules
            </text>
            <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
              {props.snapshot.srcModuleCount}
            </text>
          </box>
          <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexGrow={1}>
            <text fg={theme.textMuted} wrapMode="none">
              test files
            </text>
            <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
              {props.snapshot.testFileCount}
            </text>
          </box>
          <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexGrow={2}>
            <text fg={theme.textMuted} wrapMode="none">
              categories
            </text>
            <text fg={theme.text} wrapMode="none">
              {short(
                categoryStats()
                  .map(([c, n]) => `${c}(${n})`)
                  .join(" "),
                props.terminalWidth - 8,
              )}
            </text>
          </box>
        </box>
      </Show>

      <box flexGrow={1} flexDirection="column" gap={0}>
        <For each={visible()}>
          {(item) => {
            const selected = item.index === props.rowIdx
            const isHeading = item.line.length > 0 && !item.line.startsWith(" ") && !item.line.startsWith("→")
            return (
              <text
                fg={
                  selected
                    ? theme.accent
                    : isHeading
                      ? theme.text
                      : item.line.startsWith("[")
                        ? theme.warning
                        : theme.textMuted
                }
                attributes={selected || isHeading ? TextAttributes.BOLD : TextAttributes.NONE}
                wrapMode="none"
                onMouseUp={() => props.onSelectRow(item.index)}
              >
                {short(item.line, Math.max(20, props.terminalWidth - 4))}
              </text>
            )
          }}
        </For>
      </box>

      <text fg={theme.textMuted} wrapMode="none" height={1}>
        j/k scroll · 1-6 sections · r rescan · tab back to tests · ? help
      </text>
    </box>
  )
}
