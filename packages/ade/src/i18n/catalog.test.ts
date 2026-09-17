import { describe, expect, test } from "bun:test"
import { en } from "./en"
import { it } from "./it"

/*
 * `en: Messages` already makes tsc refuse a missing key or a different
 * parameter list. These repeat it at runtime, where it is cheap, and add the
 * two mistakes the type system cannot see: an empty English text, and one
 * that was pasted in Italian and never translated.
 */

/** Texts that are the same word in both languages, or are names. */
const SAME_IN_BOTH = new Set<string>(["settings.language.it", "settings.language.en", "preset.solo", "sidebar.spaces", "pane.quota", "settings.grid.auto", "record.consent.no", "vui.hud.no", "pane.video.title", "vui.audio.title", "browser.owner.ready", "bots.card.file", "bots.form.persona", "settings.providers.desc2After", "agent.empty.example1", "agent.empty.example2", "agent.empty.example3"])

type Key = keyof typeof it

function sample(entry: unknown): string {
  if (typeof entry !== "function") return String(entry)
  const args = Array.from({ length: entry.length }, (_, i) => `«${i}»`)
  return String(entry(...args))
}

describe("the catalogs", () => {
  test("the voice hint explains the pause in ei nik and that nik alone is enough", () => {
    const italian = it["vui.wake.hint"]("nik")
    expect(italian).toContain('Basta dire "nik"')
    expect(italian).toContain('"ei nik" staccato, con una pausa dopo il nome')
    const english = en["vui.wake.hint"]("nik")
    expect(english).toContain('Just say "nik"')
    expect(english).toContain('"ei nik" as separate words, with a pause after the name')
    expect(english).toContain('for example "nik, open the browser"')
    expect(english).not.toContain("apri il browser")
  })

  test("the English voice hint calls the configured name", () => {
    expect(en["vui.wake.hint"]("jarvis")).toStartWith('Just say "jarvis" to call it.')
  })

  test("have the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(it).sort())
  })

  test("take the same values in the same texts", () => {
    for (const key of Object.keys(it) as Key[]) {
      const source = it[key] as unknown
      const translated = en[key] as unknown
      expect(`${key}: ${typeof translated}`).toBe(`${key}: ${typeof source}`)
      if (typeof source === "function" && typeof translated === "function") {
        expect(`${key}: ${translated.length}`).toBe(`${key}: ${source.length}`)
      }
    }
  })

  test("have an English text for every key, and not the Italian one", () => {
    const empty: string[] = []
    const untranslated: string[] = []
    for (const key of Object.keys(it) as Key[]) {
      const english = sample(en[key])
      if (english.trim().length === 0) empty.push(key)
      if (english === sample(it[key]) && !SAME_IN_BOTH.has(key)) untranslated.push(key)
    }
    expect(empty).toEqual([])
    expect(untranslated).toEqual([])
  })

  test("every value a text takes shows up in it, in both languages", () => {
    const dropped: string[] = []
    for (const key of Object.keys(it) as Key[]) {
      for (const [name, entry] of [["it", it[key]], ["en", en[key]]] as const) {
        if (typeof entry !== "function") continue
        const text = sample(entry)
        for (let i = 0; i < entry.length; i++) if (!text.includes(`«${i}»`)) dropped.push(`${name} ${key} #${i}`)
      }
    }
    expect(dropped).toEqual([])
  })

  test("the exceptions still exist, so the list cannot rot", () => {
    for (const key of SAME_IN_BOTH) expect(Object.keys(it)).toContain(key)
  })
})
