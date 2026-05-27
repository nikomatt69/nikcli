import z from "zod"
import { Identifier } from "@/id/id"
import { MessageV2 } from "../message-v2"

export namespace SessionEntry {
  export const ID = Identifier.schema("event")
  export type ID = z.infer<typeof ID>

  /**
   * Base schema for all entries
   */
  const Base = z.object({
    id: ID,
    sessionID: z.string(),
    timestamp: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })

  // ============================================================================
  // Sub-parts — aligned with AI SDK UIMessage parts
  // ============================================================================

  /**
   * Text part — maps directly to AI SDK's `type: "text"` part
   */
  export const TextPart = z.object({
    type: z.literal("text"),
    text: z.string(),
    ignored: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type TextPart = z.infer<typeof TextPart>

  /**
   * Reasoning part — maps directly to AI SDK's `type: "reasoning"` part
   */
  export const ReasoningPart = z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  /**
   * Tool call part — maps directly to AI SDK's `type: "tool-call"` part
   */
  export const ToolCallPart = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
    argsText: z.string().optional(),
  })
  export type ToolCallPart = z.infer<typeof ToolCallPart>

  /**
   * Tool result part — maps directly to AI SDK's `type: "tool-result"` part
   */
  export const ToolResultPart = z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    attachments: MessageV2.FilePart.array().optional(),
  })
  export type ToolResultPart = z.infer<typeof ToolResultPart>

  /**
   * Assistant reasoning part type
   */
  export type AssistantReasoning = ReasoningPart

  /**
   * Assistant tool part type (input)
   */
  export type AssistantTool = ToolCallPart

  // ============================================================================
  // Assistant sub-types
  // ============================================================================

  /**
   * Assistant text — a text response from the model
   */
  export const AssistantText = Base.extend({
    role: z.literal("assistant"),
    sub: z.literal("text"),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
    finish: z.string().optional(),
    parts: z.array(z.discriminatedUnion("type", [TextPart, ReasoningPart, ToolCallPart, ToolResultPart])),
  }).meta({ ref: "SessionEntry.AssistantText" })
  export type AssistantText = z.infer<typeof AssistantText>

  /**
   * Assistant reasoning — a reasoning-only response (no text/tool calls)
   */
  export const AssistantReasoningEntry = Base.extend({
    role: z.literal("assistant"),
    sub: z.literal("reasoning"),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
    parts: z.array(ReasoningPart),
  }).meta({ ref: "SessionEntry.AssistantReasoning" })
  export type AssistantReasoningEntry = z.infer<typeof AssistantReasoningEntry>

  /**
   * Assistant tool — a tool-use-only response (no text or reasoning)
   */
  export const AssistantToolEntry = Base.extend({
    role: z.literal("assistant"),
    sub: z.literal("tool"),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
    parts: z.array(z.discriminatedUnion("type", [ToolCallPart, ToolResultPart])),
  }).meta({ ref: "SessionEntry.AssistantTool" })
  export type AssistantToolEntry = z.infer<typeof AssistantToolEntry>

  /**
   * Assistant retry — an error/retry from a previous attempt
   */
  export const AssistantRetry = Base.extend({
    role: z.literal("assistant"),
    sub: z.literal("retry"),
    attempt: z.number().int().nonnegative(),
    error: MessageV2.APIError.Schema,
  }).meta({ ref: "SessionEntry.AssistantRetry" })
  export type AssistantRetry = z.infer<typeof AssistantRetry>

  // ============================================================================
  // Top-level discriminated union
  // ============================================================================

  /**
   * User entry — the user's prompt
   */
  export const User = Base.extend({
    role: z.literal("user"),
    text: z.string(),
    files: MessageV2.FilePart.array().default([]),
    agents: MessageV2.AgentPart.array().default([]),
  }).meta({ ref: "SessionEntry.User" })
  export type User = z.infer<typeof User>

  /**
   * Synthetic entry — auto-generated messages (system, user, assistant)
   */
  export const Synthetic = Base.extend({
    role: z.literal("synthetic"),
    text: z.string(),
    roleType: z.enum(["system", "user", "assistant"]).default("assistant"),
  }).meta({ ref: "SessionEntry.Synthetic" })
  export type Synthetic = z.infer<typeof Synthetic>

  /**
   * Assistant entry — a complete assistant response
   * Discriminated by `sub` field: "text" | "reasoning" | "tool" | "retry"
   */
  export const Assistant = z.discriminatedUnion("sub", [
    AssistantText,
    AssistantReasoningEntry,
    AssistantToolEntry,
    AssistantRetry,
  ])
  export type Assistant = z.infer<typeof Assistant>

  /**
   * Complete SessionEntry discriminated union
   */
  export const Entry = z.discriminatedUnion("role", [User, Synthetic, Assistant])
  export type Entry = z.infer<typeof Entry>

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Factory to create a new entry with generated ID and timestamp
   */
  export function create<T extends Entry>(input: Omit<T, "id" | "timestamp"> & { id?: string; timestamp?: number }): T {
    return Entry.parse({
      id: input.id ?? Identifier.ascending("event"),
      timestamp: input.timestamp ?? Date.now(),
      ...input,
    }) as T
  }
}
