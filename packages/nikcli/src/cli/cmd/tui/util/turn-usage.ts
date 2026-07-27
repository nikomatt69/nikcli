// Per-turn token accounting, derived entirely from persisted assistant usage.
//
// A "turn" is one user request and every assistant step it took to answer —
// each tool call ends a step and starts another, so a single question can cost
// a dozen model requests. The session footer only shows the *latest* context
// size, which hides that breakdown completely.
//
// The number worth watching is `cache.read`. It should grow monotonically
// across the steps of a turn: every step resends the same prefix plus the new
// tool result, so the cached portion only ever gets bigger. When it drops, the
// prefix stopped matching — the tool array reordered, a system part changed,
// compaction rewrote history — and every token before the break was re-read at
// full price. That drop is invisible in a running total, which is why it is
// surfaced here as its own signal.
//
// This module is pure: it takes messages and returns rows. `provider/cache-diagnostics.ts`
// answers the follow-up question (*which* part of the prefix moved) from the
// request side, behind NIKCLI_PROMPT_CACHE_DIAGNOSTICS.
import type { AssistantMessage, Message } from "@nikcli-ai/sdk/v2"

export namespace TurnUsage {
  export type Step = {
    /** Why this step ended — `tool-call` for a continuation, otherwise the finish reason. */
    readonly finish: string
    /** Tokens this step actually paid for: everything outside the cache hit. */
    readonly newTokens: number
    readonly cached: number
    readonly total: number
    /**
     * Tokens that were cached on the previous step and are not any more. Present
     * only on a drop; a steady or growing cache leaves it undefined.
     */
    readonly cacheBust?: number
  }

  export type Turn = {
    /** Assistant message that terminated the turn — the row anchors here. */
    readonly messageID: string
    readonly steps: readonly Step[]
    readonly newTokens: number
    readonly cached: number
    readonly total: number
    /** Total tokens lost to cache busts within the turn. */
    readonly cacheBust: number
  }

  function tokenTotal(tokens: AssistantMessage["tokens"]): number {
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  }

  /**
   * A step that only carries tool calls is a continuation: the turn is still in
   * flight. Anything else settled it. `unknown` is treated as a continuation too
   * because providers report it for interrupted streams that are then retried.
   */
  function terminates(message: AssistantMessage): boolean {
    if (message.error) return true
    return message.finish !== undefined && message.finish !== "tool-calls" && message.finish !== "unknown"
  }

  /**
   * Group assistant messages into turns. Steps with no usage recorded yet (still
   * streaming, or a message that never reached the model) are skipped rather than
   * reported as a zero-token step, and a turn with no measured step is dropped
   * entirely — an empty table says less than no table.
   *
   * Cache comparison deliberately spans turn boundaries: the first step of a turn
   * is compared against the last measured step of the previous one, since that is
   * exactly where a between-turn prefix change (a config reload, a compaction)
   * shows up.
   */
  export function compute(messages: readonly Message[]): Turn[] {
    const turns: Turn[] = []
    let steps: Step[] = []
    let previousCacheRead: number | undefined

    for (const message of messages) {
      if (message.role !== "assistant") continue
      const assistant = message as AssistantMessage
      const total = tokenTotal(assistant.tokens)

      if (total > 0) {
        const cached = assistant.tokens.cache.read
        const drop = previousCacheRead !== undefined && cached < previousCacheRead ? previousCacheRead - cached : undefined
        steps.push({
          finish: assistant.finish === "tool-calls" ? "tool-call" : (assistant.finish ?? "running"),
          newTokens: total - cached,
          cached,
          total,
          ...(drop !== undefined ? { cacheBust: drop } : {}),
        })
        previousCacheRead = cached
      }

      if (!terminates(assistant)) continue
      if (steps.length > 0) {
        turns.push({
          messageID: assistant.id,
          steps,
          newTokens: steps.reduce((sum, step) => sum + step.newTokens, 0),
          cached: steps.reduce((sum, step) => sum + step.cached, 0),
          total: steps.reduce((sum, step) => sum + step.total, 0),
          cacheBust: steps.reduce((sum, step) => sum + (step.cacheBust ?? 0), 0),
        })
      }
      steps = []
    }

    return turns
  }

  /** Index turns by the message they end, so a virtualized row can look itself up. */
  export function byMessage(messages: readonly Message[]): Map<string, Turn> {
    return new Map(compute(messages).map((turn) => [turn.messageID, turn]))
  }
}
