import { describe, expect, it } from "bun:test"
import { en } from "../../src/cli/cmd/tui/i18n/en"
import { zh } from "../../src/cli/cmd/tui/i18n/zh"
import { resolveLocale, translate } from "../../src/cli/cmd/tui/context/language"

describe("TUI i18n", () => {
  it("en and zh dictionaries have identical key sets", () => {
    const enKeys = Object.keys(en).sort()
    const zhKeys = Object.keys(zh).sort()
    expect(zhKeys).toEqual(enKeys)
  })

  it("no value is left empty in either dictionary", () => {
    for (const [key, value] of Object.entries(en)) expect(value, `en.${key}`).not.toBe("")
    for (const [key, value] of Object.entries(zh)) expect(value, `zh.${key}`).not.toBe("")
  })

  it("translate interpolates {{params}} and falls back to en then key", () => {
    expect(translate("en", "prompt.placeholder.ask", { example: "hi" })).toBe('Ask anything... "hi"')
    expect(translate("zh", "prompt.placeholder.shell", { example: "ls" })).toContain("ls")
    // unknown locale falls back to English
    expect(translate("xx" as string, "prompt.commands")).toBe(en["prompt.commands"])
  })

  it("resolveLocale normalizes env values to a supported locale", () => {
    expect(resolveLocale("zh_CN.UTF-8")).toBe("zh")
    expect(resolveLocale("en_US.UTF-8")).toBe("en")
    expect(resolveLocale("fr_FR")).toBe("en") // unsupported -> default
    expect(resolveLocale(undefined)).toBeDefined()
  })
})
