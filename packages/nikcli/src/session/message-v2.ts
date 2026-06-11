import { BusEvent } from "@/bus/bus-event"
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
    static readonly Schema = z
      .object({
        name: z.literal("MessageAbortedError"),
        data: z.object({ message: z.string() }),
      })
      .meta({ ref: "MessageAbortedError" })
    static isInstance(error: unknown): error is z.infer<typeof AbortedError.Schema> {
      return typeof error === "object" && error !== null && (error as any).name === "MessageAbortedError"
    }
  }
  export class StructuredOutputError extends Schema.TaggedErrorClass<StructuredOutputError>()("StructuredOutputError", {
    message: Schema.String,
    retries: Schema.Number,
  }) {
    static readonly Schema = z
      .object({
        name: z.literal("StructuredOutputError"),
        data: z.object({ message: z.string(), retries: z.number() }),
      })
      .meta({ ref: "StructuredOutputError" })
    static isInstance(error: unknown): error is z.infer<typeof StructuredOutputError.Schema> {
      return typeof error === "object" && error !== null && (error as any).name === "StructuredOutputError"
    }
  }
  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("ProviderAuthError", {
    providerID: Schema.String,
    message: Schema.String,
  }) {
    static readonly Schema = z
      .object({
        name: z.literal("ProviderAuthError"),
        data: z.object({ providerID: z.string(), message: z.string() }),
      })
      .meta({ ref: "ProviderAuthError" })
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
    static readonly Schema = z
      .object({
        name: z.literal("APIError"),
        data: z.object({
          message: z.string(),
          statusCode: z.number().optional(),
          isRetryable: z.boolean(),
          responseHeaders: z.record(z.string(), z.string()).optional(),
          responseBody: z.string().optional(),
          metadata: z.record(z.string(), z.string()).optional(),
        }),
      })
      .meta({ ref: "APIError" })
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

  export const OutputFormatText = z
    .object({
      type: z.literal("text"),
    })
    .meta({
      ref: "OutputFormatText",
    })

  export const OutputFormatJsonSchema = z
    .object({
      type: z.literal("json_schema"),
      schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
      retryCount: z.number().int().min(0).default(2),
    })
    .meta({
      ref: "OutputFormatJsonSchema",
    })

  export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
    ref: "OutputFormat",
  })
  export type OutputFormat = z.infer<typeof Format>

  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
  })

  export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
  }).meta({
    ref: "SnapshotPart",
  })
  export type SnapshotPart = z.infer<typeof SnapshotPart>

  export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
  }).meta({
    ref: "PatchPart",
  })
  export type PatchPart = z.infer<typeof PatchPart>

  export const TextPart = PartBase.extend({
    type: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(),
    ignored: z.boolean().optional(),
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "TextPart",
  })
  export type TextPart = z.infer<typeof TextPart>

  export const ReasoningPart = PartBase.extend({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }).meta({
    ref: "ReasoningPart",
  })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .meta({
        ref: "FilePartSourceText",
      }),
  })

  export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
  }).meta({
    ref: "FileSource",
  })

  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"),
    path: z.string(),
    range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
  }).meta({
    ref: "SymbolSource",
  })

  export const ResourceSource = FilePartSourceBase.extend({
    type: z.literal("resource"),
    clientName: z.string(),
    uri: z.string(),
  }).meta({
    ref: "ResourceSource",
  })

  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
    ref: "FilePartSource",
  })

  export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).meta({
    ref: "FilePart",
  })
  export type FilePart = z.infer<typeof FilePart>

  export const AgentPart = PartBase.extend({
    type: z.literal("agent"),
    name: z.string(),
    source: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .optional(),
  }).meta({
    ref: "AgentPart",
  })
  export type AgentPart = z.infer<typeof AgentPart>

  export const CompactionPart = PartBase.extend({
    type: z.literal("compaction"),
    auto: z.boolean(),
  }).meta({
    ref: "CompactionPart",
  })
  export type CompactionPart = z.infer<typeof CompactionPart>

  export const SubtaskPart = PartBase.extend({
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
  }).meta({
    ref: "SubtaskPart",
  })
  export type SubtaskPart = z.infer<typeof SubtaskPart>

  export const RetryPart = PartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
      created: z.number(),
    }),
  }).meta({
    ref: "RetryPart",
  })
  export type RetryPart = z.infer<typeof RetryPart>

  export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
    snapshot: z.string().optional(),
  }).meta({
    ref: "StepStartPart",
  })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: z.object({
      total: z.number().optional(),
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
  }).meta({
    ref: "StepFinishPart",
  })
  export type StepFinishPart = z.infer<typeof StepFinishPart>

  export const ToolStatePending = z
    .object({
      status: z.literal("pending"),
      input: z.record(z.string(), z.any()),
      raw: z.string(),
    })
    .meta({
      ref: "ToolStatePending",
    })

  export type ToolStatePending = z.infer<typeof ToolStatePending>

  export const ToolStateRunning = z
    .object({
      status: z.literal("running"),
      input: z.record(z.string(), z.any()),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateRunning",
    })
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>

  export const ToolStateCompleted = z
    .object({
      status: z.literal("completed"),
      input: z.record(z.string(), z.any()),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
        compacted: z.number().optional(),
      }),
      attachments: FilePart.array().optional(),
    })
    .meta({
      ref: "ToolStateCompleted",
    })
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

  export const ToolStateError = z
    .object({
      status: z.literal("error"),
      input: z.record(z.string(), z.any()),
      error: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateError",
    })
  export type ToolStateError = z.infer<typeof ToolStateError>

  export const ToolState = z
    .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
    .meta({
      ref: "ToolState",
    })

  export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "ToolPart",
  })
  export type ToolPart = z.infer<typeof ToolPart>

  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  })

  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    format: Format.optional(),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        diffs: Snapshot.FileDiff.array(),
      })
      .optional(),
    agent: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    system: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    variant: z.string().optional(),
  }).meta({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      SubtaskPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
      CompactionPart,
    ])
    .meta({
      ref: "Part",
    })
  export type Part = z.infer<typeof Part>

  export const Assistant = Base.extend({
    role: z.literal("assistant"),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion("name", [
        AuthError.Schema,
        z
          .object({
            name: z.literal("UnknownError"),
            data: z.object({ message: z.string() }),
          })
          .meta({ ref: "UnknownError" }),
        z
          .object({
            name: z.literal("MessageOutputLengthError"),
            data: z.object({}),
          })
          .meta({ ref: "MessageOutputLengthError" }),
        z
          .object({
            name: z.literal("MessageContextOverflowError"),
            data: z.object({
              message: z.string(),
              responseBody: z.string().optional(),
            }),
          })
          .meta({ ref: "MessageContextOverflowError" }),
        AbortedError.Schema,
        StructuredOutputError.Schema,
        APIError.Schema,
      ])
      .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    /**
     * @deprecated
     */
    mode: z.string(),
    agent: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: z.object({
      total: z.number().optional(),
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    structured: z.any().optional(),
    finish: z.string().optional(),
  }).meta({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
    ref: "Message",
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "message.updated",
      z.object({
        info: Info,
      }),
    ),
    Removed: BusEvent.define(
      "message.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
      }),
    ),
    PartUpdated: BusEvent.define(
      "message.part.updated",
      z.object({
        part: Part,
        delta: z.string().optional(),
      }),
    ),
    PartRemoved: BusEvent.define(
      "message.part.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
      }),
    ),
  }

  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  })
  export type WithParts = z.infer<typeof WithParts>

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
