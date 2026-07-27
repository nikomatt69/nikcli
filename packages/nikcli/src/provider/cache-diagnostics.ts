// Observability for the breakpoint placement in `cache-policy.ts`.
//
// A prompt cache only pays off while the *prefix* of a request stays byte-stable:
// providers match the longest identical prefix and re-read everything after the
// first difference. When a cache silently stops hitting there is nothing in the
// response to say why — the token counts just shift, one billing line later.
//
// This module answers "what moved?" by hashing the wire-level request in prefix
// order (settings → tools → system → messages) and diffing consecutive requests
// for the same session. The first divergent component is the one that broke the
// cache; everything after it was going to be re-read regardless.
//
// Hash-only, never content: the snapshots outlive the request and prompts carry
// user data. Off unless NIKCLI_PROMPT_CACHE_DIAGNOSTICS is set.
import { createHash } from "crypto"

export namespace CacheDiagnostics {
  /** Sessions tracked at once. Bounds memory on long-lived servers. */
  const MAX_SESSIONS = 100

  interface Entry {
    readonly label: string
    readonly hash: string
  }

  export interface Snapshot {
    readonly settings: string
    readonly tools: readonly Entry[]
    readonly system: readonly Entry[]
    readonly messages: readonly Entry[]
  }

  export type Comparison =
    | { readonly status: "initial" }
    | { readonly status: "stable"; readonly messages: number }
    | { readonly status: "append-only"; readonly previousMessages: number; readonly currentMessages: number }
    | {
        readonly status: "changed"
        readonly component: "settings" | "tools" | "system" | "messages"
        readonly index: number
        readonly label: string
      }

  /**
   * The subset of the wire request that decides prefix stability. Modelled on
   * the AI SDK's call options so the middleware can pass them straight through,
   * but kept structural to stay independent of the SDK's type churn.
   */
  export interface RequestLike {
    readonly prompt: readonly { readonly role?: unknown; readonly content?: unknown }[]
    readonly tools?: readonly { readonly name?: unknown }[]
    readonly settings?: unknown
  }

  // Truncated: this is a change detector, not a security boundary, and short
  // hashes keep the log line readable.
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex").slice(0, 16)

  export function snapshot(request: RequestLike): Snapshot {
    // System messages lead the prompt and invalidate everything after them, so
    // they are tracked as their own component rather than as messages[0..n].
    const prompt = request.prompt ?? []
    let systemCount = 0
    while (systemCount < prompt.length && prompt[systemCount]?.role === "system") systemCount++

    return {
      settings: hash(request.settings ?? null),
      tools: (request.tools ?? []).map((tool, index) => ({
        label: typeof tool?.name === "string" ? tool.name : `tool[${index}]`,
        hash: hash(tool),
      })),
      system: prompt.slice(0, systemCount).map((part, index) => ({
        label: `system[${index}]`,
        hash: hash(part),
      })),
      messages: prompt.slice(systemCount).map((message, index) => ({
        label: `${typeof message?.role === "string" ? message.role : "message"}[${index}]`,
        hash: hash(message),
      })),
    }
  }

  export function compare(previous: Snapshot | undefined, current: Snapshot): Comparison {
    if (!previous) return { status: "initial" }
    if (previous.settings !== current.settings)
      return { status: "changed", component: "settings", index: 0, label: "model settings" }

    // Prefix order matters: report the earliest divergence, since a change in
    // tools makes any later difference in system/messages irrelevant.
    const tools = firstChange(previous.tools, current.tools, false)
    if (tools) return { status: "changed", component: "tools", ...tools }
    const system = firstChange(previous.system, current.system, false)
    if (system) return { status: "changed", component: "system", ...system }
    const messages = firstChange(previous.messages, current.messages, true)
    if (messages) return { status: "changed", component: "messages", ...messages }

    if (previous.messages.length === current.messages.length)
      return { status: "stable", messages: current.messages.length }
    // Appending to the tail is the healthy case: the whole previous request
    // stays a valid prefix, so the cache still covers it.
    return {
      status: "append-only",
      previousMessages: previous.messages.length,
      currentMessages: current.messages.length,
    }
  }

  /**
   * First index where the two lists diverge, or the truncation point when the
   * current list is shorter. `allowAppend` marks components where growth is
   * expected (the conversation tail) rather than a prefix break.
   */
  function firstChange(previous: readonly Entry[], current: readonly Entry[], allowAppend: boolean) {
    const index = previous.findIndex((entry, i) => entry.hash !== current[i]?.hash)
    if (index >= 0)
      return { index, label: current[index]?.label ?? previous[index]?.label ?? `entry[${index}]` }
    if (current.length === previous.length || (allowAppend && current.length > previous.length)) return undefined
    return { index: previous.length, label: current[previous.length]?.label ?? `entry[${previous.length}]` }
  }

  /**
   * Per-session snapshot store with insertion-order eviction. Kept as a class so
   * the diagnostics stay self-contained and testable without a live session.
   */
  export class Tracker {
    private readonly snapshots = new Map<string, Snapshot>()

    /** Record `request` for `sessionID` and report how it moved against the previous one. */
    record(sessionID: string, request: RequestLike): { comparison: Comparison; snapshot: Snapshot } {
      const current = snapshot(request)
      const comparison = compare(this.snapshots.get(sessionID), current)
      // Re-insert so the key moves to the end of the eviction order.
      this.snapshots.delete(sessionID)
      this.snapshots.set(sessionID, current)
      if (this.snapshots.size > MAX_SESSIONS) {
        const oldest = this.snapshots.keys().next().value
        if (oldest !== undefined) this.snapshots.delete(oldest)
      }
      return { comparison, snapshot: current }
    }
  }
}
