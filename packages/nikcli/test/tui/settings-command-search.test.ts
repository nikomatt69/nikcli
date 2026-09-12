import { describe, expect, test } from "bun:test"
import { SETTINGS_CATEGORIES, settingsCommandOptions } from "@tui/component/dialog-settings"

describe("settings command search", () => {
  test("provides category and individual setting entries with supplemental keywords", () => {
    const options = settingsCommandOptions()
    const expected = SETTINGS_CATEGORIES.reduce((total, category) => total + category.settings.length + 1, 0)

    expect(options).toHaveLength(expected)
    expect(new Set(options.map((option) => option.value)).size).toBe(expected)
    expect(options.find((option) => option.title === "Thinking")?.searchText).toContain("reasoning")
    expect(options.find((option) => option.title === "Sidebar Settings")?.searchText).toContain("side panel")
    expect(options.find((option) => option.title === "Sound Effects")?.searchText).toContain("sound")
    expect(options.find((option) => option.title === "Audio Settings")?.searchText).toContain("mute")
  })

  test("opens the owning category directly", () => {
    let replacement: (() => unknown) | undefined
    const dialog = {
      replace(content: () => unknown) {
        replacement = content
      },
    }
    const option = settingsCommandOptions().find((item) => item.title === "Show Model")

    option?.onSelect?.(dialog as never)

    expect(replacement).toBeFunction()
  })

  test("Sound Effects entry opens the Audio category", () => {
    let replacement: (() => unknown) | undefined
    const dialog = {
      replace(content: () => unknown) {
        replacement = content
      },
    }
    const option = settingsCommandOptions().find((item) => item.title === "Sound Effects")

    option?.onSelect?.(dialog as never)

    expect(replacement).toBeFunction()
  })
})
