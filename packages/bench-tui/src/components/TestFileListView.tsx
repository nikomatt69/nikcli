import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, formatBytes, ratioBar } from "../theme"
import { short } from "../types"
import type { TestFileEntry } from "../types"

interface TestFileListViewProps {
  filteredTestFiles: () => TestFileEntry[]
  runningTest: string | null
  onRunFile: (filePath: string) => void
  scrollOff: number
  pageHeight: number
  rowIdx: number
  onSelectRow: (index: number) => void
  onScrollRows: (direction: 1 | -1) => void
}

export function TestFileListView(props: TestFileListViewProps) {
  const files = () => props.filteredTestFiles().slice(props.scrollOff, props.scrollOff + props.pageHeight)
  const all = () => props.filteredTestFiles()
  const totalCases = () => all().reduce((s, f) => s + f.testCount, 0)
  const totalDecls = () => all().reduce((s, f) => s + f.declarationCount, 0)
  const totalBm = () => all().reduce((s, f) => s + f.benchmarkCount, 0)
  const benchFileRate = () => (all().length > 0 ? all().filter((f) => f.hasBenchmarks).length / all().length : 0)

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRows(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        Test File Explorer / {all().length} files / benchmark density {ratioBar(benchFileRate(), 12)}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" test file (enter=run)                           cases  decl  benches  size"}
      </text>
      <For each={files()}>
        {(file, i) => {
          const realIdx = props.scrollOff + i()
          const isSel = realIdx === props.rowIdx
          const isRunning = props.runningTest === file.filePath
          const fg = isRunning ? theme.warning : isSel ? theme.accent : theme.text
          const icon = isRunning ? "\u25cf" : file.hasBenchmarks ? "\u25c6" : "\u25cb"
          const cases = `${file.testCount}${file.unresolvedEachCount > 0 ? "+" : ""}`
          const attrs = isSel || isRunning ? TextAttributes.BOLD : TextAttributes.NONE
          return (
            <text
              fg={fg}
              wrapMode="none"
              attributes={attrs}
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={(event) => {
                props.onSelectRow(realIdx)
                if (event.modifiers.ctrl || event.button === 1) props.onRunFile(file.filePath)
              }}
            >
              {isSel ? "\u25b8" : " "} {icon} {short(file.relativePath, 46).padEnd(46)}
              {cases.padStart(5)}
              {String(file.declarationCount).padStart(6)}
              {String(file.benchmarkCount).padStart(8)}
              {formatBytes(file.size).padStart(7)}
            </text>
          )
        }}
      </For>
      <Show
        when={files().length > 0}
        fallback={<text fg={theme.textMuted}>No test files found. Press r to run benchmarks.</text>}
      >
        <text fg={theme.textMuted} wrapMode="none">
          {"─"} visible {files().length}/{all().length} files | {totalDecls()} declarations | {totalCases()} cases |{" "}
          {totalBm()} benchmarks
        </text>
      </Show>
    </box>
  )
}
