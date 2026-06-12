import { useKeyboard, useRenderer } from "@opentui/solid"
import type { BenchState } from "./enterprise-state"
import { actionForKey, isTextInputKey } from "./keymap"
import { rankFiles } from "./components/CommandPalette"

export function useBenchKeyboard(s: BenchState) {
  const renderer = useRenderer()
  const resetActiveCursor = () => {
    if (s.viewMode() === "suite") s.setTreeCursor(0)
    else s.setCursor(0)
  }

  useKeyboard((evt) => {
    const action = actionForKey(evt)

    // Command palette has its own input-style key handling.
    if (s.paletteOpen()) {
      evt.preventDefault()
      if (action === "quit" || action === "cancel" || action === "paletteClose") {
        s.setPaletteOpen(false)
        s.setPaletteQuery("")
        s.setPaletteCursor(0)
        return
      }
      if (action === "cursorDown" || action === "paletteDown" || evt.name === "down") {
        const max = Math.max(0, rankFiles(s.paletteQuery(), s.suiteFileStates()).length - 1)
        s.setPaletteCursor((c: number) => Math.min(max, c + 1))
        return
      }
      if (action === "cursorUp" || action === "paletteUp" || evt.name === "up") {
        s.setPaletteCursor((c: number) => Math.max(0, c - 1))
        return
      }
      if (action === "runSelected" || action === "paletteConfirm" || evt.name === "return") {
        const matches = rankFiles(s.paletteQuery(), s.suiteFileStates())
        const target = matches[s.paletteCursor()]
        if (target) {
          // Jump tree to the file too
          const idx = s.suiteTreeRows().findIndex((r) => r.kind === "file" && r.file?.filePath === target.filePath)
          if (idx >= 0) s.setTreeCursor(idx)
          void s.runOneFile(target.filePath)
        }
        s.setPaletteOpen(false)
        s.setPaletteQuery("")
        s.setPaletteCursor(0)
        return
      }
      if (action === "deleteChar" || evt.name === "backspace") {
        s.setPaletteQuery((q: string) => q.slice(0, -1))
        s.setPaletteCursor(0)
        return
      }
      if (action === "clearInput") {
        s.setPaletteQuery("")
        s.setPaletteCursor(0)
        return
      }
      if (isTextInputKey(evt)) {
        s.setPaletteQuery((q: string) => q + evt.name)
        s.setPaletteCursor(0)
      }
      return
    }

    if (s.helpMode()) {
      if (action === "quit" || action === "cancel" || action === "help" || evt.name === "space") {
        evt.preventDefault()
        s.setHelpMode(false)
      }
      return
    }

    if (s.filterMode()) {
      evt.preventDefault()
      if (action === "quit" || action === "cancel") {
        s.setFilterMode(false)
        s.setFilterText("")
        return
      }
      if (action === "filterConfirm") {
        s.setFilterMode(false)
        return
      }
      if (action === "clearInput") {
        s.setFilterText("")
        resetActiveCursor()
        return
      }
      if (action === "deleteChar") {
        s.setFilterText((t: string) => t.slice(0, -1))
        resetActiveCursor()
        return
      }
      if (isTextInputKey(evt)) {
        s.setFilterText((t: string) => t + evt.name)
        resetActiveCursor()
      }
      return
    }

    if (!action) return
    evt.preventDefault()

    switch (action) {
      case "quit":
        process.exit(0)
      case "cancel":
        if (s.compareMode()) {
          s.setCompareMode(false)
          s.setCompareResults([])
        }
        return
      case "help":
        s.setHelpMode((v: boolean) => !v)
        return
      case "refresh":
        void s.refresh()
        return
      case "runSuite":
        if (!s.compareMode()) void s.runAllSuite()
        return
      case "runBenchmarks":
        if (!s.compareMode()) void s.runBench()
        return
      case "runSelected": {
        if (s.viewMode() === "suite") {
          s.activateTreeRow()
        } else if (s.viewMode() === "files") {
          const file = s.filteredTestFiles()[s.rowIdx()]
          if (file) void s.runOneFile(file.filePath)
        }
        return
      }
      case "exportRun": {
        const run = s.runs()[s.runIdx()]
        if (run) void s.exportRun(run.filePath)
        return
      }
      case "viewSuite":
        if (!s.compareMode()) s.selectView("suite")
        return
      case "viewCompare":
        if (!s.compareMode()) s.selectView("compare")
        return
      case "viewLeaderboard":
        if (!s.compareMode()) s.selectView("leaderboard")
        return
      case "viewDetail":
        if (!s.compareMode()) s.selectView("detail")
        return
      case "viewFiles":
        if (!s.compareMode()) s.selectView("files")
        return
      case "runAll":
        if (s.viewMode() === "suite") void s.runAllSuite()
        return
      case "runGroup": {
        if (s.viewMode() === "suite") {
          const row = s.selectedTreeRow()
          if (row) void s.runGroup(row.group)
        }
        return
      }
      case "toggleGroup": {
        if (s.viewMode() === "suite") {
          const row = s.selectedTreeRow()
          if (row) s.toggleGroup(row.group)
        }
        return
      }
      case "expandAll":
        if (s.viewMode() === "suite") s.expandAllGroups()
        return
      case "collapseAll":
        if (s.viewMode() === "suite") s.collapseAllGroups()
        return
      case "toggleOnlyFailures":
        if (s.viewMode() === "suite") s.setShowOnlyFailures((v: boolean) => !v)
        return
      case "clearHistory":
        if (s.viewMode() === "suite") void s.clearHistoryForSelected()
        return
      case "cycleView":
        if (!s.compareMode()) s.cycleView()
        return
      case "cycleViewBack":
        if (!s.compareMode()) s.cycleViewBack()
        return
      case "focusNext":
        s.cycleFocus(1)
        return
      case "focusPrev":
        s.cycleFocus(-1)
        return
      case "sort":
        if (!s.compareMode()) {
          if (s.viewMode() === "suite") s.cycleSuiteSort()
          else s.cycleSort()
        }
        return
      case "sortReverse":
        if (!s.compareMode()) s.toggleSortAsc()
        return
      case "filter":
        if (!s.compareMode()) {
          s.setFilterMode(true)
          s.setFilterText("")
          resetActiveCursor()
        }
        return
      case "compare": {
        if (!s.compareMode()) {
          const left = s.runs()[s.runIdx()]?.run.runId
          const right = s.baselineRun()?.run.runId ?? s.runs()[s.runs().length - 1]?.run.runId ?? s.runs()[0]?.run.runId
          if (left && right && right !== left) {
            s.doCompare(left, right)
          } else {
            s.setCompareMode(true)
          }
          s.setCursor(0)
        } else {
          s.setCompareMode(false)
          s.setCompareResults([])
        }
        return
      }
      case "compareSwap": {
        if (s.compareMode()) {
          s.swapCompare()
        }
        return
      }
      case "baseline": {
        if (!s.compareMode()) {
          const run = s.runs()[s.runIdx()]
          if (run) s.setRunAsBaseline(run.run.runId)
        }
        return
      }
      case "deleteRun": {
        if (!s.compareMode()) {
          const run = s.runs()[s.runIdx()]
          if (run) void s.deleteRun(run.filePath)
        }
        return
      }
      case "cursorDown":
        if (s.viewMode() === "suite" && s.focusPane() !== "logs") {
          s.setFocusPane("tree")
          s.moveTreeCursor(1)
        } else {
          s.setFocusPane("main")
          s.moveCursor(1)
        }
        return
      case "cursorUp":
        if (s.viewMode() === "suite" && s.focusPane() !== "logs") {
          s.setFocusPane("tree")
          s.moveTreeCursor(-1)
        } else {
          s.setFocusPane("main")
          s.moveCursor(-1)
        }
        return
      case "pageDown":
        if (s.viewMode() === "suite") {
          s.setFocusPane("tree")
          s.moveTreeCursor(s.pageHeight(s.terminalHeight()))
        } else {
          s.setFocusPane("main")
          s.pageCursor(1)
        }
        return
      case "pageUp":
        if (s.viewMode() === "suite") {
          s.setFocusPane("tree")
          s.moveTreeCursor(-s.pageHeight(s.terminalHeight()))
        } else {
          s.setFocusPane("main")
          s.pageCursor(-1)
        }
        return
      case "nextRun":
        if (!s.compareMode()) s.moveRun(-1)
        return
      case "prevRun":
        if (!s.compareMode()) s.moveRun(1)
        return
      case "firstRow":
        if (s.viewMode() === "suite") s.setTreeCursor(0)
        else s.jumpCursor("first")
        return
      case "lastRow":
        if (s.viewMode() === "suite") s.setTreeCursor(s.suiteTreeRows().length - 1)
        else s.jumpCursor("last")
        return
      case "paletteOpen":
        s.setPaletteQuery("")
        s.setPaletteCursor(0)
        s.setPaletteOpen(true)
        return
      case "debugOverlay":
        try {
          renderer.toggleDebugOverlay()
        } catch {}
        return
      case "copyPath": {
        const file = s.selectedSuiteFile()
        if (file) {
          try {
            if (renderer.isOsc52Supported?.()) renderer.copyToClipboardOSC52(file.relativePath)
            s.appendLog(`✓ Copied ${file.relativePath} to clipboard`)
          } catch {
            s.appendLog(`! Clipboard copy failed`)
          }
        }
        return
      }
      case "paletteClose":
      case "paletteConfirm":
      case "paletteUp":
      case "paletteDown":
      case "clearInput":
      case "deleteChar":
      case "filterConfirm":
        return
    }
  })
}
