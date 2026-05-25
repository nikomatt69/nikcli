import { useKeyboard } from "@opentui/solid"
import type { BenchState } from "./enterprise-state"
import { actionForKey, isTextInputKey } from "./keymap"

export function useBenchKeyboard(s: BenchState) {
  useKeyboard((evt) => {
    const action = actionForKey(evt)

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
        s.setCursor(0)
        return
      }
      if (action === "deleteChar") {
        s.setFilterText((t: string) => t.slice(0, -1))
        s.setCursor(0)
        return
      }
      if (isTextInputKey(evt)) {
        s.setFilterText((t: string) => t + evt.name)
        s.setCursor(0)
      }
      return
    }

    if (!action) return
    evt.preventDefault()

    switch (action) {
      case "quit":
        process.exit(0)
        return
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
        if (!s.compareMode()) void s.runBench()
        return
      case "runSelected": {
        if (s.viewMode() === "files") {
          const file = s.filteredTestFiles()[s.rowIdx()]
          if (file) void s.runSingleTest(file.filePath)
        }
        return
      }
      case "exportRun": {
        const run = s.runs()[s.runIdx()]
        if (run) void s.exportRun(run.filePath)
        return
      }
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
        if (!s.compareMode()) s.cycleSort()
        return
      case "sortReverse":
        if (!s.compareMode()) s.toggleSortAsc()
        return
      case "filter":
        if (!s.compareMode()) {
          s.setFilterMode(true)
          s.setFilterText("")
          s.setCursor(0)
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
        s.setFocusPane("main")
        s.moveCursor(1)
        return
      case "cursorUp":
        s.setFocusPane("main")
        s.moveCursor(-1)
        return
      case "pageDown":
        s.setFocusPane("main")
        s.pageCursor(1)
        return
      case "pageUp":
        s.setFocusPane("main")
        s.pageCursor(-1)
        return
      case "nextRun":
        if (!s.compareMode()) s.moveRun(-1)
        return
      case "prevRun":
        if (!s.compareMode()) s.moveRun(1)
        return
      case "firstRow":
        s.jumpCursor("first")
        return
      case "lastRow":
        s.jumpCursor("last")
        return
      case "clearInput":
      case "deleteChar":
      case "filterConfirm":
        return
    }
  })
}
