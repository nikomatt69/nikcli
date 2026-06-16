import { describe, expect, it } from "bun:test"
import type { LanguageModel } from "ai"
import { streamGenerativeTui } from "@/cli/cmd/tui/util/generate-viz"
import type { SpecSnapshot } from "@/cli/cmd/tui/util/spec-stream"

// Minimal hand-rolled LanguageModelV2 mock (avoids `ai/test`, which pulls in msw).
// Streams the JSON of a viz spec in small chunks, like a real model would.
function chunkedModel(json: string, pieces = 8): LanguageModel {
  const size = Math.ceil(json.length / pieces)
  const parts: any[] = [{ type: "text-start", id: "t0" }]
  for (let i = 0; i < json.length; i += size) {
    parts.push({ type: "text-delta", id: "t0", delta: json.slice(i, i + size) })
  }
  parts.push({ type: "text-end", id: "t0" })
  parts.push({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } })

  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-viz",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used")
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p)
            controller.close()
          },
        }),
      }
    },
  } as unknown as LanguageModel
}

describe("streamGenerativeTui", () => {
  it("streams render-safe snapshots incrementally and resolves the final spec", async () => {
    const json = JSON.stringify({
      title: "Build Health",
      components: [
        { type: "stat", label: "Tests", value: 128 },
        { type: "alert", severity: "success", message: "All green" },
      ],
    })

    const snapshots: SpecSnapshot[] = []
    const final = await streamGenerativeTui({
      model: chunkedModel(json),
      prompt: "show build health",
      onSnapshot: (s) => snapshots.push(s),
    })

    // Final spec is complete and validated.
    expect(final.title).toBe("Build Health")
    expect(final.components).toHaveLength(2)

    // We received progressive snapshots; component count is monotonic and ends at 2.
    expect(snapshots.length).toBeGreaterThan(1)
    const counts = snapshots.map((s) => s.components.length)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    }
    const last = snapshots[snapshots.length - 1]
    expect(last.components).toHaveLength(2)
    expect(last.streaming).toBe(false)

    // At least one intermediate snapshot showed exactly the first component while
    // still streaming — proof of real-time, incremental rendering.
    expect(snapshots.some((s) => s.components.length === 1 && s.streaming)).toBe(true)
  })
})
