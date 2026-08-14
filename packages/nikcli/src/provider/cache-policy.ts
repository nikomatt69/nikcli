// Prompt-cache breakpoint placement, kept in one place so the two injection sites
// (message-level in `transform.applyCaching`, wire-level tool definitions in
// `provider.ts`) budget against the same cap instead of each assuming it owns the
// whole allowance.
//
// Anthropic and Bedrock accept at most four cache breakpoints per request and reject
// the request outright past that — it is a 400, not a silent drop. The invalidation
// hierarchy is tools → system → messages, so the slots are spent in that order of
// static-ness: the tool array is the largest byte-stable prefix, the last system part
// carries the agent and project prompt, and the conversation tail rolls forward.
import type { ModelMessage } from "ai"
import { Flag } from "@nikcli-ai/util/flag"

/** Anthropic/Bedrock hard limit on `cache_control` markers in a single request. */
export const BREAKPOINT_CAP = 4

/**
 * Slots reserved for the wire-level tool-definition marker injected in `provider.ts`.
 * Message placement never spends these, so the tool prefix — the largest and most
 * stable block in the request — always keeps a breakpoint available.
 */
export const TOOL_BREAKPOINT_RESERVE = 1

/** Breakpoints available to message-level placement. */
export const MESSAGE_BREAKPOINT_BUDGET = BREAKPOINT_CAP - TOOL_BREAKPOINT_RESERVE

/**
 * How many trailing conversation messages to mark. A marker fixed to the latest user
 * message drifts out of Anthropic's 20-block lookback as a single turn expands into
 * many assistant/tool round-trips, forcing the large prefix to be rewritten. Marking
 * the final two messages keeps a reusable entry near the tail through long tool loops.
 */
export const CONVERSATION_TAIL = 2

/**
 * A breakpoint below the provider's minimum cacheable prefix no-ops on the wire but
 * still consumes one of the four slots. On Anthropic `system[0]` is a one-line spoof
 * header (`SystemPrompt.header`): marking it caches nothing, and the marker on the
 * following system part already covers those bytes.
 *
 * The floor is per-model and **not monotonic across generations** — it moves 4096 →
 * 2048 → 1024 → 512 as you walk the Opus line forward — so a single constant is wrong
 * in both directions at once: too permissive on the 4096-token models, where the
 * marker silently no-ops and the slot is lost, and too conservative on the 512-token
 * ones, where a prefix that would have cached is left unmarked.
 */
const MIN_CACHEABLE_TOKENS: ReadonlyArray<readonly [RegExp, number]> = [
  [/opus-4-6|opus-4-5|haiku-4-5/, 4096],
  [/opus-4-7|haiku-3-5/, 2048],
  [/opus-5|fable-5|mythos-5/, 512],
]

/** Floor for a model we don't recognise: the 1024 tier, which covers Sonnet and Opus 4.8. */
export const DEFAULT_MIN_CACHEABLE_TOKENS = 1024

/**
 * Character-per-token ratio used to compare against `textLength`, which counts
 * characters. Deliberately low: under-estimating tokens over-estimates the chars
 * needed to clear the floor, so the error costs an unmarked prefix rather than a
 * wasted slot.
 */
const CHARS_PER_TOKEN = 4

/** Minimum prefix length, in characters, worth spending a breakpoint on for this model. */
export function minCacheableChars(modelID: string): number {
  const id = modelID.toLowerCase()
  for (const [pattern, tokens] of MIN_CACHEABLE_TOKENS) {
    if (pattern.test(id)) return tokens * CHARS_PER_TOKEN
  }
  return DEFAULT_MIN_CACHEABLE_TOKENS * CHARS_PER_TOKEN
}

/** How long a written cache entry survives. */
export type Retention = "short" | "long"

/**
 * Cache lifetime for this process, from `NIKCLI_CACHE_RETENTION`.
 *
 * `short` (the default) is the provider's 5-minute entry: a write costs 1.25x base
 * input and breaks even on the second read. `long` is the 1-hour entry: the write
 * costs 2x and needs a third read to pay for itself, but it survives the gaps that
 * make a session expensive — a turn that lands six minutes after the last one
 * rewrites the whole prefix under `short`, and reads it at 0.1x under `long`.
 *
 * Opt-in rather than default because the 2x write is a real regression for bursty,
 * short-lived sessions that would have hit the 5-minute entry anyway.
 */
export function resolveRetention(value = Flag.cacheRetention()): Retention {
  return value?.trim().toLowerCase() === "long" ? "long" : "short"
}

/** The `ttl` to put on a `cache_control` block, or undefined to take the provider default. */
export function ttlFor(retention: Retention): "1h" | undefined {
  return retention === "long" ? "1h" : undefined
}

/**
 * How far back a breakpoint looks for a prior cache entry, in content blocks.
 *
 * Marking the last two messages bounds the distance between consecutive entries
 * to the block count of a *single* message, which is why `CONVERSATION_TAIL` is
 * 2 rather than 1. That bound only holds while no single message carries more
 * blocks than the provider will walk back: a turn that fans out past this many
 * parallel tool calls — or the user turn carrying their results — puts the
 * previous entry out of reach, and the conversation tail silently stops
 * hitting while the tools and system breakpoints keep working.
 *
 * Nothing caps fan-out width, so this is detected and reported rather than
 * prevented; the caller-side fix is a narrower fan-out.
 */
export const LOOKBACK_BLOCKS = 20

/** Content blocks in a message, which is what the lookback window counts. */
export function contentBlocks(msg: ModelMessage): number {
  return Array.isArray(msg.content) ? msg.content.length : 1
}

/** Messages whose own block count exceeds what a breakpoint can look back over. */
export function overLookback(msgs: readonly ModelMessage[]): ModelMessage[] {
  return msgs.filter((msg) => contentBlocks(msg) > LOOKBACK_BLOCKS)
}

function textLength(msg: ModelMessage): number {
  const content = msg.content
  if (typeof content === "string") return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce((total, part) => {
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
      return total + part.text.length
    }
    return total
  }, 0)
}

/**
 * Choose which messages get a cache breakpoint, highest value first, truncated to
 * `budget`. Returned in priority order — callers mark every entry, so the order only
 * decides what gets dropped when the budget is tight.
 */
export function plan(
  msgs: readonly ModelMessage[],
  budget = MESSAGE_BREAKPOINT_BUDGET,
  minChars = DEFAULT_MIN_CACHEABLE_TOKENS * CHARS_PER_TOKEN,
): ModelMessage[] {
  if (budget <= 0) return []

  const system = msgs.filter((msg) => msg.role === "system")
  const conversation = msgs.filter((msg) => msg.role !== "system")
  const first = system[0]
  const last = system[system.length - 1]

  const candidates: ModelMessage[] = []
  // The last system part is the agent prompt plus project instructions: the biggest
  // static block once the tool definitions are accounted for.
  if (last) candidates.push(last)
  // Then the rolling tail, so intra-turn round-trips keep hitting.
  candidates.push(...conversation.slice(-CONVERSATION_TAIL))
  // A distinct first system part earns a slot only when it is large enough to be
  // cacheable on its own — otherwise the last-system marker already covers it.
  if (first && first !== last && textLength(first) >= minChars) candidates.push(first)

  const seen = new Set<ModelMessage>()
  const picked: ModelMessage[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    picked.push(candidate)
    if (picked.length === budget) break
  }
  return picked
}

/**
 * Count `cache_control` / `cachePoint` markers already present anywhere in a built
 * request body. The wire-level tool injection uses this to stay under the cap no
 * matter what message-level placement decided.
 */
export function countWireBreakpoints(value: unknown, depth = 0): number {
  // Request bodies are shallow; the bound just stops a cyclic or pathological body
  // from turning a best-effort count into a hang.
  if (depth > 8 || value === null || typeof value !== "object") return 0
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) total += countWireBreakpoints(item, depth + 1)
    return total
  }
  let total = 0
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "cache_control" || key === "cachePoint") && item !== null && item !== undefined) {
      total += 1
      continue
    }
    total += countWireBreakpoints(item, depth + 1)
  }
  return total
}
