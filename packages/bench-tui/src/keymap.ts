import type { ParsedKey } from "@opentui/core"

export type BenchAction =
  | "quit" | "cancel" | "help"
  | "refresh" | "runSuite" | "runSelected"
  | "viewCompare" | "viewLeaderboard" | "viewDetail" | "viewFiles"
  | "cycleView" | "cycleViewBack"
  | "sort" | "sortReverse"
  | "filter" | "filterClear" | "filterConfirm"
  | "compare" | "compareSwap" | "baseline" | "deleteRun" | "exportRun"
  | "cursorDown" | "cursorUp" | "pageDown" | "pageUp"
  | "nextRun" | "prevRun" | "firstRow" | "lastRow"
  | "focusNext" | "focusPrev"
  | "clearInput" | "deleteChar"

export interface KeyChord {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export interface BenchKeyBinding {
  action: BenchAction
  label: string
  description: string
  keys: KeyChord[]
  category?: "navigation" | "views" | "actions" | "data" | "focus"
}

const key = (name: string, mods: Omit<KeyChord, "name"> = {}): KeyChord => ({ name, ...mods })

export const BENCH_KEYBINDINGS: BenchKeyBinding[] = [
  { action: "runSuite", label: "r", description: "Run full benchmark suite", keys: [key("r")], category: "actions" },
  { action: "runSelected", label: "enter", description: "Run selected test file", keys: [key("enter")], category: "actions" },
  { action: "refresh", label: "u", description: "Refresh runs & index", keys: [key("u")], category: "actions" },
  { action: "exportRun", label: "e", description: "Export run data", keys: [key("e")], category: "actions" },
  { action: "prevRun", label: "h / left / [", description: "Previous run", keys: [key("h"), key("left"), key("[")], category: "navigation" },
  { action: "nextRun", label: "l / right / ]", description: "Next run", keys: [key("l"), key("right"), key("]")], category: "navigation" },
  { action: "cursorDown", label: "j / down", description: "Move cursor down", keys: [key("j"), key("down")], category: "navigation" },
  { action: "cursorUp", label: "k / up", description: "Move cursor up", keys: [key("k"), key("up")], category: "navigation" },
  { action: "pageDown", label: "pgdn / ctrl+d", description: "Page cursor down", keys: [key("pagedown"), key("d", { ctrl: true })], category: "navigation" },
  { action: "pageUp", label: "pgup / ctrl+u", description: "Page cursor up", keys: [key("pageup"), key("u", { ctrl: true })], category: "navigation" },
  { action: "firstRow", label: "g / home", description: "Jump to first row", keys: [key("g"), key("home")], category: "navigation" },
  { action: "lastRow", label: "G / end", description: "Jump to last row", keys: [key("g", { shift: true }), key("end")], category: "navigation" },
  { action: "cycleView", label: "tab", description: "Next dashboard view", keys: [key("tab")], category: "views" },
  { action: "cycleViewBack", label: "shift+tab", description: "Previous dashboard view", keys: [key("tab", { shift: true })], category: "views" },
  { action: "focusNext", label: "ctrl+n", description: "Focus next pane", keys: [key("n", { ctrl: true })], category: "focus" },
  { action: "focusPrev", label: "ctrl+p", description: "Focus previous pane", keys: [key("p", { ctrl: true })], category: "focus" },
  { action: "viewCompare", label: "1", description: "Compare dashboard", keys: [key("1")], category: "views" },
  { action: "viewLeaderboard", label: "2", description: "Leaderboard view", keys: [key("2")], category: "views" },
  { action: "viewDetail", label: "3", description: "Benchmark detail", keys: [key("3")], category: "views" },
  { action: "viewFiles", label: "4", description: "Test file explorer", keys: [key("4")], category: "views" },
  { action: "sort", label: "a", description: "Cycle sort mode", keys: [key("a")], category: "data" },
  { action: "sortReverse", label: "A", description: "Reverse sort order", keys: [key("a", { shift: true })], category: "data" },
  { action: "filter", label: "f / /", description: "Open filter input", keys: [key("f"), key("/")], category: "data" },
  { action: "compare", label: "c", description: "Toggle comparison mode", keys: [key("c")], category: "actions" },
  { action: "compareSwap", label: "C", description: "Swap compare sides", keys: [key("c", { shift: true })], category: "actions" },
  { action: "baseline", label: "b", description: "Set current run as baseline", keys: [key("b")], category: "data" },
  { action: "deleteRun", label: "d", description: "Delete current run", keys: [key("d")], category: "actions" },
  { action: "help", label: "? / f1", description: "Toggle keybind help", keys: [key("?"), key("?", { shift: true }), key("/", { shift: true }), key("f1")], category: "navigation" },
  { action: "cancel", label: "esc", description: "Close modal/filter/compare", keys: [key("escape")], category: "navigation" },
  { action: "quit", label: "q / ctrl+c", description: "Quit dashboard", keys: [key("q"), key("c", { ctrl: true })], category: "navigation" },
  { action: "clearInput", label: "ctrl+w", description: "Clear filter input", keys: [key("w", { ctrl: true })], category: "data" },
  { action: "deleteChar", label: "backspace", description: "Delete character", keys: [key("backspace")], category: "data" },
  { action: "filterConfirm", label: "enter", description: "Confirm filter", keys: [key("enter")], category: "data" },
]

export function actionForKey(evt: ParsedKey): BenchAction | null {
  for (const binding of BENCH_KEYBINDINGS) {
    if (binding.keys.some((chord) => keyMatches(chord, evt))) return binding.action
  }
  return null
}

export function isTextInputKey(evt: ParsedKey): boolean {
  return evt.name.length === 1 && !evt.ctrl && !evt.meta
}

export function bindingsByCategory(): Map<string, BenchKeyBinding[]> {
  const map = new Map<string, BenchKeyBinding[]>()
  for (const binding of BENCH_KEYBINDINGS) {
    const cat = binding.category ?? "actions"
    const list = map.get(cat) ?? []
    list.push(binding)
    map.set(cat, list)
  }
  return map
}

function keyMatches(chord: KeyChord, evt: ParsedKey): boolean {
  if (evt.name !== chord.name) return false
  return (
    evt.ctrl === Boolean(chord.ctrl) &&
    evt.meta === Boolean(chord.meta) &&
    evt.shift === Boolean(chord.shift)
  )
}
