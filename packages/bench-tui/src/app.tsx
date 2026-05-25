#!/usr/bin/env bun
import { Show, Switch, Match, createEffect, onCleanup, createMemo } from "solid-js"
import { render, useTerminalDimensions } from "@opentui/solid"
import { theme } from "./theme"
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
import { formatBytes } from "./theme"

export function BenchTUIApp() {
  const s = useBenchState()
  useBenchKeyboard(s)
  const dim = useTerminalDimensions()

  createEffect(() => {
    s.setTerminalHeight(dim().height)
    s.setTerminalWidth(dim().width)
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

  return (
    <box width={dim().width} height={dim().height} backgroundColor={theme.bg} flexDirection="column">
      <Header
        state={s.state()}
        terminalWidth={dim().width}
        runDuration={s.runDuration}
        activeRun={s.activeRun()}
        runs={s.runs()}
        allTests={s.allTests}
        activeRunDelta={s.activeRunDelta}
        baselineRunId={s.baselineRunId()}
        focusPane={s.focusPane()}
        loading={s.loading()}
        hasAlerts={s.hasAlerts}
        onRun={() => void s.runBench()}
        onRefresh={() => void s.refresh()}
        onCycleView={() => s.cycleView()}
        viewMode={s.viewMode()}
      />

      <Show when={s.filterMode()}>
        <FilterBar
          filterText={s.filterText()}
          setFilterText={s.setFilterText}
          filteredCount={s.filteredTests().length}
          totalCount={s.allTests().length}
          onClose={() => { s.setFilterMode(false); s.setFilterText("") }}
          onClear={() => { s.setFilterText(""); s.setCursor(0) }}
        />
      </Show>

      <ViewTabs
        viewMode={s.viewMode()}
        setViewMode={s.selectView}
        compareMode={s.compareMode()}
        sortMode={s.sortMode()}
        sortAsc={s.sortAsc()}
        filteredCount={s.filteredTests().length}
        totalCount={s.allTests().length}
      />

      <Show when={s.compareMode()}>
        <CompareModeBanner
          compareLeft={s.compareLeft()}
          compareRight={s.compareRight()}
          compareResultsLength={s.compareResults().length}
          onClose={() => { s.setCompareMode(false); s.setCompareResults([]) }}
        />
      </Show>

      <box paddingLeft={1} paddingRight={1} gap={1} flexGrow={1} flexDirection="row">
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

        <box
          flexGrow={1}
          border
          backgroundColor={theme.surface}
          paddingLeft={1} paddingRight={1}
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
              <DetailView
                selected={s.selectedTest()}
                allRuns={s.runs()}
              />
            </Match>
            <Match when={s.viewMode() === "files"}>
              <TestFileListView
                filteredTestFiles={s.filteredTestFiles}
                runningTest={s.runningTest()}
                onRunFile={(fp) => void s.runSingleTest(fp)}
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
            paddingLeft={1} paddingRight={1}
            flexDirection="column"
            borderColor={s.focusPane() === "detail" ? theme.borderFocus : theme.border}
            onMouseOver={() => s.setFocusPane("detail")}
          >
            <Switch>
              <Match when={s.compareMode() && s.rowIdx() < s.compareResults().length}>
                <CompareDetailPanel result={s.compareResults()[s.rowIdx()]} />
              </Match>
              <Match when={!s.compareMode() && s.viewMode() === "compare" && s.selectedCompareResult()}>
                <CompareDetailPanel result={s.selectedCompareResult()} />
              </Match>
              <Match when={!s.compareMode() && s.viewMode() === "files" && s.selectedTestFile()}>
                <TestFileDetailPanel
                  file={s.selectedTestFile()}
                  onRunFile={(fp) => void s.runSingleTest(fp)}
                />
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
        <HelpOverlay width={dim().width} height={dim().height} onClose={() => s.setHelpMode(false)} />
      </Show>
    </box>
  )
}

export async function runBenchTUI(): Promise<number> {
  try {
    await render(() => <BenchTUIApp />, {
      targetFps: 30,
      gatherStats: false,
      exitOnCtrlC: true,
      useMouse: true,
    })
  } catch (e) {
    console.error("FATAL:", e)
    return 1
  }
  return 0
}
