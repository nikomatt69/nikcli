import { describe, expect, test } from "bun:test"
import { browserViewportFromTerminal, detectTerminalCapabilities, normalizeWebUrl } from "./capabilities"

describe("terminal-browser capabilities", () => {
  test("detects truecolor terminals", () => {
    const capabilities = detectTerminalCapabilities({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "WezTerm",
    })

    expect(capabilities.colorMode).toBe("truecolor")
    expect(capabilities.trueColor).toBe(true)
  })

  test("normalizes URLs for browser navigation", () => {
    expect(normalizeWebUrl("example.com")).toBe("https://example.com")
    expect(normalizeWebUrl("https://example.com")).toBe("https://example.com")
    expect(normalizeWebUrl("about:blank")).toBe("about:blank")
  })

  test("computes browser viewport from terminal cells", () => {
    expect(browserViewportFromTerminal(80, 24)).toEqual({
      columns: 80,
      rows: 24,
      pixelWidth: 640,
      pixelHeight: 384,
    })
  })
})
