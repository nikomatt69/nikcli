import path from "path"
import { Glob } from "bun"
import { createMemo, createSignal, onMount } from "solid-js"
import {
  clamp,
  PKG_ROOT,
  groupForRelative,
  type LoadedRun,
  type RunIndex,
  type RunnerState,
  type SortMode,
  type ViewMode,
  type FocusPane,
  type CompareResult,
  type Alert,
  type AlertSeverity,
  type TestFileEntry,
  type SuiteFileState,
  type SuiteGroupState,
  type SuiteRunResult,
  type SuiteSortMode,
  type SuiteExecStatus,
} from "./types"
import type { TestCaseEntry } from "./types"
import { loadConfig } from "./types"
import { buildCompareResults, buildRunIndex } from "./data/indexer"
import { loadAllRuns } from "./data/loader"
import { runBenchmarks, runSingleBenchmark } from "./data/runner"
import { runTestFile, loadAllHistory, appendHistory, clearHistoryFor } from "./data/suite-runner"

const NIKCLI_TEST_DIR = path.join(PKG_ROOT, "test")
const VIEW_SEQUENCE: ViewMode[] = ["suite", "compare", "leaderboard", "detail", "files"]

export function createBenchState() {
  const config = loadConfig()

  // Core signals
  const [runs, setRuns] = createSignal<LoadedRun[]>([])
  const [runIdx, setRunIdx] = createSignal(0)
  const [runScrollOff, setRunScrollOff] = createSignal(0)
  const [runPageSize, setRunPageSize] = createSignal(config.pageSize)
  const [rowIdx, setRowIdx] = createSignal(0)
  const [scrollOff, setScrollOff] = createSignal(0)
  const [state, setState] = createSignal<RunnerState>("idle")
  const [exitCode, setExitCode] = createSignal<number | undefined>()
  const [logLines, setLogLines] = createSignal<string[]>([])
  const [sortMode, setSortMode] = createSignal<SortMode>("value")
  const [sortAsc, setSortAsc] = createSignal(false)
  const [viewMode, setViewMode] = createSignal<ViewMode>("suite")
  const [runIndex, setRunIndex] = createSignal<RunIndex>(new Map())
  const [filterMode, setFilterMode] = createSignal(false)
  const [filterText, setFilterText] = createSignal("")
  const [compareMode, setCompareMode] = createSignal(false)
  const [compareLeft, setCompareLeft] = createSignal<string | null>(null)
  const [compareRight, setCompareRight] = createSignal<string | null>(null)
  const [compareResults, setCompareResults] = createSignal<CompareResult[]>([])
  const [baselineRunId, setBaselineRunId] = createSignal<string | null>(null)
  const [helpMode, setHelpMode] = createSignal(false)
  const [runStartTime, setRunStartTime] = createSignal<number | null>(null)
  const [terminalHeight, setTerminalHeight] = createSignal(24)
  const [terminalWidth, setTerminalWidth] = createSignal(80)
  const [testFiles, setTestFiles] = createSignal<TestFileEntry[]>([])
  const [runningTest, setRunningTest] = createSignal<string | null>(null)
  const [focusPane, setFocusPane] = createSignal<FocusPane>("tree")
  const [alerts, setAlerts] = createSignal<Alert[]>([])
  const [loading, setLoading] = createSignal(true)

  // -------- Suite state --------
  const [suiteHistory, setSuiteHistory] = createSignal<Map<string, SuiteRunResult[]>>(new Map())
  const [suiteRunningFiles, setSuiteRunningFiles] = createSignal<Set<string>>(new Set())
  const [suiteRunQueue, setSuiteRunQueue] = createSignal<string[]>([])
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const [selectedGroup, setSelectedGroup] = createSignal<string | null>(null)
  const [treeIdx, setTreeIdx] = createSignal(0)
  const [treeScrollOff, setTreeScrollOff] = createSignal(0)
  const [suiteSortMode, setSuiteSortMode] = createSignal<SuiteSortMode>("name")
  const [suiteStatusFilter, setSuiteStatusFilter] = createSignal<SuiteExecStatus | "all">("all")
  const [showOnlyFailures, setShowOnlyFailures] = createSignal(false)
  const [autoExpandOnFail, setAutoExpandOnFail] = createSignal(true)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal("")
  const [paletteCursor, setPaletteCursor] = createSignal(0)

  // Memos
  const activeRun = createMemo(() => runs()[runIdx()])

  const baselineRun = createMemo(() => {
    const bid = baselineRunId()
    const active = activeRun()
    if (bid) return runs().find((r) => r.filePath === bid || r.run.runId === bid)
    return [...runs()].reverse().find((r) => r.run.runId !== active?.run.runId)
  })

  const allTests = createMemo(() => [...runIndex().values()])

  const filteredTests = createMemo(() => {
    const ft = filterText().toLowerCase().trim()
    if (!ft) return allTests()
    return allTests().filter(
      (t) =>
        t.scenario.toLowerCase().includes(ft) ||
        t.module.toLowerCase().includes(ft) ||
        t.suite.toLowerCase().includes(ft) ||
        t.unit.toLowerCase().includes(ft),
    )
  })

  const sortedFiltered = createMemo(() => {
    const rows = [...filteredTests()]
    const asc = sortAsc() ? 1 : -1
    switch (sortMode()) {
      case "value":
        return rows.sort((a, b) => (b.avgValue - a.avgValue) * asc)
      case "module":
        return rows.sort((a, b) => a.module.localeCompare(b.module) || (b.avgValue - a.avgValue) * asc)
      case "name":
        return rows.sort((a, b) => a.scenario.localeCompare(b.scenario) * asc)
      case "delta":
        return rows.sort((a, b) => (b.stdDev - a.stdDev) * asc)
      case "trend": {
        const trendOrder = { up: 0, stable: 1, down: 2 }
        return rows.sort((a, b) => (trendOrder[a.trend] - trendOrder[b.trend]) * asc)
      }
      default:
        return rows
    }
  })

  const pageHeight = (th: number) => Math.max(1, th - 22)

  const leaderboardRows = createMemo(() => {
    const rows = [...filteredTests()].sort((a, b) => a.avgValue - b.avgValue)
    return sortAsc() ? rows.reverse() : rows
  })

  const activeCompareResults = createMemo(() => {
    const active = activeRun()
    const baseline = baselineRun()
    if (!active || !baseline || active.run.runId === baseline.run.runId) return []
    return buildCompareResults(runs(), active.run.runId, baseline.run.runId)
  })

  const dashboardRows = createMemo(() => {
    const ft = filterText().toLowerCase().trim()
    let rows = activeCompareResults().filter(
      (row) =>
        !ft ||
        row.scenario.toLowerCase().includes(ft) ||
        row.module.toLowerCase().includes(ft) ||
        row.suite.toLowerCase().includes(ft),
    )
    const asc = sortAsc() ? 1 : -1
    switch (sortMode()) {
      case "module":
        rows = rows.sort(
          (a, b) => a.module.localeCompare(b.module) || (Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent)) * asc,
        )
        break
      case "name":
        rows = rows.sort((a, b) => a.scenario.localeCompare(b.scenario) * asc)
        break
      case "trend":
        rows = rows.sort((a, b) => (b.deltaPercent - a.deltaPercent) * asc)
        break
      default:
        rows = rows.sort((a, b) => (Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent)) * asc)
    }
    return rows
  })

  const selectedCompareResult = createMemo(() => dashboardRows()[rowIdx()])
  const selectedTest = createMemo(() => {
    const compared = selectedCompareResult()
    if (viewMode() === "compare" && compared) return runIndex().get(compared.key)
    return sortedFiltered()[rowIdx()]
  })

  const filteredTestFiles = createMemo(() => {
    const ft = filterText().toLowerCase().trim()
    if (!ft) return testFiles()
    return testFiles().filter(
      (f) =>
        f.fileName.toLowerCase().includes(ft) ||
        f.relativePath.toLowerCase().includes(ft) ||
        f.tests.some((test) => test.name.toLowerCase().includes(ft)),
    )
  })

  const selectedTestFile = createMemo(() => filteredTestFiles()[rowIdx()])

  const currentRowCount = createMemo(() => {
    if (compareMode()) return compareResults().length
    // suite view uses treeIdx/suiteTreeRows for navigation, not rowIdx
    if (viewMode() === "files") return filteredTestFiles().length
    if (viewMode() === "compare") return dashboardRows().length
    if (viewMode() === "leaderboard") return leaderboardRows().length
    return sortedFiltered().length
  })

  const activeRunDelta = createMemo(() => {
    const run = activeRun()
    const bid = baselineRunId()
    if (!run || !bid) return null
    const baseline = runs().find((r) => r.filePath === bid || r.run.runId === bid)
    if (!baseline) return null
    const curAvg =
      run.run.records.length > 0 ? run.run.records.reduce((s, r) => s + r.value, 0) / run.run.records.length : 0
    const baseAvg =
      baseline.run.records.length > 0
        ? baseline.run.records.reduce((s, r) => s + r.value, 0) / baseline.run.records.length
        : 0
    if (baseAvg === 0) return null
    return ((curAvg - baseAvg) / baseAvg) * 100
  })

  const runDuration = createMemo(() => {
    const t = runStartTime()
    if (!t || state() !== "running") return null
    return Date.now() - t
  })

  const hasAlerts = createMemo(() => alerts().filter((a) => !a.dismissed).length > 0)

  // Alert management
  function addAlert(severity: AlertSeverity, message: string, source: string, detail?: string) {
    const alert: Alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      severity,
      message,
      detail,
      timestamp: Date.now(),
      source,
    }
    setAlerts((prev) => [...prev, alert].slice(-config.maxLogLines))
  }

  function dismissAlert(id: string) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed: true } : a)))
  }

  function dismissAllAlerts() {
    setAlerts((prev) => prev.map((a) => ({ ...a, dismissed: true })))
  }

  // Log management
  function appendLog(chunk: string) {
    const lines = chunk.replace(/\r/g, "").split("\n").filter(Boolean)
    if (!lines.length) return
    setLogLines((cur) => [...cur, ...lines].slice(-config.maxLogLines))
  }

  function clearLogs() {
    setLogLines([])
  }

  // Cursor management
  function setCursor(index: number) {
    const max = Math.max(0, currentRowCount() - 1)
    const target = clamp(index, 0, max)
    const ph = pageHeight(terminalHeight())
    setRowIdx(target)
    setScrollOff((offset) => {
      if (target < offset) return target
      if (target >= offset + ph) return Math.max(0, target - ph + 1)
      return offset
    })
  }

  function moveCursor(delta: number) {
    setCursor(rowIdx() + delta)
  }

  function pageCursor(direction: 1 | -1) {
    moveCursor(pageHeight(terminalHeight()) * direction)
  }

  function jumpCursor(edge: "first" | "last") {
    setCursor(edge === "first" ? 0 : Math.max(0, currentRowCount() - 1))
  }

  function scrollRows(direction: 1 | -1, amount = 3) {
    const ph = pageHeight(terminalHeight())
    const maxOffset = Math.max(0, currentRowCount() - ph)
    const nextOffset = clamp(scrollOff() + direction * amount, 0, maxOffset)
    setScrollOff(nextOffset)
    if (rowIdx() < nextOffset) setRowIdx(nextOffset)
    if (rowIdx() >= nextOffset + ph) setRowIdx(Math.max(0, nextOffset + ph - 1))
  }

  // View management
  function selectView(mode: ViewMode) {
    setCompareMode(false)
    setViewMode(mode)
    setFocusPane(mode === "suite" ? "tree" : "main")
    setRowIdx(0)
    setScrollOff(0)
    if (mode === "suite") {
      setTreeCursor(treeIdx())
    }
  }

  function cycleView() {
    const cur = VIEW_SEQUENCE.indexOf(viewMode())
    selectView(VIEW_SEQUENCE[(cur + 1) % VIEW_SEQUENCE.length]!)
  }

  function cycleViewBack() {
    const cur = VIEW_SEQUENCE.indexOf(viewMode())
    selectView(VIEW_SEQUENCE[(cur - 1 + VIEW_SEQUENCE.length) % VIEW_SEQUENCE.length]!)
  }

  // Run selection
  function selectRun(index: number) {
    const target = clamp(index, 0, Math.max(0, runs().length - 1))
    const page = Math.max(1, runPageSize())
    setRunIdx(target)
    setRunScrollOff((offset) => {
      if (target < offset) return target
      if (target >= offset + page) return Math.max(0, target - page + 1)
      return offset
    })
    setFocusPane("runs")
    if (viewMode() !== "compare") {
      setRowIdx(0)
      setScrollOff(0)
    }
  }

  function moveRun(delta: number) {
    selectRun(runIdx() + delta)
  }

  function scrollRuns(direction: 1 | -1, amount = 3) {
    selectRun(runIdx() + direction * amount)
  }

  function resizeRunPage(size: number) {
    const page = Math.max(1, size)
    setRunPageSize(page)
    const target = runIdx()
    setRunScrollOff((offset) => {
      if (target < offset) return target
      if (target >= offset + page) return Math.max(0, target - page + 1)
      return clamp(offset, 0, Math.max(0, runs().length - page))
    })
  }

  // Focus management
  function cycleFocus(delta: 1 | -1) {
    const panes: FocusPane[] =
      viewMode() === "suite" ? ["tree", "main", "detail", "logs"] : ["runs", "main", "detail", "logs"]
    const cur = Math.max(0, panes.indexOf(focusPane()))
    setFocusPane(panes[(cur + delta + panes.length) % panes.length]!)
  }

  // Sort management
  function cycleSort() {
    const modes: SortMode[] = ["value", "module", "name", "delta", "trend"]
    const cur = modes.indexOf(sortMode())
    setSortMode(modes[(cur + 1) % modes.length]!)
    setRowIdx(0)
    setScrollOff(0)
  }

  function toggleSortAsc() {
    setSortAsc((v) => !v)
  }

  // Data refresh
  async function refresh() {
    setLoading(true)
    try {
      const [all, files] = await Promise.all([loadAllRuns({ force: true }), scanTestFiles()])
      setRuns(all)
      setRunIdx((i) => clamp(i, 0, Math.max(0, all.length - 1)))
      setRunScrollOff((i) => clamp(i, 0, Math.max(0, all.length - runPageSize())))
      setRowIdx(0)
      setScrollOff(0)
      setRunIndex(buildRunIndex(all))
      setTestFiles(files)
    } catch (err) {
      addAlert("error", `Refresh failed: ${err instanceof Error ? err.message : err}`, "system")
    } finally {
      setLoading(false)
    }
  }

  // Run benchmarks
  async function runBench() {
    if (state() === "running") return
    const baselinePath = baselineRunId() ?? runs()[0]?.filePath
    setExitCode(undefined)
    setRunStartTime(Date.now())
    setLogLines([])
    await runBenchmarks(
      {
        onLog: appendLog,
        onStateChange: (s, code) => {
          setState(s)
          if (code !== undefined) {
            setExitCode(code)
            if (code !== 0) addAlert("error", `Benchmark exited with code ${code}`, "runner")
          }
        },
        onStart: () => {},
        onDone: async () => {
          setRunStartTime(null)
          setRunIdx(0)
          await refresh()
          const runCount = runs().length
          addAlert("info", `Benchmark complete. ${runCount} run(s) available.`, "runner")
        },
      },
      baselinePath,
    )
  }

  // Run single test file
  async function runSingleTest(filePath: string) {
    if (state() === "running") return
    setRunningTest(filePath)
    setLogLines([])
    const baselinePath = baselineRunId() ?? runs()[0]?.filePath
    setExitCode(undefined)
    setRunStartTime(Date.now())
    setState("running")

    await runSingleBenchmark(
      filePath,
      {
        onLog: appendLog,
        onStateChange: (s, code) => {
          setState(s)
          if (code !== undefined) setExitCode(code)
        },
        onStart: () => {},
        onDone: async () => {
          setRunStartTime(null)
          setRunningTest(null)
          await refresh()
        },
      },
      baselinePath,
    )
  }

  // Delete run
  async function deleteRun(filePath: string) {
    try {
      const { unlinkSync } = await import("fs")
      unlinkSync(filePath)
      appendLog(`\u2713 Deleted ${filePath.split("/").pop() ?? filePath}`)
      await refresh()
    } catch (err) {
      addAlert("error", `Failed to delete run: ${err instanceof Error ? err.message : err}`, "runner")
    }
  }

  // Export run data
  async function exportRun(filePath: string) {
    try {
      const { readFileSync, writeFileSync } = await import("fs")
      const content = readFileSync(filePath, "utf8")
      const exportPath = filePath.replace(".json", ".exported.json")
      writeFileSync(exportPath, JSON.stringify(JSON.parse(content), null, 2))
      appendLog(`\u2713 Exported to ${exportPath.split("/").pop()}`)
    } catch (err) {
      addAlert("error", `Export failed: ${err instanceof Error ? err.message : err}`, "runner")
    }
  }

  // Baseline management
  function setRunAsBaseline(runId: string) {
    const run = runs().find((r) => r.run.runId === runId)
    if (run) {
      setBaselineRunId(run.filePath)
      appendLog(`\u2605 Baseline set to ${run.run.runId.slice(0, 16)}...`)
    }
  }

  // Compare management
  function doCompare(leftRunId: string, rightRunId: string) {
    const results = buildCompareResults(runs(), leftRunId, rightRunId)
    setCompareResults(results)
    setCompareLeft(leftRunId)
    setCompareRight(rightRunId)
    setCompareMode(true)
    setRowIdx(0)
    setScrollOff(0)
    const criticalCount = results.filter((r) => r.severity === "critical").length
    if (criticalCount > 0) {
      addAlert("warning", `${criticalCount} critical performance differences found`, "compare")
    }
  }

  function swapCompare() {
    const left = compareLeft()
    const right = compareRight()
    if (left && right) {
      doCompare(right, left)
    }
  }

  // ============================================================
  // Suite memos & actions
  // ============================================================

  function fileStateFor(file: TestFileEntry): SuiteFileState {
    const history = suiteHistory().get(file.relativePath) ?? []
    return {
      filePath: file.filePath,
      relativePath: file.relativePath,
      fileName: file.fileName,
      group: groupForRelative(file.relativePath),
      lastRun: history[history.length - 1],
      history,
    }
  }

  function fileStatus(fs: SuiteFileState): SuiteExecStatus {
    if (suiteRunningFiles().has(fs.filePath)) return "running"
    return fs.lastRun?.status ?? "notrun"
  }

  const suiteFileStates = createMemo<SuiteFileState[]>(() => testFiles().map(fileStateFor))

  const suiteFilteredFiles = createMemo<SuiteFileState[]>(() => {
    const ft = filterText().toLowerCase().trim()
    const onlyFail = showOnlyFailures()
    const statusFilter = suiteStatusFilter()
    const rows = suiteFileStates().filter((fs) => {
      if (onlyFail && fileStatus(fs) !== "fail") return false
      if (statusFilter !== "all" && fileStatus(fs) !== statusFilter) return false
      if (!ft) return true
      return (
        fs.relativePath.toLowerCase().includes(ft) ||
        fs.fileName.toLowerCase().includes(ft) ||
        fs.group.toLowerCase().includes(ft)
      )
    })
    const statusRank: Record<string, number> = { fail: 0, running: 1, mixed: 2, pass: 3, skip: 4, todo: 5, notrun: 6 }
    const mode = suiteSortMode()
    return rows.sort((a, b) => {
      if (mode === "status")
        return statusRank[fileStatus(a)] - statusRank[fileStatus(b)] || a.relativePath.localeCompare(b.relativePath)
      if (mode === "duration")
        return (
          (b.lastRun?.durationMs ?? -1) - (a.lastRun?.durationMs ?? -1) || a.relativePath.localeCompare(b.relativePath)
        )
      if (mode === "lastRun")
        return (b.lastRun?.startedAt ?? 0) - (a.lastRun?.startedAt ?? 0) || a.relativePath.localeCompare(b.relativePath)
      if (mode === "group") return a.group.localeCompare(b.group) || a.relativePath.localeCompare(b.relativePath)
      return a.relativePath.localeCompare(b.relativePath)
    })
  })

  const suiteGroups = createMemo<SuiteGroupState[]>(() => {
    const buckets = new Map<string, SuiteFileState[]>()
    for (const fs of suiteFilteredFiles()) {
      const g = fs.group
      const list = buckets.get(g) ?? []
      list.push(fs)
      buckets.set(g, list)
    }
    const groups: SuiteGroupState[] = []
    for (const [name, files] of buckets.entries()) {
      const sorted = files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      let passing = 0,
        failing = 0,
        notRun = 0,
        running = 0
      for (const f of sorted) {
        const st = fileStatus(f)
        if (st === "pass") passing++
        else if (st === "fail") failing++
        else if (st === "running") running++
        else if (st === "notrun") notRun++
      }
      groups.push({
        name,
        files: sorted,
        expanded: expandedGroups().has(name),
        totalFiles: sorted.length,
        passingFiles: passing,
        failingFiles: failing,
        notRunFiles: notRun,
        runningFiles: running,
      })
    }
    return groups.sort((a, b) => {
      if (a.failingFiles !== b.failingFiles) return b.failingFiles - a.failingFiles
      return a.name.localeCompare(b.name)
    })
  })

  // Flattened tree rows: groups + expanded children
  interface SuiteTreeRow {
    kind: "group" | "file"
    group: string
    label: string
    icon: string
    status?: SuiteExecStatus
    file?: SuiteFileState
    counts?: { pass: number; fail: number; total: number; running: number; notRun: number }
  }

  const suiteTreeRows = createMemo<SuiteTreeRow[]>(() => {
    const out: SuiteTreeRow[] = []
    for (const g of suiteGroups()) {
      out.push({
        kind: "group",
        group: g.name,
        label: g.name,
        icon: g.expanded ? "▼" : "▶",
        counts: {
          pass: g.passingFiles,
          fail: g.failingFiles,
          total: g.totalFiles,
          running: g.runningFiles,
          notRun: g.notRunFiles,
        },
      })
      if (g.expanded) {
        for (const f of g.files) {
          out.push({
            kind: "file",
            group: g.name,
            label: f.fileName,
            icon: " ",
            status: fileStatus(f),
            file: f,
          })
        }
      }
    }
    return out
  })

  const selectedTreeRow = createMemo(() => suiteTreeRows()[treeIdx()])
  const selectedSuiteFile = createMemo(() => {
    const row = selectedTreeRow()
    return row?.kind === "file" ? row.file : undefined
  })

  // Aggregates for dashboard
  const suiteAggregates = createMemo(() => {
    const files = suiteFileStates()
    let passing = 0,
      failing = 0,
      running = 0,
      notRun = 0,
      mixed = 0,
      skipped = 0
    let totalTests = 0,
      totalPassed = 0,
      totalFailed = 0,
      totalSkipped = 0
    let totalDurationMs = 0
    for (const f of files) {
      const st = fileStatus(f)
      if (st === "pass") passing++
      else if (st === "fail") failing++
      else if (st === "running") running++
      else if (st === "mixed") mixed++
      else if (st === "skip") skipped++
      else notRun++
      const lr = f.lastRun
      if (lr) {
        totalTests += lr.totalTests
        totalPassed += lr.passed
        totalFailed += lr.failed
        totalSkipped += lr.skipped
        totalDurationMs += lr.durationMs
      }
    }
    return {
      totalFiles: files.length,
      passing,
      failing,
      running,
      notRun,
      mixed,
      skipped,
      totalTests,
      totalPassed,
      totalFailed,
      totalSkipped,
      totalDurationMs,
      passRate: totalTests > 0 ? totalPassed / totalTests : 0,
    }
  })

  function setTreeCursor(index: number) {
    const max = Math.max(0, suiteTreeRows().length - 1)
    const target = clamp(index, 0, max)
    setTreeIdx(target)
    const ph = pageHeight(terminalHeight())
    setTreeScrollOff((off) => {
      if (target < off) return target
      if (target >= off + ph) return Math.max(0, target - ph + 1)
      return off
    })
  }

  function moveTreeCursor(delta: number) {
    setTreeCursor(treeIdx() + delta)
  }

  function scrollTree(direction: 1 | -1, amount = 3) {
    const ph = pageHeight(terminalHeight())
    const total = suiteTreeRows().length
    const maxOffset = Math.max(0, total - ph)
    const nextOffset = clamp(treeScrollOff() + direction * amount, 0, maxOffset)
    setTreeScrollOff(nextOffset)
    // Keep cursor visible inside new viewport
    if (treeIdx() < nextOffset) setTreeIdx(nextOffset)
    if (treeIdx() >= nextOffset + ph) setTreeIdx(Math.max(0, nextOffset + ph - 1))
  }

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function expandAllGroups() {
    setExpandedGroups(new Set(suiteGroups().map((g) => g.name)))
  }

  function collapseAllGroups() {
    setExpandedGroups(new Set<string>())
  }

  function activateTreeRow() {
    const row = selectedTreeRow()
    if (!row) return
    if (row.kind === "group") toggleGroup(row.group)
    else if (row.file) void runOneFile(row.file.filePath)
  }

  function cycleSuiteSort() {
    const modes: SuiteSortMode[] = ["name", "status", "duration", "lastRun", "group"]
    const cur = modes.indexOf(suiteSortMode())
    setSuiteSortMode(modes[(cur + 1) % modes.length]!)
  }

  async function loadSuiteHistory() {
    try {
      const map = await loadAllHistory()
      setSuiteHistory(map)
    } catch (err) {
      addAlert("warning", `Suite history load failed: ${err instanceof Error ? err.message : err}`, "suite")
    }
  }

  async function runOneFile(filePath: string, options: { preserveRunState?: boolean } = {}) {
    if (suiteRunningFiles().has(filePath)) return
    let failed = false
    const wasIdle = suiteRunningFiles().size === 0
    setSuiteRunningFiles((prev) => new Set(prev).add(filePath))
    if (!options.preserveRunState && wasIdle) setRunStartTime(Date.now())
    if (!options.preserveRunState) setExitCode(undefined)
    setState("running")
    await runTestFile(filePath, {
      onLog: appendLog,
      onStateChange: (s, code) => {
        if (!options.preserveRunState || s === "running") setState(s)
        if (code !== undefined) setExitCode(code)
      },
      onStart: () => {},
      onResult: async (result) => {
        failed = result.exitCode !== 0 || result.status === "fail"
        setExitCode(result.exitCode)
        try {
          await appendHistory(result)
        } catch {}
        setSuiteHistory((prev) => {
          const next = new Map(prev)
          const hist = next.get(result.relativePath) ?? []
          next.set(result.relativePath, [...hist, result].slice(-25))
          return next
        })
        if (result.status === "fail") {
          addAlert(
            "error",
            `${result.relativePath} failed (${result.failed} test${result.failed === 1 ? "" : "s"})`,
            "suite",
          )
          if (autoExpandOnFail()) {
            setExpandedGroups((prev) => new Set(prev).add(groupForRelative(result.relativePath)))
          }
        }
      },
      onDone: () => {
        setSuiteRunningFiles((prev) => {
          const next = new Set(prev)
          next.delete(filePath)
          if (!options.preserveRunState) setState(next.size > 0 ? "running" : failed ? "error" : "success")
          return next
        })
        if (!options.preserveRunState && suiteRunningFiles().size <= 1) setRunStartTime(null)
      },
    })
  }

  async function runGroup(groupName: string) {
    const group = suiteGroups().find((g) => g.name === groupName)
    if (!group) return
    let failed = false
    setSuiteRunQueue(group.files.map((f) => f.filePath))
    setSuiteRunningFiles((prev) => new Set([...prev, ...group.files.map((f) => f.filePath)]))
    setRunStartTime(Date.now())
    setExitCode(undefined)
    setState("running")
    for (const file of group.files) {
      const result = await runTestFile(file.filePath, {
        onLog: appendLog,
        onStateChange: (s, code) => {
          if (s === "running") setState(s)
          if (code !== undefined) setExitCode(code)
        },
        onStart: () => {},
        onResult: async (result) => {
          failed ||= result.exitCode !== 0 || result.status === "fail"
          setExitCode(result.exitCode)
          try {
            await appendHistory(result)
          } catch {}
          setSuiteHistory((prev) => {
            const next = new Map(prev)
            const hist = next.get(result.relativePath) ?? []
            next.set(result.relativePath, [...hist, result].slice(-25))
            return next
          })
          if (result.status === "fail") {
            addAlert(
              "error",
              `${result.relativePath} failed (${result.failed} test${result.failed === 1 ? "" : "s"})`,
              "suite",
            )
            if (autoExpandOnFail())
              setExpandedGroups((prev) => new Set(prev).add(groupForRelative(result.relativePath)))
          }
        },
        onDone: () => {},
      })
      setSuiteRunningFiles((prev) => {
        const next = new Set(prev)
        next.delete(result.filePath)
        return next
      })
      setSuiteRunQueue((prev) => prev.filter((fp) => fp !== result.filePath))
    }
    setSuiteRunQueue([])
    setRunStartTime(null)
    setState(failed ? "error" : "success")
  }

  async function runAllSuite() {
    const all = suiteFilteredFiles().map((f) => f.filePath)
    if (all.length === 0) return
    setSuiteRunQueue(all)
    let failed = false
    setRunStartTime(Date.now())
    setExitCode(undefined)
    setState("running")
    for (const fp of all) {
      await runOneFile(fp, { preserveRunState: true })
      const hist = suiteHistory().get(fp.replace(NIKCLI_TEST_DIR, "").replace(/^\//, ""))
      const latest = hist?.[hist.length - 1]
      failed ||= latest?.status === "fail"
      setSuiteRunQueue((prev) => prev.filter((queued) => queued !== fp))
    }
    setSuiteRunQueue([])
    setRunStartTime(null)
    setState(failed ? "error" : "success")
    addAlert("info", `Suite run complete: ${all.length} files`, "suite")
  }

  async function clearHistoryForSelected() {
    const file = selectedSuiteFile()
    if (!file) return
    await clearHistoryFor(file.relativePath)
    setSuiteHistory((prev) => {
      const next = new Map(prev)
      next.delete(file.relativePath)
      return next
    })
    addAlert("info", `Cleared history for ${file.relativePath}`, "suite")
  }

  function setSuiteRowCount() {
    return suiteTreeRows().length
  }
  void setSuiteRowCount

  // Lifecycle
  onMount(() => {
    void loadSuiteHistory()
    refresh().then(() => {
      // Expand top failing group automatically
      const top = suiteGroups()[0]
      const failing = suiteGroups().find((g) => g.failingFiles > 0)
      if (failing ?? top) setExpandedGroups(new Set([(failing ?? top)!.name]))
    })
  })

  return {
    runs,
    runIdx,
    runScrollOff,
    runPageSize,
    resizeRunPage,
    rowIdx,
    scrollOff,
    state,
    exitCode,
    logLines,
    clearLogs,
    sortMode,
    setSortMode,
    sortAsc,
    setSortAsc,
    viewMode,
    setViewMode,
    runIndex,
    filterMode,
    setFilterMode,
    filterText,
    setFilterText,
    compareMode,
    setCompareMode,
    compareLeft,
    compareRight,
    compareResults,
    setCompareResults,
    baselineRunId,
    setBaselineRunId,
    helpMode,
    setHelpMode,
    runStartTime,
    terminalHeight,
    setTerminalHeight,
    terminalWidth,
    setTerminalWidth,
    testFiles,
    runningTest,
    setRunningTest,
    focusPane,
    setFocusPane,
    alerts,
    loading,

    pageHeight,

    activeRun,
    baselineRun,
    allTests,
    filteredTests,
    sortedFiltered,
    leaderboardRows,
    filteredTestFiles,
    selectedTestFile,
    currentRowCount,
    activeRunDelta,
    runDuration,
    dashboardRows,
    selectedCompareResult,
    selectedTest,
    activeCompareResults,
    hasAlerts,

    setRuns,
    setRunIdx,
    setRunScrollOff,
    setRunPageSize,
    setRowIdx,
    setScrollOff,
    setState,
    setExitCode,
    setLogLines,
    setRunIndex,
    setTestFiles,

    refresh,
    runBench,
    runSingleTest,
    deleteRun,
    exportRun,
    setRunAsBaseline,
    doCompare,
    swapCompare,
    appendLog,
    setCursor,
    moveCursor,
    pageCursor,
    jumpCursor,
    scrollRows,
    selectView,
    cycleView,
    cycleViewBack,
    selectRun,
    moveRun,
    scrollRuns,
    cycleFocus,
    cycleSort,
    toggleSortAsc,
    addAlert,
    dismissAlert,
    dismissAllAlerts,

    // Suite
    suiteHistory,
    suiteRunningFiles,
    suiteRunQueue,
    expandedGroups,
    selectedGroup,
    setSelectedGroup,
    treeIdx,
    treeScrollOff,
    setTreeScrollOff,
    suiteSortMode,
    setSuiteSortMode,
    suiteStatusFilter,
    setSuiteStatusFilter,
    showOnlyFailures,
    setShowOnlyFailures,
    autoExpandOnFail,
    setAutoExpandOnFail,
    suiteFileStates,
    suiteFilteredFiles,
    suiteGroups,
    suiteTreeRows,
    selectedTreeRow,
    selectedSuiteFile,
    suiteAggregates,
    setTreeIdx,
    setTreeCursor,
    moveTreeCursor,
    scrollTree,
    toggleGroup,
    expandAllGroups,
    collapseAllGroups,
    activateTreeRow,
    cycleSuiteSort,
    loadSuiteHistory,
    runOneFile,
    runGroup,
    runAllSuite,
    clearHistoryForSelected,

    // Palette
    paletteOpen,
    setPaletteOpen,
    paletteQuery,
    setPaletteQuery,
    paletteCursor,
    setPaletteCursor,
  }
}

export type BenchState = ReturnType<typeof createBenchState>

export function useBenchState() {
  return createBenchState()
}

function isIdentChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_$]/.test(ch))
}

function skipWhitespace(source: string, index: number): number {
  let i = index
  while (i < source.length && /\s/.test(source[i]!)) i++
  return i
}

function readIdentifier(source: string, index: number): { value: string; end: number } | null {
  if (!/[A-Za-z_$]/.test(source[index] ?? "")) return null
  let end = index + 1
  while (isIdentChar(source[end])) end++
  return { value: source.slice(index, end), end }
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index]
  let i = index + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i++
  }
  return source.length
}

function skipCodeTrivia(source: string, index: number): number {
  const ch = source[index]
  const next = source[index + 1]
  if (ch === "'" || ch === '"' || ch === "`") return skipQuoted(source, index)
  if (ch === "/" && next === "/") {
    const end = source.indexOf("\n", index + 2)
    return end === -1 ? source.length : end + 1
  }
  if (ch === "/" && next === "*") {
    const end = source.indexOf("*/", index + 2)
    return end === -1 ? source.length : end + 2
  }
  return index
}

function findMatching(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const skipped = skipCodeTrivia(source, i)
    if (skipped !== i) {
      i = skipped - 1
      continue
    }
    const ch = source[i]
    if (ch === open) depth++
    if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function readFirstStringArgument(source: string, callIndex: number): { value: string; end: number } | null {
  let i = skipWhitespace(source, callIndex + 1)
  const quote = source[i]
  if (quote !== "'" && quote !== '"' && quote !== "`") return null
  let value = ""
  i++
  while (i < source.length) {
    const ch = source[i]
    if (ch === "\\") {
      value += source[i + 1] ?? ""
      i += 2
      continue
    }
    if (ch === quote) return { value, end: i + 1 }
    value += ch
    i++
  }
  return null
}

function modeFromModifiers(modifiers: string[]): TestCaseEntry["mode"] {
  if (modifiers.includes("only")) return "only"
  if (modifiers.includes("skip")) return "skip"
  if (modifiers.includes("todo")) return "todo"
  if (modifiers.includes("concurrent")) return "concurrent"
  if (modifiers.includes("failing")) return "failing"
  if (modifiers.includes("each")) return "each"
  return "normal"
}

function parseDeclarationAt(
  source: string,
  index: number,
  lineFor: (index: number) => number,
): { entry: TestCaseEntry; end: number } | null {
  const base = readIdentifier(source, index)
  if (!base || !["describe", "it", "test"].includes(base.value)) return null
  let pos = skipWhitespace(source, base.end)
  const modifiers: string[] = []
  while (source[pos] === ".") {
    const prop = readIdentifier(source, pos + 1)
    if (!prop) return null
    modifiers.push(prop.value)
    pos = skipWhitespace(source, prop.end)
    if (prop.value === "each") {
      if (source[pos] !== "(") return null
      const close = findMatching(source, pos, "(", ")")
      if (close === -1) return null
      pos = skipWhitespace(source, close + 1)
    }
  }
  if (source[pos] !== "(") return null
  const title = readFirstStringArgument(source, pos)
  if (!title) return null
  const mode = modeFromModifiers(modifiers)
  const kind =
    base.value === "describe" ? "describe" : /benchmarks?|perf|performance/i.test(title.value) ? "benchmark" : "test"
  return {
    entry: { name: title.value, kind, line: lineFor(index), mode, caseCount: 1 },
    end: title.end,
  }
}

export function parseTestCases(source: string): TestCaseEntry[] {
  const cases: TestCaseEntry[] = []
  const lineFor = (index: number) => source.slice(0, index).split("\n").length
  for (let i = 0; i < source.length; ) {
    const skipped = skipCodeTrivia(source, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    if (!isIdentChar(source[i - 1])) {
      const parsed = parseDeclarationAt(source, i, lineFor)
      if (parsed && !isIdentChar(source[parsed.end])) {
        cases.push(parsed.entry)
        i = parsed.end
        continue
      }
    }
    i++
  }
  return cases.sort((a, b) => a.line - b.line)
}

function markBenchmarkCases(relativePath: string, source: string, tests: TestCaseEntry[]): TestCaseEntry[] {
  const benchmarkFile = /(^|\/)[^/]*benchmark[^/]*\.test\.ts$/i.test(relativePath)
  const lines = source.split("\n")
  const runnable = tests.filter((test) => test.kind !== "describe")
  return tests.map((test) => {
    if (test.kind === "describe") return test
    const next = runnable.find((item) => item.line > test.line)
    const block = lines.slice(test.line - 1, (next?.line ?? lines.length + 1) - 1).join("\n")
    const recordsBenchmark = /\brecord(?:Benchmark|VisualArtifact)\s*\(/.test(block)
    if (benchmarkFile || recordsBenchmark || /benchmarks?|perf|performance/i.test(test.name)) {
      return { ...test, kind: "benchmark" }
    }
    return test
  })
}

export async function scanTestFiles(): Promise<TestFileEntry[]> {
  const entries: TestFileEntry[] = []
  try {
    const files = Array.from(new Glob("**/*.test.ts").scanSync({ cwd: NIKCLI_TEST_DIR })) as string[]
    for (const fp of files) {
      const fullPath = `${NIKCLI_TEST_DIR}/${fp}`
      const stat = await Bun.file(fullPath).stat()
      const source = await Bun.file(fullPath).text()
      const tests = markBenchmarkCases(fp, source, parseTestCases(source))
      const runnableTests = tests.filter((test) => test.kind !== "describe")
      const countCases = (test: TestCaseEntry) => test.caseCount ?? 1
      const benchmarkCount = runnableTests
        .filter((test) => test.kind === "benchmark")
        .reduce((sum, test) => sum + countCases(test), 0)
      entries.push({
        filePath: fullPath,
        fileName: fp.split("/").pop() ?? fp,
        relativePath: fp,
        lastModified: stat.mtime?.valueOf() ?? 0,
        size: stat.size,
        hasBenchmarks: fp.includes("benchmark") || benchmarkCount > 0 || source.includes("recordBenchmark("),
        benchmarkCount,
        testCount: runnableTests.reduce((sum, test) => sum + countCases(test), 0),
        declarationCount: runnableTests.length,
        unresolvedEachCount: runnableTests.filter((test) => test.mode === "each" && test.caseCount === undefined)
          .length,
        tests,
      })
    }
  } catch {}
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
