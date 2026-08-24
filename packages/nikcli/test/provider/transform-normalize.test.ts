import { describe, expect, it } from "bun:test"
import type { ModelMessage } from "ai"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

function makeModel(input: { npm: string; id: string; providerID: string }): Provider.Model {
  return {
    id: input.id,
    providerID: input.providerID,
    api: { id: input.id, url: "https://example.invalid", npm: input.npm },
    name: input.id,
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
    release_date: "2025-01-01",
  }
}

// A provider with none of the per-provider branches: anything that changes here
// is the universal pass, not a vendor workaround.
const plain = makeModel({ npm: "@ai-sdk/openai", id: "gpt-5", providerID: "openai" })
const anthropic = makeModel({ npm: "@ai-sdk/anthropic", id: "claude-sonnet-4-5", providerID: "anthropic" })
const bedrock = makeModel({ npm: "@ai-sdk/amazon-bedrock", id: "anthropic.claude-v2", providerID: "amazon-bedrock" })
const mistral = makeModel({ npm: "@ai-sdk/mistral", id: "devstral-medium", providerID: "mistral" })
const deepseek = makeModel({ npm: "@ai-sdk/openai", id: "deepseek-chat", providerID: "deepseek" })

const LONE = "before\uD800after"
const PAIR = "ok 😀 done"

// The parts of a `ModelMessage` are a wide discriminated union; these are the
// fields the assertions below read, named once instead of re-asserted at every
// call site.
interface AssertablePart {
  type: string
  text?: string
  toolCallId?: string
  output?: { type: string; value: any }
  providerOptions?: {
    anthropic?: { signature?: unknown; redactedData?: unknown }
    bedrock?: { signature?: unknown; redactedData?: unknown }
  }
}

function contentOf(msg: ModelMessage | undefined): AssertablePart[] {
  const content = msg?.content
  // Every message these tests inspect has array content. Failing loudly here
  // beats an assertion that would let a shape change surface as `undefined` in
  // an unrelated expectation.
  if (!Array.isArray(content)) throw new Error("expected a message with array content")
  return content
}

/**
 * P3 wants `normalizeMessages` characterized before anyone rewrites it. It is
 * one function with eight conditional passes, and almost none of them were
 * pinned: `transform.test.ts` covers cache breakpoints, `core.test.ts` covers
 * interleaved reasoning and unsupported parts, and the rest — surrogate
 * sanitization, the vendor empty-content filters, the id scrubbing, the
 * Anthropic reorder, the Mistral sequence fix — were carried by nothing.
 *
 * These tests describe behaviour at the `ProviderTransform.message` boundary,
 * which is the only caller, so a rewrite is free to restructure the passes
 * underneath as long as the wire payload is the same.
 */
describe("normalizeMessages — surrogate sanitization (every provider)", () => {
  it("replaces lone surrogates in a system message", () => {
    const [msg] = ProviderTransform.message([{ role: "system", content: LONE }], plain, {})
    expect(msg.content).toBe("before�after")
  })

  it("replaces lone surrogates in user, assistant and tool content", () => {
    const msgs = ProviderTransform.message(
      [
        { role: "user", content: [{ type: "text", text: LONE }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: LONE },
            { type: "reasoning", text: LONE },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: LONE } }],
        },
      ],
      plain,
      {},
    )

    expect(contentOf(msgs[0])[0].text).toBe("before�after")
    expect(contentOf(msgs[1])[0].text).toBe("before�after")
    expect(contentOf(msgs[1])[1].text).toBe("before�after")
    expect(contentOf(msgs[2])[0]?.output?.value).toBe("before�after")
  })

  it("sanitizes error-text and structured content tool results", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "c1", toolName: "bash", output: { type: "error-text", value: LONE } },
            {
              type: "tool-result",
              toolCallId: "c2",
              toolName: "read",
              output: { type: "content", value: [{ type: "text", text: LONE }] },
            },
          ],
        },
      ],
      plain,
      {},
    )

    const parts = contentOf(msgs[0])
    expect(parts[0]?.output?.value).toBe("before�after")
    expect(parts[1]?.output?.value[0].text).toBe("before�after")
  })

  it("leaves a valid surrogate pair alone", () => {
    // The fast path in `sanitizeSurrogates` exists for exactly this: emoji are
    // surrogate pairs, and mangling them would corrupt ordinary conversation.
    const [msg] = ProviderTransform.message([{ role: "system", content: PAIR }], plain, {})
    expect(msg.content).toBe(PAIR)
  })

  it("mutates the caller's messages in place, parts included", () => {
    // Not a design statement — a fact about the current implementation, and the
    // reason a rewrite cannot be judged by its return value alone.
    //
    // The sanitization pass assigns through `msg.content = …` and through
    // `part.text = …`. `unsupportedParts` copies user messages first, but that
    // copy is shallow and reuses the very same part objects, so the caller's
    // parts are written through regardless of role. A replacement that returned
    // a clean copy would arguably be more correct and would still be a
    // behaviour change: callers reading their own array afterwards would then
    // see unsanitized text.
    const system: ModelMessage = { role: "system", content: LONE }
    const assistant: ModelMessage = { role: "assistant", content: [{ type: "text", text: LONE }] }
    const user: ModelMessage = { role: "user", content: [{ type: "text", text: LONE }] }
    const userPart = contentOf(user)[0]

    const result = ProviderTransform.message([system, assistant, user], plain, {})

    expect(system.content).toBe("before�after")
    expect(contentOf(assistant)[0].text).toBe("before�after")
    expect(contentOf(user)[0].text).toBe("before�after")
    // The message object was replaced for the user turn but the part was not:
    // that aliasing is exactly how the mutation escapes the copy.
    expect(result[2]).not.toBe(user)
    expect(contentOf(result[2])[0]).toBe(userPart)
  })
})

describe("normalizeMessages — Anthropic empty content", () => {
  it("drops empty text parts and messages left with nothing", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "kept" },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "" }] },
        { role: "user", content: "" },
      ],
      anthropic,
      {},
    )

    // Anthropic rejects the whole request over an empty content block, so this
    // filter is a hard requirement and not a tidy-up.
    expect(msgs).toHaveLength(1)
    expect(contentOf(msgs[0])).toHaveLength(1)
    expect(contentOf(msgs[0])[0].text).toBe("kept")
  })

  it("keeps empty reasoning that carries a signature or redacted data", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "  ", providerOptions: { anthropic: { signature: "sig" } } },
            { type: "reasoning", text: "  ", providerOptions: { anthropic: { redactedData: "red" } } },
            { type: "reasoning", text: "   " },
          ],
        },
      ],
      anthropic,
      {},
    )

    // Blank text with a signature is a real thinking block: dropping it breaks
    // the signature chain on the next turn.
    const parts = contentOf(msgs[0])
    expect(parts).toHaveLength(2)
    expect(parts[0]?.providerOptions?.anthropic?.signature).toBe("sig")
    expect(parts[1]?.providerOptions?.anthropic?.redactedData).toBe("red")
  })

  it("applies the same rule under Bedrock with Bedrock's own provider key", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: " ", providerOptions: { bedrock: { signature: "sig" } } },
            { type: "text", text: "" },
          ],
        },
      ],
      bedrock,
      {},
    )

    const parts = contentOf(msgs[0])
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe("reasoning")
  })
})

describe("normalizeMessages — tool call id shapes", () => {
  it("scrubs ids to what Claude accepts, on both sides of the call", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call/1 x.y", toolName: "read", input: {} }],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "call/1 x.y", toolName: "read", output: { type: "text", value: "ok" } },
          ],
        },
      ],
      anthropic,
      {},
    )

    // The pair has to agree, or the provider reports a tool_use without a result.
    expect(contentOf(msgs[0])[0].toolCallId).toBe("call_1_x_y")
    expect(contentOf(msgs[1])[0].toolCallId).toBe("call_1_x_y")
  })

  it("truncates and pads ids to Mistral's nine alphanumerics", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_abcdefghijkl", toolName: "read", input: {} }],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "ab-cd", toolName: "read", output: { type: "text", value: "" } },
          ],
        },
      ],
      mistral,
      {},
    )

    expect(contentOf(msgs[0])[0].toolCallId).toBe("callabcde")
    expect(contentOf(msgs[1])[0].toolCallId).toBe("abcd00000")
  })

  it("splits an assistant turn whose tool calls are followed by other content", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "c1", toolName: "read", input: {} },
            { type: "text", text: "trailing commentary" },
          ],
        },
      ],
      anthropic,
      {},
    )

    // Anthropic requires tool_use blocks last in the turn; the split puts the
    // prose first and the calls in their own message.
    expect(msgs).toHaveLength(2)
    expect(contentOf(msgs[0]).map((p) => p.type)).toEqual(["text"])
    expect(contentOf(msgs[1]).map((p) => p.type)).toEqual(["tool-call"])
  })

  it("leaves an already valid tool-call turn as one message", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "here goes" },
            { type: "tool-call", toolCallId: "c1", toolName: "read", input: {} },
          ],
        },
      ],
      anthropic,
      {},
    )

    expect(msgs).toHaveLength(1)
  })
})

describe("normalizeMessages — sequence repairs", () => {
  it("inserts an assistant turn where Mistral would see tool followed by user", () => {
    const msgs = ProviderTransform.message(
      [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: "ok" } }],
        },
        { role: "user", content: [{ type: "text", text: "and now?" }] },
      ],
      mistral,
      {},
    )

    expect(msgs.map((m) => m.role)).toEqual(["tool", "assistant", "user"])
    expect(contentOf(msgs[1])[0].text).toBe("Done.")
  })

  it("gives every DeepSeek assistant turn a reasoning part", () => {
    const msgs = ProviderTransform.message(
      [
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "assistant", content: "string answer" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "already thought" },
            { type: "text", text: "answer" },
          ],
        },
      ],
      deepseek,
      {},
    )

    expect(contentOf(msgs[0]).map((p) => p.type)).toEqual(["text", "reasoning"])
    expect(contentOf(msgs[1]).map((p) => p.type)).toEqual(["text", "reasoning"])
    // A turn that already reasoned is left exactly as it was — no second part.
    expect(contentOf(msgs[2]).map((p) => p.type)).toEqual(["reasoning", "text"])
    expect(contentOf(msgs[2])[0].text).toBe("already thought")
  })

  it("stops at the Mistral branch, so DeepSeek's injector does not also run", () => {
    // The Mistral pass returns early. That ordering is load-bearing for any
    // rewrite that flattens the passes into one walk.
    const devstral = makeModel({ npm: "@ai-sdk/mistral", id: "devstral-deepseek-mix", providerID: "mistral" })
    const msgs = ProviderTransform.message(
      [{ role: "assistant", content: [{ type: "text", text: "answer" }] }],
      devstral,
      {},
    )

    expect(contentOf(msgs[0]).map((p) => p.type)).toEqual(["text"])
  })
})
