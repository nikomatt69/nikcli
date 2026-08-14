import { describe, expect, it } from "bun:test"
import { readdirSync } from "fs"
import path from "path"
import {
  BUILT_IN_THEME_IDS,
  FALLBACK_THEME,
  FALLBACK_THEME_ID,
  eagerParsedThemeCount,
  eagerParsedThemeIds,
  isBuiltInTheme,
  loadBuiltInTheme,
} from "../../src/cli/cmd/tui/context/theme-catalog"

const THEME_DIR = path.join(import.meta.dir, "../../src/cli/cmd/tui/context/theme")
const UNUSED = ["arctic", "muted", "osaka-jade", "oxocarbon", "vivid", "zinc"] as const

describe("built-in theme catalog", () => {
  it("parses only the nikcli fallback at module load", () => {
    expect(eagerParsedThemeIds()).toEqual([FALLBACK_THEME_ID])
    expect(eagerParsedThemeCount()).toBe(1)
    expect(FALLBACK_THEME_ID).toBe("nikcli")
    expect(FALLBACK_THEME).toHaveProperty("theme")
  })

  it("lists every JSON document plus the dim alias, including previously unwired themes", () => {
    const files = readdirSync(THEME_DIR).filter((name) => name.endsWith(".json"))
    expect(files).toHaveLength(98)
    expect(BUILT_IN_THEME_IDS).toHaveLength(files.length + 1)
    expect(BUILT_IN_THEME_IDS).toContain("dim")
    expect(BUILT_IN_THEME_IDS).toContain("shadow")
    for (const id of UNUSED) {
      expect(BUILT_IN_THEME_IDS).toContain(id)
      expect(isBuiltInTheme(id)).toBe(true)
    }
  })

  it("loads a previously unwired theme on demand", async () => {
    const arctic = (await loadBuiltInTheme("arctic")) as { theme?: { primary?: unknown } }
    expect(arctic?.theme?.primary).toBeDefined()
  })

  it("resolves the dim alias to the shadow document", async () => {
    const dim = (await loadBuiltInTheme("dim")) as { theme?: unknown }
    const shadow = (await loadBuiltInTheme("shadow")) as { theme?: unknown }
    expect(dim?.theme).toEqual(shadow?.theme)
  })

  it("returns undefined for an unknown id", async () => {
    expect(await loadBuiltInTheme("not-a-theme")).toBeUndefined()
    expect(isBuiltInTheme("not-a-theme")).toBe(false)
  })

  it("does not statically import theme JSON from the provider module", async () => {
    const src = await Bun.file(path.join(THEME_DIR, "..", "theme.tsx")).text()
    expect(src).not.toMatch(/from ["']\.\/theme\/[^"']+\.json["']/)
  })
})
