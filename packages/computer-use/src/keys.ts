/**
 * Translate human-friendly key names into the canonical `<mods>+<base>` token
 * the host / sandbox backends understand. Mirrors the structure of
 * `@nikcli-ai/browser-control`'s `keys.ts` and `@nikcli-ai/terminal-control`'s
 * `keys.ts`, but for desktop key chords — the canonical token is passed
 * straight to the platform's input driver (cliclick on macOS, xdotool on
 * Linux/x11, SendKeys on Windows), so this module only normalizes the
 * friendly aliases (cmd ↔ command, alt ↔ option, esc ↔ escape, …) without
 * actually mapping them to native keycodes.
 *
 * Each backend performs its own final mapping (e.g. `cmd` → AppleScript
 * `command down`, `cmd` → xdotool `super`, `cmd` → no prefix in SendKeys),
 * so the canonical form stays close to what an agent or human typed.
 */

const NAMED: Record<string, string> = {
  enter: "enter",
  return: "return",
  ret: "enter",
  tab: "tab",
  esc: "esc",
  escape: "escape",
  space: "space",
  backspace: "backspace",
  bs: "backspace",
  delete: "delete",
  del: "delete",
  up: "up",
  down: "down",
  right: "right",
  left: "left",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  insert: "insert",
  f1: "f1",
  f2: "f2",
  f3: "f3",
  f4: "f4",
  f5: "f5",
  f6: "f6",
  f7: "f7",
  f8: "f8",
  f9: "f9",
  f10: "f10",
  f11: "f11",
  f12: "f12",
};

const MODIFIERS: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  c: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  win: "cmd",
};

function canonicalBase(token: string): string {
  const lower = token.trim().toLowerCase();
  return NAMED[lower] ?? token;
}

/**
 * Translate a single key token (e.g. `ctrl+a`, `enter`, `x`) into the
 * canonical `<mods>+<base>` form. Modifier order is normalized
 * (ctrl, alt, shift, cmd) so equivalent chords compare equal.
 */
export function translateKey(token: string): string {
  const raw = token.trim();
  if (raw.length === 0) return raw;

  if (raw.includes("+")) {
    const parts = raw.split("+").filter(Boolean);
    const base = parts[parts.length - 1]!;
    const mods: string[] = [];
    for (const part of parts.slice(0, -1)) {
      const lower = part.toLowerCase();
      const canonical = MODIFIERS[lower];
      if (canonical && !mods.includes(canonical)) mods.push(canonical);
    }
    const ordered = ["ctrl", "alt", "shift", "cmd"].filter((m) =>
      mods.includes(m),
    );
    return [...ordered, canonicalBase(base)].join("+");
  }

  return canonicalBase(raw);
}

/** Translate a whitespace-separated list of key tokens. */
export function translateKeys(input: string): string[] {
  return input.split(/\s+/).filter(Boolean).map(translateKey);
}
