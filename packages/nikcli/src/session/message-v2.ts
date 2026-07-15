import { BusEvent } from "@/bus/bus-event"
import { zod, zodObject, zodObjectMode, zodOverride, type DeepMutable } from "@/util/effect-zod"
import z from "zod"
import { EventError } from "./event-error"
import { Schema } from "effect"
import {
  APICallError,
  convertToModelMessages,
  LoadAPIKeyError,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai"
import { Identifier } from "../id/id"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { fn } from "@/util/fn"
import { Storage } from "@/storage/storage"
import { ProviderError } from "@/provider/error"
import { ProviderTransform } from "@/provider/transform"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import { type SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { workMap } from "@/util/queue"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"
import { MessageRepo } from "./message-repo"

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

export namespace MessageV2 {
  // Legacy callers depend on z.object's default "strip" behavior (extra keys on
  // persisted messages from older schema versions are dropped, not rejected), so
  // every struct opts out of the walker's default `.strict()` mode.
  const strip = zodObjectMode("strip")

  /**
   * Declared `{ name, data }` error bodies. These are the wire shapes persisted on
   * assistant messages and served over HTTP; the `TaggedErrorClass`es below are the
   * runtime error channel counterparts and derive their zod statics from these.
   */
  const AuthErrorBody = Schema.Struct({
    name: Schema.Literal("ProviderAuthError"),
    data: Schema.Struct({ providerID: Schema.String, message: Schema.String }).annotate(strip),
  }).annotate({ ...strip, identifier: "ProviderAuthError" })
  const UnknownErrorBody = Schema.Struct({
    name: Schema.Literal("UnknownError"),
    data: Schema.Struct({ message: Schema.String }).annotate(strip),
  }).annotate({ ...strip, identifier: "UnknownError" })
  const OutputLengthErrorBody = Schema.Struct({
    name: Schema.Literal("MessageOutputLengthError"),
    data: Schema.Struct({}).annotate(strip),
  }).annotate({ ...strip, identifier: "MessageOutputLengthError" })
  const ContextOverflowErrorBody = Schema.Struct({
    name: Schema.Literal("MessageContextOverflowError"),
    data: Schema.Struct({
      message: Schema.String,
      responseBody: Schema.optional(Schema.String),
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "MessageContextOverflowError" })
  const AbortedErrorBody = Schema.Struct({
    name: Schema.Literal("MessageAbortedError"),
    data: Schema.Struct({ message: Schema.String }).annotate(strip),
  }).annotate({ ...strip, identifier: "MessageAbortedError" })
  const StructuredOutputErrorBody = Schema.Struct({
    name: Schema.Literal("StructuredOutputError"),
    data: Schema.Struct({ message: Schema.String, retries: Schema.Number }).annotate(strip),
  }).annotate({ ...strip, identifier: "StructuredOutputError" })
  const APIErrorBody = Schema.Struct({
    name: Schema.Literal("APIError"),
    data: Schema.Struct({
      message: Schema.String,
      statusCode: Schema.optional(Schema.Number),
      isRetryable: Schema.Boolean,
      responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      responseBody: Schema.optional(Schema.String),
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "APIError" })

  export class OutputLengthError extends Schema.TaggedErrorClass<OutputLengthError>()("MessageOutputLengthError", {}) {}
  export class ContextOverflowError extends Schema.TaggedErrorClass<ContextOverflowError>()(
    "MessageContextOverflowError",
    {
      message: Schema.String,
      responseBody: Schema.optional(Schema.String),
    },
  ) {}
  export class AbortedError extends Schema.TaggedErrorClass<AbortedError>()("MessageAbortedError", {
    message: Schema.String,
  }) {
    static readonly Schema = zodObject(AbortedErrorBody)
    static isInstance(error: unknown): error is z.infer<typeof AbortedError.Schema> {
      return typeof error === "object" && error !== null && (error as any).name === "MessageAbortedError"
    }
  }
  export class StructuredOutputError extends Schema.TaggedErrorClass<StructuredOutputError>()("StructuredOutputError", {
    message: Schema.String,
    retries: Schema.Number,
  }) {
    static readonly Schema = zodObject(StructuredOutputErrorBody)
    static isInstance(error: unknown): error is z.infer<typeof StructuredOutputError.Schema> {
      return typeof error === "object" && error !== null && (error as any).name === "StructuredOutputError"
    }
  }
  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("ProviderAuthError", {
    providerID: Schema.String,
    message: Schema.String,
  }) {
    static readonly Schema = zodObject(AuthErrorBody)
    static isInstance(error: unknown): error is z.infer<typeof AuthError.Schema> {
      return typeof error === "object" && error !== null && (error as any).name === "ProviderAuthError"
    }
  }
  export class APIError extends Schema.TaggedErrorClass<APIError>()("APIError", {
    message: Schema.String,
    statusCode: Schema.optional(Schema.Number),
    isRetryable: Schema.Boolean,
    responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    responseBody: Schema.optional(Schema.String),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }) {
    static readonly Schema = zodObject(APIErrorBody)
    static isInstance(error: unknown): error is z.infer<typeof APIError.Schema> {
      return (
        typeof error === "object" && error !== null && (error as any).name === "APIError" && "data" in (error as any)
      )
    }
    toObject() {
      return {
        name: "APIError" as const,
        data: {
          message: this.message,
          statusCode: this.statusCode,
          isRetryable: this.isRetryable,
          responseHeaders: this.responseHeaders,
          responseBody: this.responseBody,
          metadata: this.metadata,
        },
      }
    }
  }

  const OutputFormatTextSchema = Schema.Struct({
    type: Schema.Literal("text"),
  }).annotate({ ...strip, identifier: "OutputFormatText" })
  export const OutputFormatText = zodObject(OutputFormatTextSchema)

  const OutputFormatJsonSchemaSchema = Schema.Struct({
    type: Schema.Literal("json_schema"),
    schema: Schema.Record(Schema.String, Schema.Any).annotate({ identifier: "JSONSchema" }),
    // zodOverride keeps the exact legacy zod chain: `.annotate({ default })` on a
    // checked number drops the check schemaIds during the walk, losing
    // `type: integer` + bounds in the emitted JSON Schema.
    retryCount: Schema.Number.check(Schema.isInt())
      .check(Schema.isGreaterThanOrEqualTo(0))
      .annotate({ ...zodOverride(() => z.number().int().min(0).default(2)) }),
  }).annotate({ ...strip, identifier: "OutputFormatJsonSchema" })
  export const OutputFormatJsonSchema = zodObject(OutputFormatJsonSchemaSchema)

  export const FormatSchema = Schema.Union([OutputFormatTextSchema, OutputFormatJsonSchemaSchema]).annotate({
    identifier: "OutputFormat",
    discriminator: "type",
  })
  export const Format = zod(FormatSchema)
  export type OutputFormat = DeepMutable<Schema.Schema.Type<typeof FormatSchema>>

  const PartBaseFields = {
    id: Schema.String,
    sessionID: Schema.String,
    messageID: Schema.String,
  }

  export const SnapshotPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("snapshot"),
    snapshot: Schema.String,
  }).annotate({ ...strip, identifier: "SnapshotPart" })
  export const SnapshotPart = zodObject(SnapshotPartSchema)
  export type SnapshotPart = DeepMutable<Schema.Schema.Type<typeof SnapshotPartSchema>>

  export const PatchPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("patch"),
    hash: Schema.String,
    files: Schema.Array(Schema.String),
  }).annotate({ ...strip, identifier: "PatchPart" })
  export const PatchPart = zodObject(PatchPartSchema)
  export type PatchPart = DeepMutable<Schema.Schema.Type<typeof PatchPartSchema>>

  export const TextPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("text"),
    text: Schema.String,
    synthetic: Schema.optional(Schema.Boolean),
    ignored: Schema.optional(Schema.Boolean),
    time: Schema.optional(
      Schema.Struct({
        start: Schema.Number,
        end: Schema.optional(Schema.Number),
      }).annotate(strip),
    ),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  }).annotate({ ...strip, identifier: "TextPart" })
  export const TextPart = zodObject(TextPartSchema)
  export type TextPart = DeepMutable<Schema.Schema.Type<typeof TextPartSchema>>

  export const ReasoningPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("reasoning"),
    text: Schema.String,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    time: Schema.Struct({
      start: Schema.Number,
      end: Schema.optional(Schema.Number),
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "ReasoningPart" })
  export const ReasoningPart = zodObject(ReasoningPartSchema)
  export type ReasoningPart = DeepMutable<Schema.Schema.Type<typeof ReasoningPartSchema>>

  const FilePartSourceBaseFields = {
    text: Schema.Struct({
      value: Schema.String,
      start: Schema.Number.check(Schema.isInt()),
      end: Schema.Number.check(Schema.isInt()),
    }).annotate({ ...strip, identifier: "FilePartSourceText" }),
  }

  export const FileSourceSchema = Schema.Struct({
    ...FilePartSourceBaseFields,
    type: Schema.Literal("file"),
    path: Schema.String,
  }).annotate({ ...strip, identifier: "FileSource" })
  export const FileSource = zodObject(FileSourceSchema)

  export const SymbolSourceSchema = Schema.Struct({
    ...FilePartSourceBaseFields,
    type: Schema.Literal("symbol"),
    path: Schema.String,
    range: LSP.RangeSchema,
    name: Schema.String,
    kind: Schema.Number.check(Schema.isInt()),
  }).annotate({ ...strip, identifier: "SymbolSource" })
  export const SymbolSource = zodObject(SymbolSourceSchema)

  export const ResourceSourceSchema = Schema.Struct({
    ...FilePartSourceBaseFields,
    type: Schema.Literal("resource"),
    clientName: Schema.String,
    uri: Schema.String,
  }).annotate({ ...strip, identifier: "ResourceSource" })
  export const ResourceSource = zodObject(ResourceSourceSchema)

  export const FilePartSourceSchema = Schema.Union([
    FileSourceSchema,
    SymbolSourceSchema,
    ResourceSourceSchema,
  ]).annotate({
    identifier: "FilePartSource",
    discriminator: "type",
  })
  export const FilePartSource = zod(FilePartSourceSchema)

  export const FilePartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("file"),
    mime: Schema.String,
    filename: Schema.optional(Schema.String),
    url: Schema.String,
    source: Schema.optional(FilePartSourceSchema),
  }).annotate({ ...strip, identifier: "FilePart" })
  export const FilePart = zodObject(FilePartSchema)
  export type FilePart = DeepMutable<Schema.Schema.Type<typeof FilePartSchema>>

  export const AgentPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("agent"),
    name: Schema.String,
    source: Schema.optional(
      Schema.Struct({
        value: Schema.String,
        start: Schema.Number.check(Schema.isInt()),
        end: Schema.Number.check(Schema.isInt()),
      }).annotate(strip),
    ),
  }).annotate({ ...strip, identifier: "AgentPart" })
  export const AgentPart = zodObject(AgentPartSchema)
  export type AgentPart = DeepMutable<Schema.Schema.Type<typeof AgentPartSchema>>

  export const CompactionPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("compaction"),
    auto: Schema.Boolean,
  }).annotate({ ...strip, identifier: "CompactionPart" })
  export const CompactionPart = zodObject(CompactionPartSchema)
  export type CompactionPart = DeepMutable<Schema.Schema.Type<typeof CompactionPartSchema>>

  export const SubtaskPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("subtask"),
    prompt: Schema.String,
    description: Schema.String,
    agent: Schema.String,
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }).annotate(strip),
    ),
    command: Schema.optional(Schema.String),
    background: Schema.optional(Schema.Boolean),
  }).annotate({ ...strip, identifier: "SubtaskPart" })
  export const SubtaskPart = zodObject(SubtaskPartSchema)
  export type SubtaskPart = DeepMutable<Schema.Schema.Type<typeof SubtaskPartSchema>>

  export const RetryPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("retry"),
    attempt: Schema.Number,
    error: APIErrorBody,
    time: Schema.Struct({
      created: Schema.Number,
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "RetryPart" })
  export const RetryPart = zodObject(RetryPartSchema)
  export type RetryPart = DeepMutable<Schema.Schema.Type<typeof RetryPartSchema>>

  export const StepStartPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("step-start"),
    snapshot: Schema.optional(Schema.String),
  }).annotate({ ...strip, identifier: "StepStartPart" })
  export const StepStartPart = zodObject(StepStartPartSchema)
  export type StepStartPart = DeepMutable<Schema.Schema.Type<typeof StepStartPartSchema>>

  export const StepFinishPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("step-finish"),
    reason: Schema.String,
    snapshot: Schema.optional(Schema.String),
    cost: Schema.Number,
    tokens: Schema.Struct({
      total: Schema.optional(Schema.Number),
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cache: Schema.Struct({
        read: Schema.Number,
        write: Schema.Number,
      }).annotate(strip),
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "StepFinishPart" })
  export const StepFinishPart = zodObject(StepFinishPartSchema)
  export type StepFinishPart = DeepMutable<Schema.Schema.Type<typeof StepFinishPartSchema>>

  export const ToolStatePendingSchema = Schema.Struct({
    status: Schema.Literal("pending"),
    input: Schema.Record(Schema.String, Schema.Any),
    raw: Schema.String,
  }).annotate({ ...strip, identifier: "ToolStatePending" })
  export const ToolStatePending = zodObject(ToolStatePendingSchema)
  export type ToolStatePending = DeepMutable<Schema.Schema.Type<typeof ToolStatePendingSchema>>

  export const ToolProgressContentSchema = Schema.Union([
    Schema.Struct({
      type: Schema.Literal("text"),
      text: Schema.String,
    }).annotate(strip),
    Schema.Struct({
      type: Schema.Literal("file"),
      data: Schema.String,
      mime: Schema.String,
      name: Schema.optional(Schema.String),
    }).annotate(strip),
  ]).annotate({ discriminator: "type" })
  export const ToolProgressContent = zod(ToolProgressContentSchema)
  export type ToolProgressContent = DeepMutable<Schema.Schema.Type<typeof ToolProgressContentSchema>>

  export const ToolStateRunningSchema = Schema.Struct({
    status: Schema.Literal("running"),
    input: Schema.Record(Schema.String, Schema.Any),
    title: Schema.optional(Schema.String),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    structured: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    content: Schema.optional(Schema.Array(ToolProgressContentSchema)),
    time: Schema.Struct({
      start: Schema.Number,
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "ToolStateRunning" })
  export const ToolStateRunning = zodObject(ToolStateRunningSchema)
  export type ToolStateRunning = DeepMutable<Schema.Schema.Type<typeof ToolStateRunningSchema>>

  export const ToolStateCompletedSchema = Schema.Struct({
    status: Schema.Literal("completed"),
    input: Schema.Record(Schema.String, Schema.Any),
    output: Schema.String,
    title: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.Any),
    time: Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
      compacted: Schema.optional(Schema.Number),
    }).annotate(strip),
    attachments: Schema.optional(Schema.Array(FilePartSchema)),
  }).annotate({ ...strip, identifier: "ToolStateCompleted" })
  export const ToolStateCompleted = zodObject(ToolStateCompletedSchema)
  export type ToolStateCompleted = DeepMutable<Schema.Schema.Type<typeof ToolStateCompletedSchema>>

  export const ToolStateErrorSchema = Schema.Struct({
    status: Schema.Literal("error"),
    input: Schema.Record(Schema.String, Schema.Any),
    error: Schema.String,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    time: Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
    }).annotate(strip),
  }).annotate({ ...strip, identifier: "ToolStateError" })
  export const ToolStateError = zodObject(ToolStateErrorSchema)
  export type ToolStateError = DeepMutable<Schema.Schema.Type<typeof ToolStateErrorSchema>>

  export const ToolStateSchema = Schema.Union([
    ToolStatePendingSchema,
    ToolStateRunningSchema,
    ToolStateCompletedSchema,
    ToolStateErrorSchema,
  ]).annotate({ identifier: "ToolState", discriminator: "status" })
  export const ToolState = zod(ToolStateSchema)

  export const ToolPartSchema = Schema.Struct({
    ...PartBaseFields,
    type: Schema.Literal("tool"),
    callID: Schema.String,
    tool: Schema.String,
    state: ToolStateSchema,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  }).annotate({ ...strip, identifier: "ToolPart" })
  export const ToolPart = zodObject(ToolPartSchema)
  export type ToolPart = DeepMutable<Schema.Schema.Type<typeof ToolPartSchema>>

  const MessageBaseFields = {
    id: Schema.String,
    sessionID: Schema.String,
  }

  export const UserSchema = Schema.Struct({
    ...MessageBaseFields,
    role: Schema.Literal("user"),
    time: Schema.Struct({
      created: Schema.Number,
    }).annotate(strip),
    format: Schema.optional(FormatSchema),
    summary: Schema.optional(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        body: Schema.optional(Schema.String),
        diffs: Schema.Array(Snapshot.FileDiffSchema),
      }).annotate(strip),
    ),
    agent: Schema.String,
    model: Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }).annotate(strip),
    system: Schema.optional(Schema.String),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    variant: Schema.optional(Schema.String),
  }).annotate({ ...strip, identifier: "UserMessage" })
  export const User = zodObject(UserSchema)
  export type User = DeepMutable<Schema.Schema.Type<typeof UserSchema>>

  export const PartSchema = Schema.Union([
    TextPartSchema,
    SubtaskPartSchema,
    ReasoningPartSchema,
    FilePartSchema,
    ToolPartSchema,
    StepStartPartSchema,
    StepFinishPartSchema,
    SnapshotPartSchema,
    PatchPartSchema,
    AgentPartSchema,
    RetryPartSchema,
    CompactionPartSchema,
  ]).annotate({ identifier: "Part", discriminator: "type" })
  export const Part = zod(PartSchema)
  export type Part = DeepMutable<Schema.Schema.Type<typeof PartSchema>>

  /** The assistant-message error union, also embedded in `session.error` events. */
  export const AssistantErrorSchema = Schema.Union([
    AuthErrorBody,
    UnknownErrorBody,
    OutputLengthErrorBody,
    ContextOverflowErrorBody,
    AbortedErrorBody,
    StructuredOutputErrorBody,
    APIErrorBody,
  ]).annotate({ discriminator: "name" })

  export const AssistantSchema = Schema.Struct({
    ...MessageBaseFields,
    role: Schema.Literal("assistant"),
    time: Schema.Struct({
      created: Schema.Number,
      completed: Schema.optional(Schema.Number),
    }).annotate(strip),
    error: Schema.optional(AssistantErrorSchema),
    parentID: Schema.String,
    modelID: Schema.String,
    providerID: Schema.String,
    /**
     * @deprecated
     */
    mode: Schema.String,
    agent: Schema.String,
    path: Schema.Struct({
      cwd: Schema.String,
      root: Schema.String,
    }).annotate(strip),
    summary: Schema.optional(Schema.Boolean),
    cost: Schema.Number,
    tokens: Schema.Struct({
      total: Schema.optional(Schema.Number),
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cache: Schema.Struct({
        read: Schema.Number,
        write: Schema.Number,
      }).annotate(strip),
    }).annotate(strip),
    structured: Schema.optional(Schema.Any),
    finish: Schema.optional(Schema.String),
  }).annotate({ ...strip, identifier: "AssistantMessage" })
  export const Assistant = zodObject(AssistantSchema)
  export type Assistant = DeepMutable<Schema.Schema.Type<typeof AssistantSchema>>

  export const InfoSchema = Schema.Union([UserSchema, AssistantSchema]).annotate({
    identifier: "Message",
    discriminator: "role",
  })
  export const Info = zod(InfoSchema)
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  export const Event = {
    Updated: BusEvent.schema(
      "message.updated",
      Schema.Struct({
        info: InfoSchema,
      }),
    ),
    Removed: BusEvent.schema(
      "message.removed",
      Schema.Struct({
        sessionID: Schema.String,
        messageID: Schema.String,
      }),
    ),
    PartUpdated: BusEvent.schema(
      "message.part.updated",
      Schema.Struct({
        part: PartSchema,
        delta: Schema.optional(Schema.String),
      }),
    ),
    PartRemoved: BusEvent.schema(
      "message.part.removed",
      Schema.Struct({
        sessionID: Schema.String,
        messageID: Schema.String,
        partID: Schema.String,
      }),
    ),
  }

  export const WithPartsSchema = Schema.Struct({
    info: InfoSchema,
    parts: Schema.Array(PartSchema),
  }).annotate(strip)
  export const WithParts = zodObject(WithPartsSchema)
  export type WithParts = DeepMutable<Schema.Schema.Type<typeof WithPartsSchema>>

  export function toModelMessages(input: WithParts[], model: Provider.Model): ModelMessage[] {
    const result: UIMessage[] = []
    const toolNames = new Set<string>()
    // Track media from tool results that need to be injected as user messages
    // for providers that don't support media in tool results.
    //
    // OpenAI-compatible APIs only support string content in tool results, so we need
    // to extract media and inject as user messages. Other SDKs (anthropic, google,
    // bedrock) handle type: "content" with media parts natively.
    //
    // Only apply this workaround if the model actually supports image input -
    // otherwise there's no point extracting images.
    const supportsMediaInToolResults = ProviderTransform.supportsMediaInToolResults(model)

    const toModelOutput = (output: unknown) => {
      if (typeof output === "string") {
        return { type: "text", value: output }
      }

      if (typeof output === "object") {
        const outputObject = output as {
          text: string
          attachments?: Array<{ mime: string; url: string }>
        }
        const attachments = (outputObject.attachments ?? []).filter((attachment) => {
          return attachment.url.startsWith("data:") && attachment.url.includes(",")
        })

        return {
          type: "content",
          value: [
            { type: "text", text: outputObject.text },
            ...attachments.map((attachment) => ({
              type: "media",
              mediaType: attachment.mime,
              data: iife(() => {
                const commaIndex = attachment.url.indexOf(",")
                return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
              }),
            })),
          ],
        }
      }

      return { type: "json", value: output as never }
    }

    for (const msg of input) {
      if (msg.parts.length === 0) continue

      if (msg.info.role === "user") {
        const userMessage: UIMessage = {
          id: msg.info.id,
          role: "user",
          parts: [],
        }
        result.push(userMessage)
        for (const part of msg.parts) {
          if (part.type === "text" && !part.ignored)
            userMessage.parts.push({
              type: "text",
              text: part.text,
            })
          // text/plain and directory files are converted into text parts, ignore them
          if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory")
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })

          if (part.type === "compaction") {
            userMessage.parts.push({
              type: "text",
              text: "What did we do so far?",
            })
          }
          if (part.type === "subtask") {
            userMessage.parts.push({
              type: "text",
              text: "The following tool was executed by the user",
            })
          }
        }
      }

      if (msg.info.role === "assistant") {
        const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
        const media: Array<{ mime: string; url: string }> = []

        if (
          msg.info.error &&
          !(
            MessageV2.AbortedError.isInstance(msg.info.error) &&
            msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
          )
        ) {
          continue
        }
        const assistantMessage: UIMessage = {
          id: msg.info.id,
          role: "assistant",
          parts: [],
        }
        for (const part of msg.parts) {
          if (part.type === "text")
            assistantMessage.parts.push({
              type: "text",
              text: part.text,
              ...(differentModel ? {} : { providerMetadata: part.metadata }),
            })
          if (part.type === "step-start")
            assistantMessage.parts.push({
              type: "step-start",
            })
          if (part.type === "tool") {
            toolNames.add(part.tool)
            if (part.state.status === "completed") {
              const outputText = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
              const attachments = part.state.time.compacted ? [] : (part.state.attachments ?? [])

              // For providers that don't support media in tool results, extract media files
              // (images, PDFs) to be sent as a separate user message
              const isMediaAttachment = (a: { mime: string }) =>
                a.mime.startsWith("image/") || a.mime === "application/pdf"
              const mediaAttachments = attachments.filter(isMediaAttachment)
              const nonMediaAttachments = attachments.filter((a) => !isMediaAttachment(a))
              if (!supportsMediaInToolResults && mediaAttachments.length > 0) {
                media.push(...mediaAttachments)
              }
              const finalAttachments = supportsMediaInToolResults ? attachments : nonMediaAttachments

              const output =
                finalAttachments.length > 0
                  ? {
                      text: outputText,
                      attachments: finalAttachments,
                    }
                  : outputText

              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
              })
            }
            if (part.state.status === "error")
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
              })
            // Handle pending/running tool calls to prevent dangling tool_use blocks
            // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
            if (part.state.status === "pending" || part.state.status === "running")
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: "[Tool execution was interrupted]",
                ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
              })
          }
          if (part.type === "reasoning") {
            // When the destination model differs from the one that produced
            // the reasoning, drop the reasoning shape entirely and pass the
            // raw text as a plain text part. This avoids two failure modes
            // observed across providers when reasoning blocks are forwarded
            // to incompatible backends (e.g. anthropic/bedrock/glm reasoning
            // sent into an OpenAI-shaped chat endpoint):
            //   1. The receiving provider rejects reasoning content blocks
            //      it didn't emit (e.g. AI_InvalidPromptError on openrouter
            //      glm-4.5 / deepseek when the prior turn was anthropic).
            //   2. Reasoning provider-metadata refers to a signature the
            //      receiving model can't validate.
            // Inspired by opencode PR #25303 (bedrock reasoning) — same
            // pattern applies to all cross-model forwarding.
            if (differentModel) {
              if (part.text.trim().length > 0) {
                assistantMessage.parts.push({
                  type: "text",
                  text: part.text,
                })
              }
              continue
            }
            assistantMessage.parts.push({
              type: "reasoning",
              text: part.text,
              providerMetadata: part.metadata,
            })
          }
        }
        if (assistantMessage.parts.length > 0) {
          result.push(assistantMessage)
          // Inject pending media as a user message for providers that don't support
          // media (images, PDFs) in tool results
          if (media.length > 0) {
            result.push({
              id: Identifier.ascending("message"),
              role: "user",
              parts: [
                {
                  type: "text" as const,
                  text: "Attached image(s) from tool result:",
                },
                ...media.map((attachment) => ({
                  type: "file" as const,
                  url: attachment.url,
                  mediaType: attachment.mime,
                })),
              ],
            })
          }
        }
      }
    }

    const tools = Object.fromEntries(
      Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]),
    ) as unknown as ToolSet

    return convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        tools,
      },
    )
  }

  export const Cursor = z.object({
    id: z.string(),
    time: z.number(),
  })

  export const cursor = {
    encode(input: z.infer<typeof Cursor>): string {
      return Buffer.from(JSON.stringify(input)).toString("base64url")
    },
    decode(input: string): z.infer<typeof Cursor> {
      return Cursor.parse(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
    },
  }

  export const PageInput = z.object({
    sessionID: Identifier.schema("session"),
    limit: z.number().int().positive().default(50),
    before: z.string().optional(),
  })

  export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
    // Use SQL repository for listing messages
    const msgs = MessageRepo.listMessages(sessionID)
    // Fetch messages with parts, reversed (newest first)
    const messages = await workMap(
      8,
      msgs.slice().reverse(),
      async (msg) => MessageRepo.getMessageWithParts(sessionID, msg.id) ?? null,
    )
    for (const msg of messages) {
      if (msg) yield msg
    }
  })

  export const page = fn(PageInput, async (input) => {
    // Use SQL repository for listing messages
    const allMsgs = MessageRepo.listMessages(input.sessionID)
    // Sort by createdAt ascending (same as storage list order)
    allMsgs.sort((a, b) => a.time.created - b.time.created)
    // Build a list of [sessionId, _, messageId] tuples to match existing cursor logic
    const list = allMsgs.map((m) => [m.sessionID, "", m.id] as string[])

    let startIndex: number
    if (input.before) {
      const cursor = Cursor.parse(JSON.parse(Buffer.from(input.before, "base64url").toString("utf8")))
      const idx = list.findIndex((item) => item[2] === cursor.id)
      startIndex = idx === -1 ? list.length : idx
    } else {
      startIndex = list.length
    }

    // Collect the slice of message IDs we need
    const ids: string[] = []
    for (let i = startIndex - 1; i >= 0 && ids.length < input.limit; i--) {
      const messageID = list[i][2]
      if (messageID) ids.push(messageID)
    }

    // Fetch all messages with bounded concurrency via SQL
    const results = await workMap(
      8,
      ids,
      async (messageID) => MessageRepo.getMessageWithParts(input.sessionID, messageID) ?? null,
    )
    // Preserve the same ordering as sequential fetch (ids order)
    const items = results.filter((r): r is WithParts => r !== null)

    const more = items.length === input.limit
    const last = items[items.length - 1]
    const nextCursor = more && last ? MessageV2.cursor.encode({ id: last.info.id, time: Date.now() }) : undefined

    return { items, more, cursor: nextCursor }
  })

  export const parts = fn(Identifier.schema("message"), async (messageID) => {
    // Use SQL repository for listing parts
    const result = MessageRepo.listParts(messageID)
    return result
  })

  export const get = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input): Promise<WithParts> => {
      const withParts = await MessageRepo.getMessageWithParts(input.sessionID, input.messageID)
      if (!withParts) {
        throw new Storage.NotFoundError({
          message: `Message not found: ${input.messageID}`,
        })
      }
      return withParts
    },
  )

  export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
    const result = [] as MessageV2.WithParts[]
    const completed = new Set<string>()
    for await (const msg of stream) {
      result.push(msg)
      if (
        msg.info.role === "user" &&
        completed.has(msg.info.id) &&
        msg.parts.some((part) => part.type === "compaction")
      )
        break
      if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish) completed.add(msg.info.parentID)
    }
    result.reverse()
    return result
  }

  const isOpenAiErrorRetryable = (e: APICallError) => {
    const status = e.statusCode
    if (!status) return e.isRetryable
    // openai sometimes returns 404 for models that are actually available
    return status === 404 || e.isRetryable
  }

  export function fromError(e: unknown, ctx: { providerID: string }) {
    switch (true) {
      case e instanceof DOMException && e.name === "AbortError":
        return {
          name: "MessageAbortedError" as const,
          data: { message: e.message },
        }
      case e instanceof MessageV2.OutputLengthError:
        return {
          name: "MessageOutputLengthError" as const,
          data: {} as Record<string, never>,
        }
      case LoadAPIKeyError.isInstance(e):
        return {
          name: "ProviderAuthError" as const,
          data: { providerID: ctx.providerID, message: e.message },
        }
      case (e as SystemError)?.code === "ECONNRESET":
        return {
          name: "APIError" as const,
          data: {
            message: "Connection reset by server",
            isRetryable: true,
            metadata: {
              code: (e as SystemError).code ?? "",
              syscall: (e as SystemError).syscall ?? "",
              message: (e as SystemError).message ?? "",
            },
          },
        }
      case APICallError.isInstance(e): {
        const message = iife(() => {
          let msg = e.message
          if (msg === "") {
            if (e.responseBody) return e.responseBody
            if (e.statusCode) {
              const err = STATUS_CODES[e.statusCode]
              if (err) return err
            }
            return "Unknown error"
          }
          const transformed = ProviderTransform.error(ctx.providerID, e)
          if (transformed !== msg) {
            return transformed
          }
          if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
            return msg
          }

          try {
            const body = JSON.parse(e.responseBody)
            // try to extract common error message fields
            const errMsg = body.message || body.error || body.error?.message
            if (errMsg && typeof errMsg === "string") {
              return `${msg}: ${errMsg}`
            }
          } catch {}

          return `${msg}: ${e.responseBody}`
        }).trim()

        const metadata = e.url ? { url: e.url } : undefined
        return {
          name: "APIError" as const,
          data: {
            message,
            statusCode: e.statusCode,
            isRetryable: ctx.providerID.startsWith("openai") ? isOpenAiErrorRetryable(e) : e.isRetryable,
            responseHeaders: e.responseHeaders,
            responseBody: e.responseBody,
            metadata,
          },
        }
      }
      // falls through — both cases have return statements, so fall-through is unreachable
      case e instanceof Error:
        return EventError.unknown(e.toString())
      default:
        return EventError.unknown(JSON.stringify(e))
    }
  }
}
