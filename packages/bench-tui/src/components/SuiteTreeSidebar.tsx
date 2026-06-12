import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short, suiteStatusIcon, type SuiteExecStatus, type SuiteGroupState, type SuiteFileState } from "../types"

interface SuiteTreeRow {
  kind: "group" | "file"
  group: string
  label: string
  icon: string
  status?: SuiteExecStatus
  file?: SuiteFileState
  counts?: { pass: number; fail: number; total: number; running: number; notRun: number }
}

interface SuiteTreeSidebarProps {
  rows: SuiteTreeRow[]
  treeIdx: number
  treeScrollOff: number
  pageHeight: number
  focused: boolean
  width: number
  onFocus: () => void
  onSelectRow: (index: number) => void
  onActivate: () => void
  onScroll: (direction: 1 | -1) => void
  onToggleGroup: (name: string) => void
  onRunGroup: (name: string) => void
  onRunFile: (filePath: string) => void
  runningFiles: Set<string>
  groups: SuiteGroupState[]
}

function statusColor(s: SuiteExecStatus | undefined) {
  switch (s) {
    case "pass":
      return theme.success
    case "fail":
      return theme.error
    case "running":
      return theme.warning
    case "skip":
      return theme.textMuted
    case "todo":
      return theme.purple
    case "mixed":
      return theme.orange
    default:
      return theme.textMuted
  }
}

export function SuiteTreeSidebar(props: SuiteTreeSidebarProps) {
  const visible = createMemo(() => props.rows.slice(props.treeScrollOff, props.treeScrollOff + props.pageHeight))
  const totalFail = createMemo(() => props.groups.reduce((s, g) => s + g.failingFiles, 0))
  const totalPass = createMemo(() => props.groups.reduce((s, g) => s + g.passingFiles, 0))
  const totalFiles = createMemo(() => props.groups.reduce((s, g) => s + g.totalFiles, 0))
  const totalRunning = createMemo(() => props.runningFiles.size)

  // Scrollbar geometry
  const scrollFrac = createMemo(() => {
    const total = props.rows.length
    if (total <= props.pageHeight) return { top: 0, height: props.pageHeight }
    const ratio = props.pageHeight / total
    const thumbH = Math.max(1, Math.floor(props.pageHeight * ratio))
    const topRange = props.pageHeight - thumbH
    const off = total - props.pageHeight
    const top = off > 0 ? Math.round((props.treeScrollOff / off) * topRange) : 0
    return { top, height: thumbH }
  })

  return (
    <box
      width={props.width}
      border
      borderColor={props.focused ? theme.borderFocus : theme.border}
      backgroundColor={theme.surface}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
      onMouseOver={props.onFocus}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScroll(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={props.focused ? theme.accent : theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        Test Suites ({props.groups.length})
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {totalPass()}✓ {totalFail()}✗ {totalRunning()}● / {totalFiles()}
      </text>

      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          <For each={visible()}>
            {(row, i) => {
              const realIdx = props.treeScrollOff + i()
              const isSel = realIdx === props.treeIdx
              const isFocusedRow = isSel && props.focused
              const cur = row.kind === "group" ? row.counts! : { pass: 0, fail: 0, total: 0, running: 0, notRun: 0 }
              const groupHasFail = row.kind === "group" && cur.fail > 0
              const groupHasRun = row.kind === "group" && cur.running > 0

              if (row.kind === "group") {
                const fg = isFocusedRow
                  ? theme.bg
                  : groupHasRun
                    ? theme.warning
                    : groupHasFail
                      ? theme.error
                      : cur.pass > 0
                        ? theme.success
                        : theme.text
                const bg = isFocusedRow ? theme.accent : isSel ? theme.surfaceActive : undefined
                const summary = `${cur.pass}✓ ${cur.fail}✗`.padStart(8)
                return (
                  <text
                    fg={fg}
                    bg={bg}
                    wrapMode="none"
                    attributes={isSel ? TextAttributes.BOLD : TextAttributes.NONE}
                    onMouseOver={() => props.onSelectRow(realIdx)}
                    onMouseUp={(event) => {
                      props.onSelectRow(realIdx)
                      if (event.modifiers.ctrl || event.modifiers.shift) props.onRunGroup(row.group)
                      else props.onToggleGroup(row.group)
                    }}
                  >
                    {isSel ? "▸" : " "}
                    {row.icon} {short(row.label, props.width - 14).padEnd(props.width - 14)}
                    {summary}
                  </text>
                )
              }

              const st = row.status ?? "notrun"
              const isRunning = st === "running"
              const fg = isFocusedRow ? theme.bg : isRunning ? theme.warning : statusColor(st)
              const bg = isFocusedRow ? theme.accent : isSel ? theme.surfaceActive : undefined
              const icon = suiteStatusIcon(st)
              const dur = row.file?.lastRun?.durationMs
              const durStr = dur ? `${Math.round(dur)}ms`.padStart(6) : "      "
              return (
                <text
                  fg={fg}
                  bg={bg}
                  wrapMode="none"
                  attributes={isSel ? TextAttributes.BOLD : TextAttributes.NONE}
                  onMouseOver={() => props.onSelectRow(realIdx)}
                  onMouseUp={(event) => {
                    props.onSelectRow(realIdx)
                    if (event.modifiers.ctrl || event.modifiers.shift) {
                      if (row.file) props.onRunFile(row.file.filePath)
                    }
                  }}
                >
                  {isSel ? "▸" : " "} {icon} {short(row.label, props.width - 12).padEnd(props.width - 12)}
                  {durStr}
                </text>
              )
            }}
          </For>
          <Show when={visible().length === 0}>
            <text fg={theme.textMuted}>No test files match filter.</text>
          </Show>
        </box>

        {/* Scrollbar */}
        <Show when={props.rows.length > props.pageHeight}>
          <box width={1} flexDirection="column">
            <For each={Array.from({ length: props.pageHeight })}>
              {(_, i) => {
                const inThumb = i() >= scrollFrac().top && i() < scrollFrac().top + scrollFrac().height
                return (
                  <text fg={inThumb ? theme.scrollbarThumb : theme.scrollbar} wrapMode="none">
                    {inThumb ? "█" : "│"}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
      </box>

      <text fg={theme.textMuted} wrapMode="none">
        {props.focused ? "↵ run  space=toggle  R=all  Ctrl+P=jump" : "hover/click to focus"}
      </text>
    </box>
  )
}
