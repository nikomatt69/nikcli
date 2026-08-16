import { describe, expect, it } from "bun:test"
import { buildSupportPromptParts } from "@tui/component/support-prompt-parts"

describe("support prompt parts", () => {
  it("builds text and file parts", () => {
    const parts = buildSupportPromptParts("hello", [
      {
        label: "[File: a.txt]",
        part: {
          type: "file",
          mime: "text/plain",
          filename: "a.txt",
          url: "data:text/plain,hi",
        },
      },
    ])
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: "text", text: "hello" })
    expect(parts[1]?.type).toBe("file")
  })

  it("allows file-only send", () => {
    const parts = buildSupportPromptParts("", [
      {
        label: "[Image: x.png]",
        part: {
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AA==",
        },
      },
    ])
    expect(parts).toHaveLength(1)
  })
})
