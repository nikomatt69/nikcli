import { describe, expect, it } from "bun:test"
import { resolveRequestedStory, STORIES, storyIds } from "@tui/feature-plugins/system/storybook"
import { INTERNAL_TUI_PLUGINS } from "@tui/plugin/internal"

/**
 * The storybook's env entry point, tested without a terminal.
 *
 * `NIKCLI_STORY` exists so a component state can be looked at on demand, and its one real failure mode
 * is a typo: if an unknown id quietly booted a normal TUI, the person would sit there waiting for a
 * story that was never going to open. So an unknown id still opens the storybook, carrying the name it
 * could not match.
 */
describe("NIKCLI_STORY", () => {
  it("does not open the storybook when unset or blank", () => {
    for (const value of [undefined, "", "   "]) {
      expect(resolveRequestedStory(value)).toEqual({ open: false })
    }
  })

  it("opens a known story by id, tolerating stray whitespace", () => {
    expect(resolveRequestedStory("pending-input")).toEqual({
      open: true,
      story: "pending-input",
    })
    expect(resolveRequestedStory("  pending-input  ")).toEqual({
      open: true,
      story: "pending-input",
    })
  })

  it("opens the index and reports the name for an unknown id", () => {
    const resolved = resolveRequestedStory("pending-inputs")
    expect(resolved.open).toBe(true)
    expect(resolved.story).toBeUndefined()
    expect(resolved.unknown).toBe("pending-inputs")
  })
})

describe("story catalog", () => {
  it("ships at least the pending-input and session-task stories", () => {
    expect(storyIds()).toContain("pending-input")
    expect(storyIds()).toContain("session-task")
  })

  it("has unique, url-safe ids and a title for each story", () => {
    expect(new Set(storyIds()).size).toBe(STORIES.length)
    for (const story of STORIES) {
      expect(story.id).toMatch(/^[a-z0-9-]+$/)
      expect(story.title.length).toBeGreaterThan(0)
    }
  })

  // The plugin has to be in the internal list or none of the above is reachable at runtime.
  it("is registered as an internal TUI plugin", () => {
    expect(INTERNAL_TUI_PLUGINS.some((plugin) => "id" in plugin && plugin.id === "internal:storybook")).toBe(true)
  })
})
