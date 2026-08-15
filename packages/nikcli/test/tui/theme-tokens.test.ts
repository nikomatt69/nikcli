import { describe, expect, it } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  contrastFg,
  deriveSemanticTokens,
  luminance,
  tint,
  type TokenSource,
} from "../../src/cli/cmd/tui/context/theme-tokens"

function rgb(r: number, g: number, b: number): RGBA {
  return RGBA.fromInts(r, g, b)
}

function source(overrides: Partial<TokenSource> = {}): TokenSource {
  return {
    primary: rgb(111, 163, 255),
    secondary: rgb(180, 140, 255),
    accent: rgb(139, 180, 255),
    error: rgb(255, 80, 80),
    warning: rgb(255, 180, 60),
    success: rgb(80, 200, 120),
    info: rgb(100, 180, 255),
    text: rgb(230, 230, 230),
    textMuted: rgb(154, 154, 154),
    selectedListItemText: rgb(7, 7, 7),
    background: rgb(7, 7, 7),
    backgroundPanel: rgb(18, 18, 18),
    backgroundElement: rgb(27, 27, 27),
    backgroundMenu: rgb(27, 27, 27),
    border: rgb(74, 74, 74),
    borderActive: rgb(111, 163, 255),
    borderSubtle: rgb(58, 58, 58),
    syntaxComment: rgb(90, 90, 90),
    syntaxKeyword: rgb(200, 120, 200),
    syntaxFunction: rgb(100, 140, 255),
    syntaxVariable: rgb(230, 230, 230),
    syntaxString: rgb(80, 200, 120),
    syntaxNumber: rgb(255, 180, 60),
    syntaxType: rgb(100, 200, 220),
    syntaxOperator: rgb(100, 200, 220),
    syntaxPunctuation: rgb(230, 230, 230),
    markdownText: rgb(230, 230, 230),
    markdownHeading: rgb(230, 230, 230),
    markdownLink: rgb(80, 140, 255),
    markdownLinkText: rgb(100, 200, 220),
    markdownCode: rgb(80, 200, 120),
    markdownBlockQuote: rgb(255, 180, 60),
    markdownEmph: rgb(255, 180, 60),
    markdownStrong: rgb(230, 230, 230),
    markdownHorizontalRule: rgb(74, 74, 74),
    markdownListItem: rgb(80, 140, 255),
    markdownListEnumeration: rgb(100, 200, 220),
    markdownImage: rgb(80, 140, 255),
    markdownImageText: rgb(100, 200, 220),
    markdownCodeBlock: rgb(230, 230, 230),
    diffAdded: rgb(80, 200, 120),
    diffRemoved: rgb(255, 80, 80),
    diffContext: rgb(74, 74, 74),
    diffAddedBg: rgb(20, 40, 24),
    diffRemovedBg: rgb(40, 16, 16),
    diffContextBg: rgb(12, 12, 12),
    diffHunkHeader: rgb(74, 74, 74),
    diffHighlightAdded: rgb(120, 255, 160),
    diffHighlightRemoved: rgb(255, 120, 120),
    diffLineNumber: rgb(90, 90, 90),
    diffAddedLineNumberBg: rgb(24, 48, 28),
    diffRemovedLineNumberBg: rgb(48, 20, 20),
    ...overrides,
  }
}

describe("deriveSemanticTokens", () => {
  it("maps existing surfaces without inventing new document keys", () => {
    const colors = source()
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: false,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.surface.base).toEqual(colors.background)
    expect(tokens.surface.panel).toEqual(colors.backgroundPanel)
    expect(tokens.surface.offset).toEqual(colors.backgroundElement)
    expect(tokens.surface.overlay).toEqual(colors.backgroundMenu)
    expect(tokens.foreground.default).toEqual(colors.text)
    expect(tokens.foreground.muted).toEqual(colors.textMuted)
    expect(tokens.thinkingOpacity).toBe(0.6)
  })

  it("pairs accent fill and border so primary is not used for both roles", () => {
    const colors = source()
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: false,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.accent.fg).toEqual(colors.primary)
    expect(tokens.accent.alt).toEqual(colors.accent)
    expect(tokens.accent.secondary).toEqual(colors.secondary)
    expect(tokens.accent.bg).not.toEqual(tokens.accent.fg)
    expect(tokens.accent.border).not.toEqual(tokens.accent.fg)
    expect(tokens.border.focus).toEqual(tokens.accent.border)
  })

  it("derives readable badge foreground when the theme omits selectedListItemText", () => {
    const colors = source()
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: false,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.badge.bg).toEqual(colors.primary)
    expect(tokens.badge.fg).toEqual(contrastFg(colors.primary))
  })

  it("keeps an explicit selectedListItemText as the badge foreground", () => {
    const colors = source({ selectedListItemText: rgb(255, 0, 128) })
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: true,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.badge.fg).toEqual(colors.selectedListItemText)
  })

  it("gives warning and error a background distinct from the base surface", () => {
    const colors = source()
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: false,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.status.error.fg).toEqual(colors.error)
    expect(tokens.status.warning.fg).toEqual(colors.warning)
    expect(tokens.status.error.bg).not.toEqual(colors.background)
    expect(tokens.status.warning.bg).not.toEqual(colors.background)
  })

  it("copies syntax, markdown, and diff channels into nested tokens", () => {
    const colors = source()
    const tokens = deriveSemanticTokens(colors, {
      hasSelectedListItemText: false,
      thinkingOpacity: 0.6,
      mode: "dark",
    })
    expect(tokens.syntax.comment).toEqual(colors.syntaxComment)
    expect(tokens.syntax.keyword).toEqual(colors.syntaxKeyword)
    expect(tokens.markdown.heading).toEqual(colors.markdownHeading)
    expect(tokens.diff.added).toEqual(colors.diffAdded)
    expect(tokens.diff.addedBg).toEqual(colors.diffAddedBg)
    expect(tokens.diff.addedLineNumberBg).toEqual(colors.diffAddedLineNumberBg)
    expect(tokens.diff.hunkHeader).toEqual(colors.diffHunkHeader)
  })
})

describe("highlighter source", () => {
  it("does not read flat syntax* keys from getSyntaxRules", async () => {
    const src = await Bun.file(new URL("../../src/cli/cmd/tui/context/theme.tsx", import.meta.url)).text()
    const start = src.indexOf("function getSyntaxRules")
    const body = src.slice(start)
    expect(body).not.toMatch(/theme\.syntax[A-Z]/)
    expect(body).not.toMatch(/theme\.markdown[A-Z]/)
    expect(body).toContain("theme.syntax.comment")
    expect(body).toContain("theme.markdown.heading")
  })
})

describe("TUI callers", () => {
  it("do not read retired flat theme keys outside the theme module", async () => {
    const root = new URL("../../src/cli/cmd/tui/", import.meta.url)
    const glob = new Bun.Glob("**/*.{ts,tsx}")
    const banned =
      /theme\.(textMuted|text|primary|secondary|warning|error|success|info|backgroundPanel|backgroundElement|backgroundMenu|background|borderSubtle|borderActive)\b/
    const bareAccent = /theme\.accent(?!\.\w)/
    const hits: string[] = []
    for await (const file of glob.scan({ cwd: root.pathname })) {
      if (file.startsWith("context/theme")) continue
      const src = await Bun.file(new URL(file, root)).text()
      if (banned.test(src) || bareAccent.test(src)) hits.push(file)
    }
    expect(hits).toEqual([])
  })
})

describe("tint / contrastFg", () => {
  it("mixes toward the overlay color", () => {
    const mixed = tint(rgb(0, 0, 0), rgb(255, 0, 0), 0.5)
    expect(Math.round(mixed.r * 255)).toBe(128)
  })

  it("picks black on a light background and white on a dark one", () => {
    expect(contrastFg(rgb(250, 250, 250))).toEqual(rgb(0, 0, 0))
    expect(contrastFg(rgb(10, 10, 10))).toEqual(rgb(255, 255, 255))
    expect(luminance(rgb(255, 255, 255))).toBeGreaterThan(luminance(rgb(0, 0, 0)))
  })
})
