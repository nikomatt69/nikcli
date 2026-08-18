import { describe, expect, test } from "bun:test"
import {
  applyLiveCapabilities,
  bestOverlayProtocol,
  detectCapabilities,
  Protocol,
  protocolForTerminal,
} from "../src/capabilities"

describe("protocolForTerminal", () => {
  test("recognises kitty", () => {
    expect(protocolForTerminal("xterm-kitty", undefined)).toBe(Protocol.KITTY)
  })

  test("recognises ghostty", () => {
    expect(protocolForTerminal("ghostty", undefined)).toBe(Protocol.KITTY)
  })

  test("recognises wezterm", () => {
    expect(protocolForTerminal("WezTerm", undefined)).toBe(Protocol.KITTY)
  })

  test("recognises iterm2", () => {
    expect(protocolForTerminal("iTerm.app", undefined)).toBe(Protocol.ITERM2)
  })

  test("does not guess image support for vscode", () => {
    expect(protocolForTerminal("vscode", undefined)).toBeNull()
  })

  test("does not guess sixel for generic xterm", () => {
    expect(protocolForTerminal("xterm-256color", undefined)).toBeNull()
  })

  test("returns null on unknown", () => {
    expect(protocolForTerminal(null, undefined)).toBeNull()
    expect(protocolForTerminal("dumb", undefined)).toBeNull()
  })
})

describe("detectCapabilities", () => {
  test("honours KITTY_WINDOW_ID", () => {
    const caps = detectCapabilities(undefined, { KITTY_WINDOW_ID: "1" })
    expect(caps.kitty).toBe(true)
    expect(caps.best).toBe(Protocol.KITTY)
  })

  test("honours GHOSTTY_RESOURCES_DIR", () => {
    const caps = detectCapabilities(undefined, {
      GHOSTTY_RESOURCES_DIR: "/tmp",
    })
    expect(caps.kitty).toBe(true)
  })

  test("honours ITERM_SESSION_ID", () => {
    const caps = detectCapabilities(undefined, { ITERM_SESSION_ID: "abc" })
    expect(caps.iterm2).toBe(true)
  })

  test("detects both Kitty and iTerm2 in WezTerm", () => {
    const caps = detectCapabilities(undefined, { TERM_PROGRAM: "WezTerm" })
    expect(caps.kitty).toBe(true)
    expect(caps.iterm2).toBe(true)
    expect(caps.best).toBe(Protocol.KITTY)
    expect(caps.available).toContain(Protocol.ITERM2)
  })

  test("detects both protocols from WezTerm environment variables", () => {
    const caps = detectCapabilities(undefined, {
      WEZTERM_EXECUTABLE: "C:\\Program Files\\WezTerm\\wezterm-gui.exe",
    })
    expect(caps.kitty).toBe(true)
    expect(caps.iterm2).toBe(true)
  })

  test("ignores the host terminal identity leaked into a herdr pane", () => {
    // herdr overrides TERM/COLORTERM but leaves the launching terminal's
    // variables in the child environment. Its pane VT (libghostty) drops
    // iTerm2 inline images and Sixel, so only Kitty may be negotiated.
    const caps = detectCapabilities(undefined, {
      HERDR_PANE_ID: "w1Y:p6",
      TERM: "xterm-256color",
      TERM_PROGRAM: "WezTerm",
      WEZTERM_EXECUTABLE: "C:\\Program Files\\WezTerm\\wezterm-gui.exe",
      WEZTERM_PANE: "0",
      ITERM_SESSION_ID: "abc",
    })
    expect(caps.kitty).toBe(true)
    expect(caps.iterm2).toBe(false)
    expect(caps.sixel).toBe(false)
    expect(caps.best).toBe(Protocol.KITTY)
    expect(caps.terminal).toBe("herdr")
    expect(bestOverlayProtocol(caps)).toBeNull()
  })

  test("keeps a herdr pane off Sixel even when the DA1 answer claims it", () => {
    const env = { HERDR_ENV: "1", TERM_PROGRAM: "WezTerm" }
    const merged = applyLiveCapabilities(detectCapabilities(undefined, env), { sixel: true }, env)
    expect(merged.sixel).toBe(false)
    expect(merged.iterm2).toBe(false)
    expect(merged.best).toBe(Protocol.KITTY)
  })

  test("does not guess sixel from WT_SESSION", () => {
    const caps = detectCapabilities(undefined, { WT_SESSION: "abc" })
    expect(caps.sixel).toBe(false)
  })

  test("honours KONSOLE_VERSION >= 22 for kitty, < 22 for sixel", () => {
    const old = detectCapabilities(undefined, { KONSOLE_VERSION: "21.12.4" })
    expect(old.sixel).toBe(true)
    expect(old.kitty).toBe(false)
    const recent = detectCapabilities(undefined, {
      KONSOLE_VERSION: "23.05.0",
    })
    expect(recent.kitty).toBe(true)
  })

  test("strips iterm2 on stderr", () => {
    const caps = detectCapabilities({ kind: "stderr" }, { ITERM_SESSION_ID: "abc" })
    expect(caps.iterm2).toBe(false)
  })

  test("order is kitty > sixel > iterm2", () => {
    const caps = detectCapabilities(undefined, {
      KITTY_WINDOW_ID: "1",
      ITERM_SESSION_ID: "x",
    })
    expect(caps.available[0]).toBe(Protocol.KITTY)
    expect(caps.available).toContain(Protocol.ITERM2)
  })
})

describe("applyLiveCapabilities", () => {
  test("passthrough when live answer is unavailable", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    expect(applyLiveCapabilities(detected, null, {})).toBe(detected)
    expect(detected.best).toBeNull()
  })

  test("negotiated DA1 without sixel keeps generic xterm disabled", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    const merged = applyLiveCapabilities(detected, { sixel: false }, {})
    expect(merged.sixel).toBe(false)
    expect(merged.best).toBeNull()
  })

  test("negotiated sixel keeps the sixel protocol", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    const merged = applyLiveCapabilities(detected, { sixel: true }, {})
    expect(merged.best).toBe(Protocol.SIXEL)
  })

  test("vscode only enables the protocol negotiated by OpenTUI", () => {
    const env = { TERM: "xterm-256color", TERM_PROGRAM: "vscode" }
    const detected = detectCapabilities(undefined, env)
    expect(detected.iterm2).toBe(false)
    const disabled = applyLiveCapabilities(detected, { sixel: false }, env)
    expect(disabled.iterm2).toBe(false)
    expect(disabled.best).toBeNull()
    const enabled = applyLiveCapabilities(detected, { sixel: true }, env)
    expect(enabled.iterm2).toBe(false)
    expect(enabled.best).toBe(Protocol.SIXEL)
  })

  test("real iTerm2 keeps iterm2 even without sixel in DA1", () => {
    const env = {
      TERM: "xterm-256color",
      TERM_PROGRAM: "iTerm.app",
      ITERM_SESSION_ID: "abc",
    }
    const detected = detectCapabilities(undefined, env)
    const merged = applyLiveCapabilities(detected, { sixel: false }, env)
    expect(merged.iterm2).toBe(true)
    expect(merged.best).toBe(Protocol.ITERM2)
  })

  test("negotiated kitty graphics augments the env answer", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    const merged = applyLiveCapabilities(detected, { kitty_graphics: true, sixel: false }, {})
    expect(merged.kitty).toBe(true)
    expect(merged.best).toBe(Protocol.KITTY)
  })

  test("explicit kitty env survives a lost graphics query", () => {
    const env = { KITTY_WINDOW_ID: "1" }
    const detected = detectCapabilities(undefined, env)
    const merged = applyLiveCapabilities(detected, { kitty_graphics: false, sixel: false }, env)
    expect(merged.kitty).toBe(true)
  })
})

describe("bestOverlayProtocol", () => {
  test("uses iTerm2 when Kitty placeholders are unavailable", () => {
    const caps = detectCapabilities(undefined, { TERM_PROGRAM: "WezTerm" })
    expect(bestOverlayProtocol(caps)).toBe(Protocol.ITERM2)
  })

  test("prefers Sixel over iTerm2", () => {
    const caps = detectCapabilities(undefined, {
      TERM_PROGRAM: "WezTerm",
      TERMINOLOGY_VERSION: "1",
    })
    expect(bestOverlayProtocol(caps)).toBe(Protocol.SIXEL)
  })

  test("returns null when only Kitty is available", () => {
    const caps = detectCapabilities(undefined, { KITTY_WINDOW_ID: "1" })
    expect(bestOverlayProtocol(caps)).toBeNull()
  })
})
