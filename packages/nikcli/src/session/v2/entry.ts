import z from "zod"
import { Identifier } from "@/id/id"
import { MessageV2 } from "../message-v2"

/**
 * SessionEntry — the flat v2 conversation model.
 *
 * Every entry is a top-level record discriminated by `type`, aligned with
 * opencode's `src/v2/session-entry.ts` shape. The previous nikcli shape
 * nested streamed parts inside an `AssistantText.parts[]` array, which forced
 * the whole array to be rewritten on every token and made the durable log
 * coalesce by part id to survive it (see specs/v2/message-shape.md). Flat
 * entries make a delta a single-row upsert instead.
 *
 * Two fields exist here that opencode's shape does not carry:
 *
 * - `ref` — the originating v1 part id. It is the upsert key for live
 *   reductions: a stream re-emits the same part once per token, so the
 *   reducer must replace in place rather than append.
 * - `sessionID` / `messageID` — nikcli's event log and HTTP routes are
 *   session-scoped and correlate rows back to the v1 message.
 */
export namespace SessionEntry {
  export const ID = Identifier.schema("event")
  export type ID = z.infer<typeof ID>

  /**
   * Fields shared by every entry. Spread (not `.extend`) so each member is a
   * plain object schema and `z.discriminatedUnion` can narrow on `type`.
   */
  const Base = {
    id: ID,
    sessionID: z.string(),
    /** v1 message this entry was produced by, when it came from one */
    messageID: z.string().optional(),
    timestamp: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }

  /**
   * Originating v1 part id. Set whenever an entry is converted from a live v1
   * part so repeated `part.updated` events upsert (replace) instead of
   * appending duplicates.
   */
  const Ref = z.string().optional()

  // ============================================================================
  // Input entries
  // ============================================================================

  /** The user's prompt. */
  export const User = z
    .object({
      ...Base,
      type: z.literal("user"),
      text: z.string(),
      files: MessageV2.FilePart.array().default([]),
      agents: MessageV2.AgentPart.array().default([]),
    })
    .meta({ ref: "SessionEntry.User" })
  export type User = z.infer<typeof User>

  /** Auto-generated message injected into the conversation. */
  export const Synthetic = z
    .object({
      ...Base,
      type: z.literal("synthetic"),
      text: z.string(),
      role: z.enum(["system", "user", "assistant"]).default("assistant"),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Synthetic" })
  export type Synthetic = z.infer<typeof Synthetic>

  // ============================================================================
  // Assistant step lifecycle
  // ============================================================================

  /**
   * Start of an assistant step — carries what the request was made with.
   * `type` is "start" (not "request") to match opencode's literal.
   */
  export const Request = z
    .object({
      ...Base,
      type: z.literal("start"),
      // Defaulted, not required: an assistant message can reach the
      // projection before the model has been resolved onto it, and a
      // half-known step is still worth showing.
      providerID: z.string().default(""),
      modelID: z.string().default(""),
      agent: z.string().default(""),
      variant: z.string().optional(),
      snapshot: z.string().optional(),
    })
    .meta({ ref: "SessionEntry.Request" })
  export type Request = z.infer<typeof Request>

  /**
   * End of an assistant step — cost, tokens and finish reason. Terminal
   * message errors (abort, auth, overflow) ride on `error` so the conversion
   * from a v1 message stays lossless.
   */
  export const Complete = z
    .object({
      ...Base,
      type: z.literal("complete"),
      reason: z.string(),
      cost: z.number().default(0),
      tokens: MessageV2.Assistant.shape.tokens,
      finish: z.string().optional(),
      error: MessageV2.AssistantError.optional(),
    })
    .meta({ ref: "SessionEntry.Complete" })
  export type Complete = z.infer<typeof Complete>

  /** A failed attempt that the engine retried. */
  export const Retry = z
    .object({
      ...Base,
      type: z.literal("retry"),
      attempt: z.number().int().nonnegative(),
      error: MessageV2.APIError.Schema,
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Retry" })
  export type Retry = z.infer<typeof Retry>

  /** History was compacted at this point in the conversation. */
  export const Compaction = z
    .object({
      ...Base,
      type: z.literal("compaction"),
      auto: z.boolean().default(false),
      overflow: z.boolean().optional(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Compaction" })
  export type Compaction = z.infer<typeof Compaction>

  // ============================================================================
  // Streamed content entries
  // ============================================================================

  /** Assistant text output. */
  export const Text = z
    .object({
      ...Base,
      type: z.literal("text"),
      text: z.string(),
      ignored: z.boolean().optional(),
      synthetic: z.boolean().optional(),
      completed: z.number().optional(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Text" })
  export type Text = z.infer<typeof Text>

  /** Assistant reasoning output. */
  export const Reasoning = z
    .object({
      ...Base,
      type: z.literal("reasoning"),
      text: z.string(),
      completed: z.number().optional(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Reasoning" })
  export type Reasoning = z.infer<typeof Reasoning>

  /**
   * A tool invocation and its lifecycle. The v1 `ToolState` union is reused
   * verbatim: one entry per `callID` moves pending → running → completed |
   * error in place, so a tool never occupies more than one entry.
   */
  export const Tool = z
    .object({
      ...Base,
      type: z.literal("tool"),
      callID: z.string(),
      name: z.string(),
      state: MessageV2.ToolState,
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Tool" })
  export type Tool = z.infer<typeof Tool>

  /** A delegated sub-agent run. nikcli-specific; opencode has no equivalent. */
  export const Subtask = z
    .object({
      ...Base,
      type: z.literal("subtask"),
      prompt: z.string(),
      description: z.string(),
      agent: z.string(),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      command: z.string().optional(),
      background: z.boolean().optional(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Subtask" })
  export type Subtask = z.infer<typeof Subtask>

  // ============================================================================
  // Union
  // ============================================================================

  export const Entry = z
    .discriminatedUnion("type", [
      User,
      Synthetic,
      Request,
      Text,
      Reasoning,
      Tool,
      Subtask,
      Complete,
      Retry,
      Compaction,
    ])
    .meta({ ref: "SessionEntry" })
  export type Entry = z.infer<typeof Entry>

  /** Entry kinds that carry a `ref` and are therefore upsert targets. */
  export type Streamed = Text | Reasoning | Tool | Subtask | Retry | Compaction | Synthetic

  const STREAMED = new Set(["text", "reasoning", "tool", "subtask", "retry", "compaction", "synthetic"])

  export function isStreamed(entry: Entry): entry is Streamed {
    return STREAMED.has(entry.type)
  }

  /** The originating v1 part id, when the entry came from one. */
  export function refOf(entry: Entry): string | undefined {
    return isStreamed(entry) ? entry.ref : undefined
  }

  const ASSISTANT = new Set(["start", "text", "reasoning", "tool", "subtask", "complete", "retry"])

  /** True for entries produced by an assistant step (as opposed to input). */
  export function isAssistant(entry: Entry): boolean {
    return ASSISTANT.has(entry.type)
  }

  // ============================================================================
  // v1 → v2 conversion
  // ============================================================================

  /** Everything the conversion needs that does not live on the part itself. */
  export interface FromV1Context {
    sessionID: string
    messageID?: string
    id?: string
    timestamp?: number
  }

  /**
   * Convert a single v1 message part to its v2 entry. Returns undefined for
   * part kinds the v2 shape does not model as entries (step markers,
   * snapshots, patches, and file/agent parts — those ride on the User entry).
   */
  export function fromV1Part(part: MessageV2.Part, ctx: FromV1Context): Entry | undefined {
    const base = {
      id: ctx.id ?? Identifier.ascending("event"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID ?? part.messageID,
      ref: part.id,
    }

    switch (part.type) {
      case "text":
        return Text.parse({
          ...base,
          timestamp: ctx.timestamp ?? part.time?.start ?? Date.now(),
          type: "text",
          text: part.text,
          ignored: part.ignored,
          synthetic: part.synthetic,
          completed: part.time?.end,
        })
      case "reasoning":
        return Reasoning.parse({
          ...base,
          timestamp: ctx.timestamp ?? part.time?.start ?? Date.now(),
          type: "reasoning",
          text: part.text,
          completed: part.time?.end,
        })
      case "tool":
        return Tool.parse({
          ...base,
          timestamp: ctx.timestamp ?? Date.now(),
          type: "tool",
          callID: part.callID,
          name: part.tool,
          state: part.state,
          metadata: part.metadata,
        })
      case "subtask":
        return Subtask.parse({
          ...base,
          timestamp: ctx.timestamp ?? Date.now(),
          type: "subtask",
          prompt: part.prompt,
          description: part.description,
          agent: part.agent,
          model: part.model,
          command: part.command,
          background: part.background,
        })
      case "retry":
        return Retry.parse({
          ...base,
          timestamp: ctx.timestamp ?? part.time.created,
          type: "retry",
          attempt: part.attempt,
          error: part.error,
        })
      case "compaction":
        return Compaction.parse({
          ...base,
          timestamp: ctx.timestamp ?? Date.now(),
          type: "compaction",
          auto: part.auto,
        })
      default:
        return undefined
    }
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /** Create an entry, filling in a generated id and timestamp. */
  export function create<T extends Entry>(input: Omit<T, "id" | "timestamp"> & { id?: string; timestamp?: number }): T {
    return Entry.parse({
      ...input,
      id: input.id ?? Identifier.ascending("event"),
      timestamp: input.timestamp ?? Date.now(),
    }) as T
  }
}
