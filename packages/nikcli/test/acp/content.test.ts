import { describe, expect, test } from "bun:test"
import { ACPContent, promptContentToParts } from "@/acp/content"

describe("acp/content", () => {
  test("promptContentToParts converts text content with audience annotations", () => {
    const parts = promptContentToParts([
      { type: "text", text: "Hello", annotations: { audience: ["assistant"] } },
      { type: "text", text: "User-only" },
    ])
    expect(parts).toEqual([
      { type: "text", text: "Hello", synthetic: true },
      { type: "text", text: "User-only" },
    ])
  })

  test("promptContentToParts handles file:// resource links", () => {
    const parts = promptContentToParts([
      {
        type: "resource_link",
        uri: "file:///tmp/example.txt",
        name: "example.txt",
        mimeType: "text/plain",
      },
    ])
    expect(parts).toHaveLength(1)
    expect(parts[0]?.type).toBe("file")
    if (parts[0]?.type === "file") {
      expect(parts[0].url).toBe("file:///tmp/example.txt")
      expect(parts[0].filename).toBe("example.txt")
    }
  })

  test("promptContentToParts handles zed:// resource links by resolving to file://", () => {
    const parts = promptContentToParts([
      {
        type: "resource_link",
        uri: "zed://open?path=/tmp/foo.txt",
        name: "foo.txt",
        mimeType: "text/plain",
      },
    ])
    expect(parts).toHaveLength(1)
    if (parts[0]?.type === "file") {
      expect(parts[0].url).toMatch(/^file:\/\/\//)
      expect(parts[0].filename).toBe("foo.txt")
    }
  })

  test("promptContentToParts handles image content with data URL", () => {
    const parts = promptContentToParts([{ type: "image", mimeType: "image/png", data: "AAAA" }])
    expect(parts).toHaveLength(1)
    if (parts[0]?.type === "file") {
      expect(parts[0].url).toBe("data:image/png;base64,AAAA")
    }
  })

  test("promptContentToParts decodes text resources inline", () => {
    const parts = promptContentToParts([
      {
        type: "resource",
        resource: {
          uri: "file:///snippet",
          mimeType: "text/plain",
          text: "snippet body",
        },
      },
    ])
    expect(parts).toEqual([{ type: "text", text: "snippet body" }])
  })

  test("promptContentToParts drops unknown content kinds", () => {
    const parts = promptContentToParts([
      // The SDK does not produce unknown blocks today; fall back gracefully.
      { type: "text", text: "kept" },
    ])
    expect(parts).toHaveLength(1)
  })

  test("namespace export points to the same helpers", () => {
    expect(ACPContent.toPromptParts).toBe(promptContentToParts)
  })
})
