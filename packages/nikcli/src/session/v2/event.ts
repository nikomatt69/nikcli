import z from "zod"
import { Identifier } from "@/id/id"
import { MessageV2 } from "../message-v2"

export namespace SessionEvent {
  export const ID = Identifier.schema("event")
  export type ID = z.infer<typeof ID>

  const Base = z.object({
    id: ID,
    sessionID: z.string(),
    timestamp: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })

  export const Source = z.object({
    start: z.number().int(),
    end: z.number().int(),
    text: z.string(),
  })
  export type Source = z.infer<typeof Source>

  export const FileAttachment = z
    .object({
      uri: z.string(),
      mime: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      source: Source.optional(),
    })
    .meta({ ref: "SessionEvent.FileAttachment" })
  export type FileAttachment = z.infer<typeof FileAttachment>

  export const AgentAttachment = z
    .object({
      name: z.string(),
      source: Source.optional(),
    })
    .meta({ ref: "SessionEvent.AgentAttachment" })
  export type AgentAttachment = z.infer<typeof AgentAttachment>

  export const Prompt = Base.extend({
    type: z.literal("prompt"),
    messageID: z.string(),
    text: z.string(),
    files: z.array(FileAttachment).default([]),
    agents: z.array(AgentAttachment).default([]),
  }).meta({ ref: "SessionEvent.Prompt" })
  export type Prompt = z.infer<typeof Prompt>

  export const Synthetic = Base.extend({
    type: z.literal("synthetic"),
    messageID: z.string(),
    text: z.string(),
    role: z.enum(["system", "user", "assistant"]).default("assistant"),
  }).meta({ ref: "SessionEvent.Synthetic" })
  export type Synthetic = z.infer<typeof Synthetic>

  export const StepStarted = Base.extend({
    type: z.literal("step.started"),
    messageID: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    agent: z.string(),
    snapshot: z.string().optional(),
  }).meta({ ref: "SessionEvent.StepStarted" })
  export type StepStarted = z.infer<typeof StepStarted>

  export const StepEnded = Base.extend({
    type: z.literal("step.ended"),
    messageID: z.string(),
    reason: z.string(),
    cost: z.number().default(0),
    tokens: MessageV2.Assistant.shape.tokens,
    finish: z.string().optional(),
  }).meta({ ref: "SessionEvent.StepEnded" })
  export type StepEnded = z.infer<typeof StepEnded>

  export const RetryError = Base.extend({
    type: z.literal("retry.error"),
    messageID: z.string(),
    attempt: z.number().int().nonnegative(),
    error: MessageV2.APIError.Schema,
  }).meta({ ref: "SessionEvent.RetryError" })
  export type RetryError = z.infer<typeof RetryError>

  export const PartUpdated = Base.extend({
    type: z.literal("part.updated"),
    part: MessageV2.Part,
    delta: z.string().optional(),
  }).meta({ ref: "SessionEvent.PartUpdated" })
  export type PartUpdated = z.infer<typeof PartUpdated>

  export const PartRemoved = Base.extend({
    type: z.literal("part.removed"),
    messageID: z.string(),
    partID: z.string(),
  }).meta({ ref: "SessionEvent.PartRemoved" })
  export type PartRemoved = z.infer<typeof PartRemoved>

  export const Event = z
    .discriminatedUnion("type", [Prompt, Synthetic, StepStarted, StepEnded, RetryError, PartUpdated, PartRemoved])
    .meta({ ref: "SessionEvent" })
  export type Event = z.infer<typeof Event>

  export function create<T extends Omit<Event, "id" | "timestamp"> & { timestamp?: number; id?: string }>(
    input: T,
  ): Event {
    return Event.parse({
      id: input.id ?? Identifier.ascending("event"),
      timestamp: input.timestamp ?? Date.now(),
      ...input,
    })
  }
}
