import { describe, it } from "bun:test"
import type { ModelMessage } from "ai"
import { recordBenchmark } from "../benchmarks/runner"
import { Provider } from "@/provider/provider"
import { ProviderError } from "@/provider/error"
import { ProviderTransform, sanitizeSurrogates } from "@/provider/transform"
import { mapOpenAICompatibleFinishReason } from "@/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"
import { mapOpenAIResponseFinishReason } from "@/provider/sdk/copilot/responses/map-openai-responses-finish-reason"

function benchModel(): Provider.Model {
  return {
    id: "minimax-coding-plan",
    providerID: "minimax-coding-plan",
    api: { id: "minimax-coding-plan", url: "https://api.minimax.io", npm: "@ai-sdk/anthropic" },
    name: "minimax-coding-plan",
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

  // P3 asked whether `normalizeMessages` is worth rewriting. The answer is in
  // the split between these three numbers, so they are recorded together: the
  // whole transform, the per-character scan inside it, and the serialization of
  // the same payload that the request has to pay regardless. A rewrite that
  // fuses the passes can only ever move the gap between the first two.
  it("ProviderTransform.message vs its sanitization scan vs serializing the payload", () => {
    const model = benchModel()
    const build = () => {
      const out: ModelMessage[] = [{ role: "system", content: "You are a coding agent. ".repeat(60) }]
      for (let i = 0; i < 200; i += 1) {
        out.push({ role: "user", content: [{ type: "text", text: `please do task ${i}. `.repeat(30) }] })
        out.push({
          role: "assistant",
          content: [
            { type: "reasoning", text: `thinking about ${i} `.repeat(40) },
            { type: "text", text: `here is what I will do for ${i} `.repeat(30) },
            { type: "tool-call", toolCallId: `call_${i}_a-b`, toolName: "read", input: { path: `src/f${i}.ts` } },
          ],
        })
        out.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: `call_${i}_a-b`,
              toolName: "read",
              output: { type: "text", value: `line of source code ${i}\n`.repeat(400) },
            },
          ],
        })
      }
      return out
    }

    const sample = build()
    // Every string the sanitization pass visits, in the order it visits them.
    const strings: string[] = []
    for (const msg of sample) {
      if (typeof msg.content === "string") {
        strings.push(msg.content)
        continue
      }
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content as Array<{
        type: string
        text?: string
        output?: { type: string; value: string }
      }>) {
        if ((part.type === "text" || part.type === "reasoning") && part.text !== undefined) strings.push(part.text)
        if (part.type === "tool-result" && (part.output?.type === "text" || part.output?.type === "error-text")) {
          strings.push(part.output.value)
        }
      }
    }

    const iterations = 30
    const metadata = { messageCount: sample.length, stringCount: strings.length }

    // A fresh history per iteration: the transform sanitizes in place, so
    // reusing one would measure the already-clean fast path from the second
    // iteration onwards.
    const inputs = Array.from({ length: iterations }, () => build())
    let start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      ProviderTransform.message(inputs[i], model, {})
    }
    const transform = performance.now() - start

    start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      for (const value of strings) sanitizeSurrogates(value)
    }
    const scan = performance.now() - start

    start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      JSON.stringify(sample)
    }
    const serialize = performance.now() - start

    recordBenchmark({
      suite: "provider",
      module: "provider/transform",
      scenario: "message long history",
      iterations,
      value: transform,
      unit: "ms",
      metadata,
    })
    recordBenchmark({
      suite: "provider",
      module: "provider/transform",
      scenario: "sanitizeSurrogates long history",
      iterations,
      value: scan,
      unit: "ms",
      metadata,
    })
    recordBenchmark({
      suite: "provider",
      module: "provider/transform",
      scenario: "JSON.stringify long history",
      iterations,
      value: serialize,
      unit: "ms",
      metadata,
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
