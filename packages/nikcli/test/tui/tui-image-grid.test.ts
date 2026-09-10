import { describe, expect, test } from "bun:test"
import { chooseInlineImageRenderer, Protocol, type Capabilities } from "@nikcli-ai/tui-image"
import { toCellGrid } from "@tui/component/tui-image"

function caps(overrides: Partial<Capabilities> & Pick<Capabilities, "terminal">): Capabilities {
  return {
    best: Protocol.KITTY,
    available: [Protocol.KITTY],
    kitty: true,
    sixel: false,
    iterm2: false,
    ...overrides,
  }
}

describe("chooseInlineImageRenderer", () => {
  test("uses placeholders only when the terminal composites them", () => {
    expect(chooseInlineImageRenderer(caps({ terminal: "xterm-kitty" }), {})).toBe("kitty")
    expect(chooseInlineImageRenderer(caps({ terminal: "ghostty" }), {})).toBe("kitty")
  })

  test("falls back to half-blocks when DA1 advertised Sixel — overlays cannot live in a scrolling chat", () => {
    expect(
      chooseInlineImageRenderer(
        {
          best: Protocol.SIXEL,
          available: [Protocol.SIXEL],
          kitty: false,
          sixel: true,
          iterm2: false,
          terminal: "vscode",
        },
        { TERM_PROGRAM: "vscode" },
      ),
    ).toBe("halfblock")
  })
})

describe("toCellGrid", () => {
  test("parses half-block SGR into cells and never stores CSI", () => {
    const line = "\x1b[38;2;10;20;30m\x1b[48;2;40;50;60m▀\x1b[0m"
    const grid = toCellGrid(line, 1)
    expect(grid).toHaveLength(1)
    expect(grid[0]).toHaveLength(1)
    expect(grid[0]![0]!.char).toBe("▀")
    for (const row of grid) {
      for (const cell of row) {
        expect(cell.char).not.toContain("\x1b")
        expect(cell.char).not.toMatch(/^\d/)
      }
    }
    expect(grid[0]![0]!.fg.r).toBeCloseTo(10 / 255)
    expect(grid[0]![0]!.bg.b).toBeCloseTo(60 / 255)
  })

  test("drops cursor-addressed CSI and APC instead of painting them", () => {
    const line = "\x1b[12;40H\x1b_Ga=T,q=2;payload\x1b\\▀"
    const grid = toCellGrid(line, 1)
    expect(grid[0]!.map((cell) => cell.char).join("")).toBe("▀")
  })
})
