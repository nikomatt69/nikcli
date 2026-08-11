import { describe, expect, it } from "bun:test"
import type { ModelMessage } from "ai"
import * as CachePolicy from "@/provider/cache-policy"
import * as ProviderTransform from "@/provider/transform"
import type { Provider } from "@/provider/provider"

const system = (text: string): ModelMessage => ({ role: "system", content: text })
const user = (text: string): ModelMessage => ({ role: "user", content: [{ type: "text", text }] })
const assistant = (text: string): ModelMessage => ({ role: "assistant", content: [{ type: "text", text }] })

// The Anthropic system prompt nikcli actually builds: a one-line spoof header
// (`SystemPrompt.header`) followed by the agent + project prompt, recompacted to two
// parts in session/llm.ts.
const SPOOF = "You are Claude Code, Anthropic's official CLI for Claude."
const BIG_PROMPT = "agent prompt\n".repeat(500)

function anthropicModel(): Provider.Model {
  return {
    id: "claude-sonnet-5",
    providerID: "anthropic",
    api: { id: "claude-sonnet-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    capabilities: { reasoning: true, interleaved: false },
    modalities: { input: ["text"] },
  } as unknown as Provider.Model
}

function markerCount(msgs: ModelMessage[]): number {
  return msgs.reduce((total, msg) => {
    const onMessage = msg.providerOptions?.["anthropic"] ? 1 : 0
    const content = msg.content
    if (!Array.isArray(content)) return total + onMessage
    return (
      total +
      onMessage +
      content.reduce(
        (inner, part) =>
          inner + (part && typeof part === "object" && (part as any).providerOptions?.["anthropic"] ? 1 : 0),
        0,
      )
    )
  }, 0)
}

describe("CachePolicy.plan", () => {
  it("leaves a slot for the wire-level tool breakpoint", () => {
    const msgs = [system(SPOOF), system(BIG_PROMPT), user("one"), assistant("two"), user("three")]
    const planned = CachePolicy.plan(msgs)

    // Three message markers + the tool marker injected in provider.ts = the cap.
    expect(planned).toHaveLength(CachePolicy.MESSAGE_BREAKPOINT_BUDGET)
    expect(planned.length + CachePolicy.TOOL_BREAKPOINT_RESERVE).toBe(CachePolicy.BREAKPOINT_CAP)
  })

  it("skips the one-line spoof header and marks the substantive system part", () => {
    const msgs = [system(SPOOF), system(BIG_PROMPT), user("one"), assistant("two")]
    const planned = CachePolicy.plan(msgs)

    expect(planned).toContain(msgs[1])
    // The marker on the following system part already covers those bytes, so a
    // breakpoint on the spoof would cache nothing and burn one of four slots.
    expect(planned).not.toContain(msgs[0])
  })

  it("marks a distinct first system part once it is large enough to cache", () => {
    const first = system(BIG_PROMPT)
    const last = system(BIG_PROMPT + "project instructions")
    const planned = CachePolicy.plan([first, last, user("only")], 4)

    expect(planned).toContain(first)
    expect(planned).toContain(last)
  })

  it("rolls the tail forward so a long tool loop keeps hitting", () => {
    const early = [system(BIG_PROMPT), user("start"), assistant("call"), user("result-1")]
    const later = [...early, assistant("call-2"), user("result-2")]

    expect(CachePolicy.plan(later)).toContain(later[later.length - 1]!)
    expect(CachePolicy.plan(later)).not.toContain(early[1]!)
  })

  it("never marks the same message twice", () => {
    const only = system(BIG_PROMPT)
    const planned = CachePolicy.plan([only])

    expect(planned).toEqual([only])
  })

  it("returns nothing when the budget is already spent", () => {
    expect(CachePolicy.plan([system(BIG_PROMPT), user("hi")], 0)).toEqual([])
  })
})

describe("CachePolicy.minCacheableChars", () => {
  it("tracks the floor per model rather than assuming one value", () => {
    // The floor is not monotonic across generations, so these have to differ.
    expect(CachePolicy.minCacheableChars("claude-opus-5")).toBeLessThan(
      CachePolicy.minCacheableChars("claude-sonnet-5"),
    )
    expect(CachePolicy.minCacheableChars("claude-sonnet-5")).toBeLessThan(
      CachePolicy.minCacheableChars("claude-opus-4-7"),
    )
    expect(CachePolicy.minCacheableChars("claude-opus-4-7")).toBeLessThan(
      CachePolicy.minCacheableChars("claude-haiku-4-5"),
    )
  })

  it("does not confuse opus-5 with opus-4-5", () => {
    expect(CachePolicy.minCacheableChars("claude-opus-4-5")).toBe(CachePolicy.minCacheableChars("claude-opus-4-6"))
    expect(CachePolicy.minCacheableChars("claude-opus-5")).not.toBe(CachePolicy.minCacheableChars("claude-opus-4-5"))
  })

  it("falls back to the 1024 tier for a model it does not know", () => {
    expect(CachePolicy.minCacheableChars("some-future-model")).toBe(CachePolicy.DEFAULT_MIN_CACHEABLE_TOKENS * 4)
  })

  it("marks a first system part that clears the low floor but not the high one", () => {
    // ~2600 characters: above Opus 5's 512-token floor, below Haiku 4.5's 4096.
    const mid = system("x".repeat(2600))
    const last = system(BIG_PROMPT)
    const msgs = [mid, last, user("only")]

    expect(CachePolicy.plan(msgs, 4, CachePolicy.minCacheableChars("claude-opus-5"))).toContain(mid)
    expect(CachePolicy.plan(msgs, 4, CachePolicy.minCacheableChars("claude-haiku-4-5"))).not.toContain(mid)
  })
})

describe("CachePolicy.resolveRetention", () => {
  it("defaults to the 5-minute entry so no existing caller pays the 2x write", () => {
    expect(CachePolicy.resolveRetention(undefined)).toBe("short")
    expect(CachePolicy.ttlFor(CachePolicy.resolveRetention(undefined))).toBeUndefined()
  })

  it("opts into the 1-hour entry on request", () => {
    expect(CachePolicy.resolveRetention("long")).toBe("long")
    expect(CachePolicy.ttlFor("long")).toBe("1h")
  })

  it("ignores casing and surrounding whitespace", () => {
    expect(CachePolicy.resolveRetention(" LONG ")).toBe("long")
  })

  it("treats anything else as the default rather than erroring", () => {
    // `1h` is the wire value, not the setting — accepting it here would make the
    // setting look like it took effect when the resolver never matched it.
    expect(CachePolicy.resolveRetention("1h")).toBe("short")
  })
})

describe("CachePolicy.overLookback", () => {
  const wide = (blocks: number): ModelMessage => ({
    role: "assistant",
    content: Array.from({ length: blocks }, (_, i) => ({ type: "text" as const, text: `block-${i}` })),
  })

  it("accepts a message that fits inside the window", () => {
    expect(CachePolicy.overLookback([wide(CachePolicy.LOOKBACK_BLOCKS)])).toEqual([])
  })

  it("reports a fan-out wider than the window", () => {
    const tooWide = wide(CachePolicy.LOOKBACK_BLOCKS + 1)
    expect(CachePolicy.overLookback([tooWide])).toEqual([tooWide])
  })

  it("counts a string-content message as a single block", () => {
    expect(CachePolicy.contentBlocks(system("plain string content"))).toBe(1)
  })

  it("bounds the gap to one message, which is why the tail is two messages long", () => {
    // Marking both tail messages means consecutive entries are separated by one
    // message's blocks, not the whole round-trip's — so a 15-call fan-out plus its
    // 15 results stays reachable even though the pair totals 30 blocks.
    const roundTrip = [
      wide(15),
      {
        role: "user",
        content: Array.from({ length: 15 }, () => ({ type: "text" as const, text: "r" })),
      } as ModelMessage,
    ]
    expect(CachePolicy.overLookback(roundTrip)).toEqual([])
    expect(CachePolicy.CONVERSATION_TAIL).toBe(2)
  })
})

describe("CachePolicy.countWireBreakpoints", () => {
  it("counts markers across tools, system and messages", () => {
    const body = {
      tools: [{ name: "bash" }, { name: "read", cache_control: { type: "ephemeral" } }],
      system: [
        { type: "text", text: "a" },
        { type: "text", text: "b", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
    }

    expect(CachePolicy.countWireBreakpoints(body)).toBe(3)
  })

  it("counts bedrock cachePoint blocks", () => {
    expect(CachePolicy.countWireBreakpoints({ messages: [{ content: [{ cachePoint: { type: "default" } }] }] })).toBe(1)
  })

  it("ignores absent markers", () => {
    expect(CachePolicy.countWireBreakpoints({ tools: [{ name: "bash", cache_control: undefined }] })).toBe(0)
  })
})

describe("ProviderTransform.message — Anthropic breakpoint budget", () => {
  it("stays one under the cap so the tool marker fits", () => {
    const msgs: ModelMessage[] = [
      system(SPOOF),
      system(BIG_PROMPT),
      user("one"),
      assistant("two"),
      user("three"),
      assistant("four"),
    ]

    const result = ProviderTransform.message(msgs, anthropicModel(), {})

    // Anthropic rejects a request carrying more than four `cache_control` blocks, and
    // provider.ts adds the fifth-slot candidate on the tool array.
    expect(markerCount(result)).toBeLessThanOrEqual(CachePolicy.MESSAGE_BREAKPOINT_BUDGET)
  })
})
