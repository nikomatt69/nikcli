/**
 * Translate human-friendly key names into Bun.WebView `press()` chords.
 * Mirrors terminal-control's `keys.ts` token syntax (`enter`, `tab`,
 * `ctrl+a`, `alt+shift+x`, ...) but targets WebView named keys + modifiers.
 */

import type { WebViewModifier } from "@nikcli-ai/util/bun-utils"

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

const MODIFIERS: Record<string, WebViewModifier> = {
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
  return NAMED[base.toLowerCase()] ?? base
}

export function parseKeyChord(token: string): { key: string; modifiers: WebViewModifier[] } {
  const raw = token.trim()
  if (raw.length === 0) return { key: raw, modifiers: [] }

  const named = NAMED[raw.toLowerCase()]
  if (named !== undefined) return { key: named, modifiers: [] }

  if (raw.includes("+")) {
    const parts = raw.split("+").filter(Boolean)
    if (parts.length >= 2) {
      const base = parts[parts.length - 1]!
      const modifiers = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()] ?? "Control")
      return { key: namedKey(base), modifiers }
    }
  }

  return { key: raw, modifiers: [] }
}

/** Join a chord as `Control+a` / `Enter` — kept for callers that still want a single string. */
export function translateKey(token: string): string {
  const { key, modifiers } = parseKeyChord(token)
  return modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key
}

/** Translate a whitespace-separated list of key tokens into individual chords. */
export function translateKeys(input: string): string[] {
  return input.split(/\s+/).filter(Boolean).map(translateKey)
}
