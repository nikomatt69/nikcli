#!/usr/bin/env bun
import { Show, Switch, Match, createEffect, onCleanup, createMemo, onMount } from "solid-js"
import { Portal, render, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { theme } from "./theme"
import { CommandPalette } from "./components/CommandPalette"
import { useBenchState } from "./state"
import { useBenchKeyboard } from "./keyboard"
import { Header } from "./components/Header"
import { FilterBar } from "./components/FilterBar"
import { ViewTabs } from "./components/ViewTabs"
import { CompareModeBanner } from "./components/CompareModeBanner"
import { RunListSidebar } from "./components/RunListSidebar"
import { CompareView } from "./components/CompareView"
import { LeaderboardView } from "./components/LeaderboardView"
import { DetailView } from "./components/DetailView"
import { CompareModeView } from "./components/CompareModeView"
import { TestDetailPanel } from "./components/TestDetailPanel"
import { CompareDetailPanel } from "./components/CompareDetailPanel"
import { TestFileListView } from "./components/TestFileListView"
import { TestFileDetailPanel } from "./components/TestFileDetailPanel"
import { HelpOverlay } from "./components/HelpOverlay"
import { LogPanel } from "./components/LogPanel"
import { QuickStats } from "./components/QuickStats"
import { SuiteTreeSidebar } from "./components/SuiteTreeSidebar"
import { SuiteDashboardView } from "./components/SuiteDashboardView"
import { SuiteDetailPanel } from "./components/SuiteDetailPanel"
import { formatBytes } from "./theme"
import { TARGET_PACKAGE_NAME } from "./types"

export function BenchTUIApp() {
  const s = useBenchState()
  useBenchKeyboard(s)
  const dim = useTerminalDimensions()
  const renderer = useRenderer()

  createEffect(() => {
    s.setTerminalHeight(dim().height)
    s.setTerminalWidth(dim().width)
  })

  // Terminal title sync — shows live state in window/tab title.
  createEffect(() => {
    const agg = s.suiteAggregates()
    const running = s.suiteRunningFiles().size
    const parts = [`${TARGET_PACKAGE_NAME} tests`]
    if (running > 0) parts.push(`● ${running} running`)
    if (agg.failing > 0) parts.push(`✗ ${agg.failing} failing`)
    if (agg.passing > 0 && agg.failing === 0 && running === 0) parts.push(`✓ ${agg.passing} passing`)
    try {
      renderer.setTerminalTitle(parts.join(" — "))
    } catch {}
  })

  // Live-render gating: spin while any test is running so spinners/durations update smoothly.
  createEffect(() => {
    const running = s.suiteRunningFiles().size > 0 || s.state() === "running"
    if (running) renderer.requestLive()
    else renderer.dropLive()
  })

  // Desktop notification on suite-completion edge.
  let prevQueueLen = 0
  let wasRunning = false
  createEffect(() => {
    const queueLen = s.suiteRunQueue().length
    const running = s.suiteRunningFiles().size > 0
    if (wasRunning && !running && prevQueueLen > 0 && queueLen === 0) {
      const agg = s.suiteAggregates()
      const msg = agg.failing > 0 ? `${agg.failing} failing · ${agg.passing} passing` : `${agg.passing} suites passing`
      try {
        ;(renderer as any).triggerNotification?.("Suite run complete", msg)
      } catch {}
    }
    prevQueueLen = queueLen
    wasRunning = running
  })

  // Theme auto-detect — adapt background color to terminal theme on startup.
  onMount(() => {
    const waitTheme = (renderer as any).waitForThemeMode?.bind(renderer) as
      | ((ms: number) => Promise<"dark" | "light" | null>)
      | undefined
    const setBg = (renderer as any).setBackgroundColor?.bind(renderer) as ((c: unknown) => void) | undefined
    const themePromise = waitTheme ? waitTheme(500) : Promise.resolve(null)
    void themePromise.then((mode) => {
      try {
        setBg?.(theme.bg)
      } catch {}
      s.appendLog(`▸ Theme detected: ${mode ?? "unknown"} · ${dim().width}x${dim().height} · ${process.platform}`)
    })
  })

  createEffect(() => {
    const compact = dim().width < 100
    const vph = Math.max(3, Math.floor((dim().height - 10) / (compact ? 1 : 2)))
    s.resizeRunPage(vph)
  })

  onCleanup(() => {
    process.stdout.write("\x1b[?25h\x1b[0m")
  })

  const ph = () => s.pageHeight(s.terminalHeight())
  const detailPanelWidth = () => (dim().width >= 120 ? 38 : dim().width >= 104 ? 32 : 0)
  const showDetailPanel = () => detailPanelWidth() >= 32

  const platform = createMemo(() => {
    const p = process.platform
    const arch = process.arch
    const ver = process.version
    const mem = process.memoryUsage?.().rss ?? 0
    return `${p}/${arch} bun${ver} ${formatBytes(mem)}`
  })

  const viewCounts = createMemo(() => {
    if (s.compareMode())
      return { filtered: s.compareResults().length, total: s.compareResults().length, label: "compare rows" }
    switch (s.viewMode()) {
      case "suite":
        return { filtered: s.suiteFilteredFiles().length, total: s.suiteFileStates().length, label: "test files" }
      case "compare":
        return { filtered: s.dashboardRows().length, total: s.activeCompareResults().length, label: "comparisons" }
      case "leaderboard":
        return { filtered: s.leaderboardRows().length, total: s.allTests().length, label: "benchmarks" }
      case "files":
        return { filtered: s.filteredTestFiles().length, total: s.testFiles().length, label: "files" }
      default:
        return { filtered: s.filteredTests().length, total: s.allTests().length, label: "benchmarks" }
    }
  })

  return (
    <box width={dim().width} height={dim().height} backgroundColor={theme.bg} flexDirection="column">
      <Header
        state={s.state()}
        terminalWidth={dim().width}
        runDuration={s.runDuration}
        activeRun={s.activeRun()}
        runs={s.runs()}
        testFileCount={s.testFiles().length}
        testCaseCount={s.testFiles().reduce((total, file) => total + file.testCount, 0)}
        targetPackageName={TARGET_PACKAGE_NAME}
        activeRunDelta={s.activeRunDelta}
        baselineRunId={s.baselineRunId()}
        focusPane={s.focusPane()}
        loading={s.loading()}
        hasAlerts={s.hasAlerts}
        onRun={() => void s.runAllSuite()}
        onRefresh={() => void s.refresh()}
        onCycleView={() => s.cycleView()}
        viewMode={s.viewMode()}
        platform={platform()}
      />

      <Show when={s.filterMode()}>
        <FilterBar
          filterText={s.filterText()}
          setFilterText={s.setFilterText}
          filteredCount={viewCounts().filtered}
          totalCount={viewCounts().total}
          placeholder={`filter ${viewCounts().label}`}
          onClose={() => {
            s.setFilterMode(false)
            s.setFilterText("")
          }}
          onClear={() => {
            s.setFilterText("")
            if (s.viewMode() === "suite") s.setTreeCursor(0)
            else s.setCursor(0)
          }}
        />
      </Show>

      <ViewTabs
        viewMode={s.viewMode()}
        setViewMode={s.selectView}
        compareMode={s.compareMode()}
        sortMode={s.sortMode()}
        sortAsc={s.sortAsc()}
        filteredCount={viewCounts().filtered}
        totalCount={viewCounts().total}
        showOnlyFailures={s.showOnlyFailures()}
        onToggleOnlyFailures={() => s.setShowOnlyFailures((v: boolean) => !v)}
        runningCount={s.suiteRunningFiles().size}
      />

      <Show when={s.compareMode()}>
        <CompareModeBanner
          compareLeft={s.compareLeft()}
          compareRight={s.compareRight()}
          compareResultsLength={s.compareResults().length}
          onClose={() => {
            s.setCompareMode(false)
            s.setCompareResults([])
          }}
        />
      </Show>

      <box paddingLeft={1} paddingRight={1} gap={1} flexGrow={1} flexDirection="row">
        <Show
          when={s.viewMode() === "suite"}
          fallback={
            <RunListSidebar
              runs={s.runs()}
              runIdx={s.runIdx()}
              runScrollOff={s.runScrollOff()}
              pageSize={s.runPageSize()}
              onSelectRun={s.selectRun}
              onFocus={() => s.setFocusPane("runs")}
              onScrollRuns={s.scrollRuns}
              baselineRunId={s.baselineRunId()}
              focused={s.focusPane() === "runs"}
              compact={dim().width < 100}
              loading={s.loading()}
            />
          }
        >
          <SuiteTreeSidebar
            rows={s.suiteTreeRows()}
            treeIdx={s.treeIdx()}
            treeScrollOff={s.treeScrollOff()}
            pageHeight={ph()}
            focused={s.focusPane() === "tree"}
            width={dim().width >= 140 ? 36 : dim().width >= 100 ? 30 : 24}
            onFocus={() => s.setFocusPane("tree")}
            onSelectRow={(i) => {
              s.setFocusPane("tree")
              s.setTreeCursor(i)
            }}
            onActivate={() => s.activateTreeRow()}
            onScroll={(d) => s.scrollTree(d)}
            onToggleGroup={(name) => s.toggleGroup(name)}
            onRunGroup={(name) => void s.runGroup(name)}
            onRunFile={(fp) => void s.runOneFile(fp)}
            runningFiles={s.suiteRunningFiles()}
            groups={s.suiteGroups()}
          />
        </Show>

        <box
          flexGrow={1}
          border
          backgroundColor={theme.surface}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          borderColor={s.focusPane() === "main" ? theme.borderFocus : theme.border}
          onMouseOver={() => s.setFocusPane("main")}
          onMouseScroll={(event) => {
            event.preventDefault()
            event.stopPropagation()
            s.scrollRows(event.scroll?.direction === "up" ? -1 : 1)
          }}
        >
          <Switch>
            <Match when={s.compareMode()}>
              <CompareModeView
                compareResults={s.compareResults()}
                scrollOff={s.scrollOff()}
                pageHeight={ph()}
                rowIdx={s.rowIdx()}
                onSelectRow={s.setCursor}
                onScrollRows={s.scrollRows}
              />
            </Match>
            <Match when={s.viewMode() === "suite"}>
              <SuiteDashboardView
                aggregates={s.suiteAggregates()}
                files={s.suiteFileStates()}
                groups={s.suiteGroups()}
                runningCount={s.suiteRunningFiles().size}
                queueLength={s.suiteRunQueue().length}
                onRunAll={() => void s.runAllSuite()}
                onRunGroup={(n) => void s.runGroup(n)}
                onRunFile={(fp) => void s.runOneFile(fp)}
                onFocus={() => s.setFocusPane("main")}
                onScroll={(d) => s.scrollRows(d)}
              />
            </Match>
            <Match when={s.viewMode() === "compare"}>
              <CompareView
                dashboardRows={s.dashboardRows}
                hasBaseline={Boolean(s.baselineRun())}
                scrollOff={s.scrollOff()}
                pageHeight={ph()}
                rowIdx={s.rowIdx()}
                onSelectRow={s.setCursor}
                onScrollRows={s.scrollRows}
              />
            </Match>
            <Match when={s.viewMode() === "leaderboard"}>
              <LeaderboardView
                leaderboardRows={s.leaderboardRows}
                scrollOff={s.scrollOff()}
                pageHeight={ph()}
                rowIdx={s.rowIdx()}
                onSelectRow={s.setCursor}
                onScrollRows={s.scrollRows}
              />
            </Match>
            <Match when={s.viewMode() === "detail"}>
              <DetailView selected={s.selectedTest()} allRuns={s.runs()} />
            </Match>
            <Match when={s.viewMode() === "files"}>
              <TestFileListView
                filteredTestFiles={s.filteredTestFiles}
                runningFiles={s.suiteRunningFiles()}
                onRunFile={(fp) => void s.runOneFile(fp)}
                scrollOff={s.scrollOff()}
                pageHeight={ph()}
                rowIdx={s.rowIdx()}
                onSelectRow={s.setCursor}
                onScrollRows={s.scrollRows}
              />
            </Match>
          </Switch>
        </box>

        <Show when={showDetailPanel()}>
          <box
            width={detailPanelWidth()}
            border
            backgroundColor={theme.surface}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
            borderColor={s.focusPane() === "detail" ? theme.borderFocus : theme.border}
            onMouseOver={() => s.setFocusPane("detail")}
          >
            <Switch>
              <Match when={s.viewMode() === "suite"}>
                <SuiteDetailPanel
                  file={s.selectedSuiteFile()}
                  width={detailPanelWidth()}
                  onRunFile={(fp) => void s.runOneFile(fp)}
                  onClearHistory={() => void s.clearHistoryForSelected()}
                />
              </Match>
              <Match when={s.compareMode() && s.rowIdx() < s.compareResults().length}>
                <CompareDetailPanel result={s.compareResults()[s.rowIdx()]} />
              </Match>
              <Match when={!s.compareMode() && s.viewMode() === "compare" && s.selectedCompareResult()}>
                <CompareDetailPanel result={s.selectedCompareResult()} />
              </Match>
              <Match when={!s.compareMode() && s.viewMode() === "files" && s.selectedTestFile()}>
                <TestFileDetailPanel file={s.selectedTestFile()} onRunFile={(fp) => void s.runOneFile(fp)} />
              </Match>
              <Match when={!s.compareMode() && s.selectedTest()}>
                <TestDetailPanel test={s.selectedTest()} />
              </Match>
            </Switch>
            <QuickStats
              runs={s.runs()}
              allTests={s.allTests}
              testFiles={s.testFiles()}
              compareRows={s.activeCompareResults()}
            />
          </box>
        </Show>
      </box>

      <LogPanel
        logLines={s.logLines()}
        terminalWidth={dim().width}
        focused={s.focusPane() === "logs"}
        onFocus={() => s.setFocusPane("logs")}
      />

      <Show when={s.helpMode()}>
        <Portal>
          <HelpOverlay width={dim().width} height={dim().height} onClose={() => s.setHelpMode(false)} />
        </Portal>
      </Show>

      <Show when={s.paletteOpen()}>
        <Portal>
          <CommandPalette
            width={dim().width}
            height={dim().height}
            query={s.paletteQuery()}
            cursor={s.paletteCursor()}
            files={s.suiteFileStates()}
            runningFiles={s.suiteRunningFiles()}
            onSelectCursor={(i) => s.setPaletteCursor(i)}
            onActivate={(file) => {
              const idx = s.suiteTreeRows().findIndex((r) => r.kind === "file" && r.file?.filePath === file.filePath)
              if (idx >= 0) s.setTreeCursor(idx)
              void s.runOneFile(file.filePath)
              s.setPaletteOpen(false)
              s.setPaletteQuery("")
              s.setPaletteCursor(0)
            }}
            onClose={() => {
              s.setPaletteOpen(false)
              s.setPaletteQuery("")
              s.setPaletteCursor(0)
            }}
          />
        </Portal>
      </Show>
    </box>
  )
}

export async function runBenchTUI(): Promise<number> {
  try {
    await render(() => <BenchTUIApp />, {
      targetFps: 60,
      maxFps: 120,
      gatherStats: false,
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
      autoFocus: true,
      useKittyKeyboard: { disambiguate: true, alternateKeys: true },
      consoleMode: "disabled",
    })
  } catch (e) {
    console.error("FATAL:", e)
    return 1
  }
  return 0
}
