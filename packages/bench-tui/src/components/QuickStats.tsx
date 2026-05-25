import { TextAttributes } from "@opentui/core"
import { Show, createSignal } from "solid-js"
import { theme } from "../theme"
import { fmt, fmtDelta } from "../types"
import type { CompareResult, LoadedRun, TestFileEntry } from "../types"

interface QuickStatsProps {
  runs: LoadedRun[]
  allTests: () => any[]
  testFiles: TestFileEntry[]
  compareRows: CompareResult[]
}

export function QuickStats(props: QuickStatsProps) {
  const [showDashboard, setShowDashboard] = createSignal(true)
  const [showCompare, setShowCompare] = createSignal(true)

  const improved = () => props.compareRows.filter((row) => row.deltaPercent < -1).length
  const regressed = () => props.compareRows.filter((row) => row.deltaPercent > 1).length
  const critical = () => props.compareRows.filter((row) => row.severity === "critical").length
  const stableCount = () => props.compareRows.filter((row) => Math.abs(row.deltaPercent) <= 1).length
  const avgDelta = () =>
    props.compareRows.length > 0
      ? props.compareRows.reduce((sum, row) => sum + row.deltaPercent, 0) / props.compareRows.length
      : 0
  const testCases = () => props.testFiles.reduce((sum, file) => sum + file.testCount, 0)
  const declarations = () => props.testFiles.reduce((sum, file) => sum + file.declarationCount, 0)
  const unresolvedEach = () => props.testFiles.reduce((sum, file) => sum + file.unresolvedEachCount, 0)
  const benchmarkFiles = () => props.testFiles.filter((file) => file.hasBenchmarks).length
  const totalRecords = () => props.runs.reduce((s, r) => s + r.run.records.length, 0)

  return (
    <box flexDirection="column" paddingTop={1}>
      <text
        fg={theme.blue}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={() => setShowDashboard((v) => !v)}
      >
        {showDashboard ? "\u25bc" : "\u25b6"} Dashboard
      </text>
      <Show when={showDashboard()}>
        <text fg={theme.textMuted} wrapMode="none">runs: {props.runs.length}</text>
        <text fg={theme.textMuted} wrapMode="none">benchmarks: {props.allTests().length}</text>
        <text fg={theme.textMuted} wrapMode="none">files: {props.testFiles.length}</text>
        <text fg={theme.textMuted} wrapMode="none">cases: {testCases()}</text>
        <text fg={theme.textMuted} wrapMode="none">decl: {declarations()}</text>
        <Show when={unresolvedEach() > 0}>
          <text fg={theme.warning} wrapMode="none">dynamic: {unresolvedEach()}</text>
        </Show>
        <text fg={theme.textMuted} wrapMode="none">bench files: {benchmarkFiles()}</text>
        <text fg={theme.textMuted} wrapMode="none">
          avg/run: {props.runs.length > 0 ? fmt(totalRecords() / props.runs.length, 1) : "0"}
        </text>
      </Show>

      <text fg={theme.textMuted} wrapMode="none"> </text>
      <text
        fg={theme.cyan}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={() => setShowCompare((v) => !v)}
      >
        {showCompare() ? "\u25bc" : "\u25b6"} Compare
      </text>
      <Show when={showCompare()}>
        <Show
          when={props.compareRows.length > 0}
          fallback={<text fg={theme.textMuted}>No active compare</text>}
        >
          <text fg={theme.success} wrapMode="none">faster: {improved()}</text>
          <text fg={theme.error} wrapMode="none">slower: {regressed()}</text>
          <Show when={critical() > 0}>
            <text fg={theme.error} attributes={TextAttributes.BOLD} wrapMode="none">
              critical: {critical()}
            </text>
          </Show>
          <text fg={theme.textMuted} wrapMode="none">stable: {stableCount()}</text>
          <text
            fg={avgDelta() > 1 ? theme.error : avgDelta() < -1 ? theme.success : theme.textMuted}
            wrapMode="none"
          >
            avg: {fmtDelta(avgDelta())}
          </text>
        </Show>
      </Show>
    </box>
  )
}
