import { describe, expect, it } from "bun:test"
import {
  collectBlobIDsFromParts,
  dehydratePromptEntry,
  parseDataUrl,
  toDataUrl,
} from "@nikcli-ai/util/prompt-blob"

describe("parseDataUrl / toDataUrl", () => {
  it("round-trips base64 image data URLs", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    const url = toDataUrl(bytes, "image/png")
    expect(url.startsWith("data:image/png;base64,")).toBe(true)

    const parsed = parseDataUrl(url)
    expect(parsed).toBeDefined()
    expect(parsed!.mime).toBe("image/png")
    expect([...parsed!.bytes]).toEqual([...bytes])
  })

  it("returns undefined for non-data URLs", () => {
    expect(parseDataUrl("https://example.com/x.png")).toBeUndefined()
    expect(parseDataUrl("not a url")).toBeUndefined()
  })

  it("defaults mime when absent", () => {
    const parsed = parseDataUrl("data:;base64," + Buffer.from("hi").toString("base64"))
    expect(parsed?.mime).toBe("application/octet-stream")
    expect(new TextDecoder().decode(parsed!.bytes)).toBe("hi")
  })
})

describe("collectBlobIDsFromParts", () => {
  it("collects blobID from file parts", () => {
    const ids = collectBlobIDsFromParts([
      { type: "text", text: "x" },
      { type: "file", source: { blobID: "abc" } },
    ])
    expect([...ids]).toEqual(["abc"])
  })
})

describe("capPromptEntryBytes", () => {
  it("truncates oversized text parts past the byte cap and leaves small entries untouched", async () => {
    const { capPromptEntryBytes } = await import("@nikcli-ai/util/prompt-blob")
    const small = { input: "hi", parts: [{ type: "text", text: "short" }] }
    expect(capPromptEntryBytes(small)).toEqual(small)

    const huge = { input: "x", parts: [{ type: "text", text: "A".repeat(200_000) }] }
    const capped = capPromptEntryBytes(huge, 128 * 1024)
    const text = (capped.parts[0] as Record<string, unknown>).text as string
    expect(text.length).toBeLessThan(200_000)
    expect(text).toContain("truncated")
  })
})

describe("dehydratePromptEntry", () => {
  it("strips data url and keeps metadata when blob write fails", async () => {
    const url = toDataUrl(new Uint8Array([1, 2]), "image/png")
    const entry = {
      input: "hi",
      parts: [{ type: "file", url, mime: "image/png", filename: "a.png" }],
    }
    const out = await dehydratePromptEntry(entry)
    const part = out.parts[0] as Record<string, unknown>
    expect(part.url).toBeUndefined()
  })
})
