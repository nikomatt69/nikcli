import { describe, it } from "bun:test"
import type { ModelMessage } from "ai"
import { recordBenchmark } from "../benchmarks/runner"
import { Provider } from "@/provider/provider"
import { ProviderError } from "@/provider/error"
import { ProviderTransform } from "@/provider/transform"
import { mapOpenAICompatibleFinishReason } from "@/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"
import { mapOpenAIResponseFinishReason } from "@/provider/sdk/copilot/responses/map-openai-responses-finish-reason"

function benchModel(): Provider.Model {
  return {
    id: "anthropic/claude-3-5-sonnet-20241022",
    providerID: "anthropic",
    api: { id: "claude-3-5-sonnet-20241022", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    name: "Claude",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-11-20",
  }
}

function sampleMessages(): ModelMessage[] {
  const out: ModelMessage[] = []
  for (let i = 0; i < 40; i += 1) {
    out.push({
      role: "user",
      content: [{ type: "text", text: `message ${i} `.repeat(20) }],
    })
    out.push({
      role: "assistant",
      content: [
        { type: "text", text: `reply ${i}`.repeat(10) },
        {
          type: "tool-call",
          toolCallId: `call_${i}_x-y`,
          toolName: "read",
          input: { path: "a" },
        },
      ],
    })
    out.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `call_${i}_x-y`,
          toolName: "read",
          output: { type: "text", value: "ok" },
        },
      ],
    })
  }
  return out
}

describe("Provider hot paths (benchmark)", () => {
  it("ProviderTransform.message normalizes claude tool ids (anthropic path)", () => {
    const model = benchModel()
    const msgs = sampleMessages()
    const iterations = 200
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      ProviderTransform.message(msgs, model, {})
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "provider",
      module: "provider/transform",
      scenario: "message claude tool ids",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { messageCount: msgs.length },
    })
  })

  it("ProviderError.parseStreamError and parse overflow JSON", () => {
    const body = JSON.stringify({
      type: "error",
      error: { code: "context_length_exceeded", message: "x".repeat(200) },
    })
    const iterations = 5_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      ProviderError.parseStreamError(body)
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "provider",
      module: "provider/error",
      scenario: "parseStreamError JSON overflow",
      iterations,
      value: elapsed,
      unit: "ms",
    })
  })

  it("mapOpenAICompatibleFinishReason and responses finish reason", () => {
    const inputs = [undefined, "stop", "length", "tool_calls", "content_filter", "other"] as const
    const iterations = 50_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      const fr = inputs[i % inputs.length] as (typeof inputs)[number]
      mapOpenAICompatibleFinishReason(fr)
      mapOpenAIResponseFinishReason({ finishReason: fr ?? null, hasFunctionCall: (i & 1) === 0 })
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "provider",
      module: "provider/sdk/copilot/chat",
      scenario: "map finish reasons",
      iterations,
      value: elapsed,
      unit: "ms",
    })
  })

  it("ProviderTransform.schema gemini-style enum rewrite", () => {
    const model: Provider.Model = {
      id: "gemini-2.0",
      providerID: "google",
      api: { id: "gemini-2.0", url: "https://x", npm: "@ai-sdk/google" },
      name: "G",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 1, output: 1 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    }
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { tag: { type: "string", enum: ["a", "b"] } } },
        },
      },
    }
    const iterations = 2_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      ProviderTransform.schema(model, schema as never)
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "provider",
      module: "provider/transform",
      scenario: "schema gemini sanitize",
      iterations,
      value: elapsed,
      unit: "ms",
    })
  })
})
