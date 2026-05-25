import { For, Show, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short, relativeTime } from "../types"
import type { TestFileEntry } from "../types"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface TestFileDetailPanelProps {
  file: TestFileEntry | undefined
  onRunFile?: (filePath: string) => void
}

export function TestFileDetailPanel(props: TestFileDetailPanelProps) {
  const [showOverview, setShowOverview] = createSignal(true)
  const [showCases, setShowCases] = createSignal(true)

  const file = () => props.file
  if (!file()) return null

  const lastMod = relativeTime(new Date(file()!.lastModified).toISOString())

  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        {"\u25b6"} Test File
      </text>
      <text
        fg={theme.cyan}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={() => file() && props.onRunFile?.(file()!.filePath)}
      >
        {short(file()!.relativePath, 30)}
      </text>

      <text fg={theme.textMuted} wrapMode="none"> </text>
      <text
        fg={theme.text}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={() => setShowOverview((v) => !v)}
      >
        {showOverview() ? "\u25bc" : "\u25b6"} Overview
      </text>
      <Show when={showOverview()}>
        <text fg={theme.textMuted} wrapMode="none">size: {formatBytes(file()!.size)}</text>
        <text fg={theme.textMuted} wrapMode="none">modified: {lastMod}</text>
        <text fg={theme.textMuted} wrapMode="none">cases: {file()!.testCount}</text>
        <text fg={theme.textMuted} wrapMode="none">declarations: {file()!.declarationCount}</text>
        <text fg={file()!.benchmarkCount > 0 ? theme.yellow : theme.textMuted} wrapMode="none">
          benchmarks: {file()!.benchmarkCount}
        </text>
        <Show when={file()!.unresolvedEachCount > 0}>
          <text fg={theme.warning} wrapMode="none">dynamic each: {file()!.unresolvedEachCount}</text>
        </Show>
      </Show>

      <text fg={theme.textMuted} wrapMode="none"> </text>
      <text
        fg={theme.blue}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={() => setShowCases((v) => !v)}
      >
        {showCases() ? "\u25bc" : "\u25b6"} Cases
      </text>
      <Show when={showCases()}>
        <Show
          when={file()!.tests.length > 0}
          fallback={<text fg={theme.textMuted}>No static test names found.</text>}
        >
          <For each={file()!.tests.slice(0, 15)}>
            {(test) => {
              const color = test.kind === "benchmark" ? theme.yellow : test.kind === "describe" ? theme.textMuted : theme.text
              const marker = test.kind === "benchmark" ? "B" : test.kind === "describe" ? "D" : "T"
              const each = test.mode === "each" ? " x" + (test.caseCount ?? "?") : ""
              return (
                <text fg={color} wrapMode="none" onMouseUp={() => {}}>
                  {marker} L{String(test.line).padStart(4)}{each.padEnd(4)} {short(test.name, 20)}
                </text>
              )
            }}
          </For>
          <Show when={file()!.tests.length > 15}>
            <text
              fg={theme.textMuted}
              wrapMode="none"
              onMouseUp={() => setShowCases(true)}
            >
              ... {file()!.tests.length - 15} more
            </text>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
