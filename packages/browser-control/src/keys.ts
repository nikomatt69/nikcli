/**
 * Translate human-friendly key names into Playwright `keyboard.press()` key
 * strings. Mirrors terminal-control's `keys.ts` token syntax (`enter`, `tab`,
 * `ctrl+a`, `alt+shift+x`, ...) but targets DOM `KeyboardEvent.key` names
 * instead of terminal escape sequences.
 */

const NAMED: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  ret: "Enter",
  tab: "Tab",
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  backspace: "Backspace",
  bs: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  right: "ArrowRight",
  left: "ArrowLeft",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
}

const MODIFIERS: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  c: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  win: "Meta",
}

function namedKey(base: string): string {
  return NAMED[base.toLowerCase()] ?? (base.length === 1 ? base : base)
}

/** Translate a single key token (e.g. `ctrl+a`, `enter`, `x`) to a Playwright key string. */
export function translateKey(token: string): string {
  const raw = token.trim()
  if (raw.length === 0) return raw

  const named = NAMED[raw.toLowerCase()]
  if (named !== undefined) return named

  if (raw.includes("+")) {
    const parts = raw.split("+").filter(Boolean)
    if (parts.length >= 2) {
      const base = parts[parts.length - 1]!
      const mods = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()] ?? m)
      return [...mods, namedKey(base)].join("+")
    }
  }

  // Single printable character, or an already-valid Playwright key name.
  return raw.length === 1 ? raw : raw
}

/** Translate a whitespace-separated list of key tokens into individual Playwright key presses. */
export function translateKeys(input: string): string[] {
  return input.split(/\s+/).filter(Boolean).map(translateKey)
}
