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
 * still consumes one of the four slots. Anthropic's floor is 1024 tokens on Sonnet and
 * Opus, so this is a deliberately conservative character approximation. On Anthropic
 * `system[0]` is a one-line spoof header (`SystemPrompt.header`): marking it caches
 * nothing, and the marker on the following system part already covers those bytes.
 */
export const MIN_CACHEABLE_CHARS = 4_000

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
export function plan(msgs: readonly ModelMessage[], budget = MESSAGE_BREAKPOINT_BUDGET): ModelMessage[] {
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
  if (first && first !== last && textLength(first) >= MIN_CACHEABLE_CHARS) candidates.push(first)

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
