import { describe, expect, it } from "bun:test"
import { en } from "../../src/cli/cmd/tui/i18n/en"
import { zh } from "../../src/cli/cmd/tui/i18n/zh"
import { es } from "../../src/cli/cmd/tui/i18n/es"
import { fr } from "../../src/cli/cmd/tui/i18n/fr"
import { de } from "../../src/cli/cmd/tui/i18n/de"
import { it as itLocale } from "../../src/cli/cmd/tui/i18n/it"
import { pt } from "../../src/cli/cmd/tui/i18n/pt"
import { ja } from "../../src/cli/cmd/tui/i18n/ja"
import { ko } from "../../src/cli/cmd/tui/i18n/ko"
import { ru } from "../../src/cli/cmd/tui/i18n/ru"
import { ar } from "../../src/cli/cmd/tui/i18n/ar"
import { hi } from "../../src/cli/cmd/tui/i18n/hi"
import { resolveLocale, translate } from "../../src/cli/cmd/tui/context/language"

// All locales shipped with the TUI. Add a new entry here when introducing a new catalog.
const LOCALES = {
  en,
  zh,
  es,
  fr,
  de,
  it: itLocale,
  pt,
  ja,
  ko,
  ru,
  ar,
  hi,
} as const

describe("TUI i18n", () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    it(`every locale has identical key set to en (${code})`, () => {
      const enKeys = Object.keys(en).sort()
      const localeKeys = Object.keys(dict).sort()
      expect(localeKeys).toEqual(enKeys)
    })

    it(`no value is empty in ${code}`, () => {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${code}.${key}`).not.toBe("")
      }
    })
  }

  it("translate interpolates {{params}} and falls back to en then key", () => {
    expect(translate("en", "prompt.placeholder.ask", { example: "hi" })).toBe('Ask anything... "hi"')
    expect(translate("zh", "prompt.placeholder.shell", { example: "ls" })).toContain("ls")
    expect(translate("fr", "prompt.placeholder.ask", { example: "hi" })).toContain("hi")
    expect(translate("ja", "prompt.placeholder.shell", { example: "pwd" })).toContain("pwd")
    // unknown locale falls back to English
    expect(translate("xx" as string, "prompt.commands")).toBe(en["prompt.commands"])
  })

  it("resolveLocale normalizes env values to a supported locale", () => {
    expect(resolveLocale("zh_CN.UTF-8")).toBe("zh")
    expect(resolveLocale("en_US.UTF-8")).toBe("en")
    expect(resolveLocale("fr_FR")).toBe("fr")
    expect(resolveLocale("de_DE.UTF-8")).toBe("de")
    expect(resolveLocale("it_IT")).toBe("it")
    expect(resolveLocale("pt_BR.UTF-8")).toBe("pt")
    expect(resolveLocale("ja_JP.UTF-8")).toBe("ja")
    expect(resolveLocale("ko_KR.UTF-8")).toBe("ko")
    expect(resolveLocale("ru_RU.UTF-8")).toBe("ru")
    expect(resolveLocale("ar_SA.UTF-8")).toBe("ar")
    expect(resolveLocale("hi_IN.UTF-8")).toBe("hi")
    expect(resolveLocale("sv_SE")).toBe("en") // unsupported -> default
    expect(resolveLocale(undefined)).toBeDefined()
  })

  it("resolveLocale respects NIKCLI_LOCALE / NIKCLI_LANGUAGE / NIKCLI_LANG overrides", () => {
    const original = {
      NIKCLI_LOCALE: process.env.NIKCLI_LOCALE,
      NIKCLI_LANGUAGE: process.env.NIKCLI_LANGUAGE,
      NIKCLI_LANG: process.env.NIKCLI_LANG,
      LC_ALL: process.env.LC_ALL,
      LC_MESSAGES: process.env.LC_MESSAGES,
      LANG: process.env.LANG,
      LANGUAGE: process.env.LANGUAGE,
    }
    try {
      // Without any override, the POSIX env wins (en_US).
      delete process.env.NIKCLI_LOCALE
      delete process.env.NIKCLI_LANGUAGE
      delete process.env.NIKCLI_LANG
      delete process.env.LC_ALL
      delete process.env.LC_MESSAGES
      process.env.LANG = "en_US.UTF-8"
      expect(resolveLocale()).toBe("en")

      // NIKCLI_LANG beats POSIX env — the most common explicit override case
      ;(["it_IT.UTF-8", "ja-JP", "fr", "de-DE"] as const).forEach((value) => {
        process.env.NIKCLI_LANG = value
        const expected = value.split(/[._-]/)[0].toLowerCase()
        expect(resolveLocale()).toBe(expected)
      })

      // NIKCLI_LOCALE beats POSIX env
      process.env.NIKCLI_LANG = ""
      process.env.NIKCLI_LOCALE = "ja-JP"
      expect(resolveLocale()).toBe("ja")

      // NIKCLI_LANGUAGE beats POSIX env
      process.env.NIKCLI_LOCALE = ""
      process.env.NIKCLI_LANGUAGE = "fr"
      expect(resolveLocale()).toBe("fr")

      // An empty/unset NIKCLI_LANG falls back to POSIX env
      process.env.NIKCLI_LANG = ""
      process.env.NIKCLI_LANGUAGE = ""
      delete process.env.LANG
      process.env.LANG = "en_US.UTF-8"
      expect(resolveLocale()).toBe("en")
    } finally {
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  it("resolveLocale falls back to Intl when no env is set (macOS without LANG)", () => {
    const original = {
      NIKCLI_LOCALE: process.env.NIKCLI_LOCALE,
      NIKCLI_LANGUAGE: process.env.NIKCLI_LANGUAGE,
      NIKCLI_LANG: process.env.NIKCLI_LANG,
      LC_ALL: process.env.LC_ALL,
      LC_MESSAGES: process.env.LC_MESSAGES,
      LANG: process.env.LANG,
      LANGUAGE: process.env.LANGUAGE,
    }
    const originalIntl = Intl.DateTimeFormat
    try {
      delete process.env.NIKCLI_LOCALE
      delete process.env.NIKCLI_LANGUAGE
      delete process.env.NIKCLI_LANG
      delete process.env.LC_ALL
      delete process.env.LC_MESSAGES
      delete process.env.LANG
      delete process.env.LANGUAGE

      // @ts-expect-error - intentionally stub for the test
      Intl.DateTimeFormat = function () {
        return { resolvedOptions: () => ({ locale: "it-IT" }) }
      }
      expect(resolveLocale()).toBe("it")

      // @ts-expect-error - intentionally stub for the test
      Intl.DateTimeFormat = function () {
        return { resolvedOptions: () => ({ locale: "en-US" }) }
      }
      expect(resolveLocale()).toBe("en")
    } finally {
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      Intl.DateTimeFormat = originalIntl
    }
  })
})
