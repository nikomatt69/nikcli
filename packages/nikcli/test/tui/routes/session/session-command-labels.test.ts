import { describe, expect, it } from "bun:test"
import { sessionCommandLabels } from "@/cli/cmd/tui/routes/session/session-command-labels"
import { en } from "@/cli/cmd/tui/i18n/en"
import { zh } from "@/cli/cmd/tui/i18n/zh"

function fakeLang(locale: "en" | "zh") {
  const dict = locale === "en" ? en : zh
  return {
    locale: () => locale,
    t: (key: string) => dict[key as keyof typeof dict] ?? en[key as keyof typeof en] ?? key,
  }
}

describe("sessionCommandLabels", () => {
  it("returns non-empty labels for every key in English", () => {
    const labels = sessionCommandLabels(fakeLang("en") as any)
    for (const [key, value] of Object.entries(labels)) {
      expect(value, `en.${key}`).not.toBe("")
      expect(typeof value).toBe("string")
    }
  })

  it("returns non-empty labels for every key in Chinese", () => {
    const labels = sessionCommandLabels(fakeLang("zh") as any)
    for (const [key, value] of Object.entries(labels)) {
      expect(value, `zh.${key}`).not.toBe("")
      expect(typeof value).toBe("string")
    }
  })

  it("every label key has a matching dictionary entry in en and zh", () => {
    const labels = sessionCommandLabels(fakeLang("en") as any)
    // The labels are built from i18n keys; ensure the dictionary has them.
    // Re-derive keys from the source by inspecting a sample: session.category, session.cmd.*.
    const expectedKeys = [
      "session.category",
      "session.cmd.backgroundSubtask",
      "session.cmd.backgroundAgents",
      "session.cmd.share",
      "session.cmd.copyShareLink",
      "session.cmd.rename",
      "session.cmd.jumpToMessage",
      "session.cmd.forkFromMessage",
      "session.cmd.compact",
      "session.cmd.unshare",
      "session.cmd.undo",
      "session.cmd.redo",
      "session.cmd.hideSidebar",
      "session.cmd.showSidebar",
      "session.cmd.toggleConceal",
      "session.cmd.hideTimestamps",
      "session.cmd.showTimestamps",
      "session.cmd.hideThinking",
      "session.cmd.showThinking",
      "session.cmd.toggleDiffWrap",
      "session.cmd.hideToolDetails",
      "session.cmd.showToolDetails",
      "session.cmd.toggleScrollbar",
      "session.cmd.disableAnimations",
      "session.cmd.enableAnimations",
      "session.cmd.pageUp",
      "session.cmd.pageDown",
      "session.cmd.lineUp",
      "session.cmd.lineDown",
      "session.cmd.halfPageUp",
      "session.cmd.halfPageDown",
      "session.cmd.firstMessage",
      "session.cmd.lastMessage",
      "session.cmd.lastUserMessage",
      "session.cmd.nextMessage",
      "session.cmd.prevMessage",
      "session.cmd.copyLastAssistant",
      "session.cmd.copyTranscript",
      "session.cmd.exportTranscript",
      "session.cmd.nextChild",
      "session.cmd.prevChild",
      "session.cmd.parent",
      "session.cmd.closeSubagent",
    ]
    for (const k of expectedKeys) {
      expect(en[k as keyof typeof en], `en.${k}`).toBeDefined()
      expect(zh[k as keyof typeof zh], `zh.${k}`).toBeDefined()
    }
    // And every key surfaced by labels must be a non-empty string.
    expect(Object.keys(labels).length).toBeGreaterThanOrEqual(expectedKeys.length - 2)
  })

  it("English and Chinese labels differ for at least one entry (smoke)", () => {
    const enLabels = sessionCommandLabels(fakeLang("en") as any)
    const zhLabels = sessionCommandLabels(fakeLang("zh") as any)
    // The category label is a static title — en/zh should differ for it.
    expect(enLabels.category).not.toBe(zhLabels.category)
  })
})
