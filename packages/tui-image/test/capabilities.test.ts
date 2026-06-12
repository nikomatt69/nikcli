import { describe, expect, test } from "bun:test"
import { applyLiveCapabilities, detectCapabilities, Protocol, protocolForTerminal } from "../src/capabilities"

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

  test("recognises vscode", () => {
    expect(protocolForTerminal("vscode", undefined)).toBe(Protocol.ITERM2)
  })

  test("recognises xterm (sixel)", () => {
    expect(protocolForTerminal("xterm-256color", undefined)).toBe(Protocol.SIXEL)
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

  test("honours WT_SESSION as sixel", () => {
    const caps = detectCapabilities(undefined, { WT_SESSION: "abc" })
    expect(caps.sixel).toBe(true)
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
  })

  test("negotiated DA1 without sixel drops the TERM=xterm guess", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    expect(detected.best).toBe(Protocol.SIXEL)
    const merged = applyLiveCapabilities(detected, { sixel: false }, {})
    expect(merged.sixel).toBe(false)
    expect(merged.best).toBeNull()
  })

  test("negotiated sixel keeps the sixel protocol", () => {
    const detected = detectCapabilities(undefined, { TERM: "xterm-256color" })
    const merged = applyLiveCapabilities(detected, { sixel: true }, {})
    expect(merged.best).toBe(Protocol.SIXEL)
  })

  test("vscode iterm2 guess requires the image addon (sixel in DA1)", () => {
    const env = { TERM: "xterm-256color", TERM_PROGRAM: "vscode" }
    const detected = detectCapabilities(undefined, env)
    expect(detected.iterm2).toBe(true)
    const disabled = applyLiveCapabilities(detected, { sixel: false }, env)
    expect(disabled.iterm2).toBe(false)
    expect(disabled.best).toBeNull()
    const enabled = applyLiveCapabilities(detected, { sixel: true }, env)
    expect(enabled.iterm2).toBe(true)
    expect(enabled.best).toBe(Protocol.SIXEL)
  })

  test("real iTerm2 keeps iterm2 even without sixel in DA1", () => {
    const env = { TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "abc" }
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
