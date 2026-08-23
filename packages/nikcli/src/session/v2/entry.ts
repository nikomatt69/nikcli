import z from "zod"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Identifier } from "@nikcli-ai/util/id"
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
 *
 * Slice 2 of the write path keeps every field `toModelMessages` and revert
 * need on an entry, so the v1 projector can be `toV1*` of the rows just
 * written. `prompt_data` stays on `message_info` — it is admission identity
 * (S1), not conversation content.
 */
export namespace SessionEntry {
  export const ID = Identifier.schema("event")
  export type ID = z.infer<typeof ID>

  const EMPTY_PATH = { cwd: "", root: "" }
  const EMPTY_TOKENS: MessageV2.Assistant["tokens"] = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
  const EMPTY_MODEL = { providerID: "", modelID: "" }

  // Reused v1 message field schemas, converted from MessageV2's own Effect
  // structs with the same walker `zodObject` applies per field, so embedded
  // entry fields stay compatible with the messages they project.
  const assistantTokens = zod(MessageV2.AssistantSchema.fields.tokens)
  const assistantStructured = zod(MessageV2.AssistantSchema.fields.structured).optional()
  const userAgent = zod(MessageV2.UserSchema.fields.agent)
  const userModel = zod(MessageV2.UserSchema.fields.model)
  const userSystem = zod(MessageV2.UserSchema.fields.system).optional()
  const userFormat = zod(MessageV2.UserSchema.fields.format).optional()
  const userTools = zod(MessageV2.UserSchema.fields.tools).optional()
  const userVariant = zod(MessageV2.UserSchema.fields.variant).optional()
  const userSummary = zod(MessageV2.UserSchema.fields.summary).optional()

  // ============================================================================
  // Derived identity
  // ============================================================================

  /** Message-level entries: the kinds that frame a turn rather than stream. */
  export type MessageKind = "user" | "start" | "complete" | "compaction"

  /**
   * Rank within a message. `start` (and a user message's single entry) comes
   * first, then the parts, then the sealing `complete`, then any trailer.
   * One digit, so it compares lexicographically.
   */
  const RANK = {
    user: 0,
    start: 0,
    part: 1,
    complete: 2,
    compaction: 3,
  } satisfies Record<MessageKind | "part", number>

  function body(id: string) {
    const underscore = id.indexOf("_")
    return underscore < 0 ? id : id.slice(underscore + 1)
  }

  /**
   * Entry ids are **derived, and they are also the sort key**.
   *
   * Derived — rather than generated — is what lets the live projection and
   * the persisted one agree without coordinating: both compute the same id
   * from the same v1 row, so a client applying a live `session.entry.updated`
   * and a client re-reading `/v2/entries` converge on the same entries. It
   * also means an id never churns across a stream of deltas, which would
   * remount the entry in every consumer on every token.
   *
   * Also the sort key — `<messageBody>_<rank>[_<partBody>]` — because
   * otherwise the server would order by one convention and clients by
   * another, and the two would drift. Identifier bodies are fixed-length and
   * ascending, so lexicographic order is conversation order: every entry of
   * an earlier message sorts before every entry of a later one, and within a
   * message `start` precedes the parts precedes `complete`.
   *
   * opencode's commented-out projector sketches the deriving half as
   * `data.part.id.replace("prt", "ent")`.
   */
  export function idForPart(messageID: string, partID: string): string {
    return `evt_${body(messageID)}_${RANK.part}_${body(partID)}`
  }

  /** The entry id for a message-level entry. */
  export function idForMessage(messageID: string, kind: MessageKind): string {
    return `evt_${body(messageID)}_${RANK[kind]}`
  }

  /** The stable identity of a message-level entry within its session. */
  export function refForMessage(messageID: string, kind: MessageKind): string {
    return `${messageID}#${kind}`
  }

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

  /**
   * The user's prompt. `text` is the display join of what they typed;
   * `texts` keeps the individual text parts (including synthetic / ignored)
   * so v1 can be derived without collapsing ids. File and agent parts ride
   * here as full v1 objects. Compaction, subtask, snapshot, patch, and
   * step markers on a user message are streamed entries of their own.
   */
  export const User = z
    .object({
      ...Base,
      type: z.literal("user"),
      text: z.string(),
      files: MessageV2.FilePart.array().default([]),
      agents: MessageV2.AgentPart.array().default([]),
      texts: MessageV2.TextPart.array().default([]),
      agent: userAgent.default(""),
      model: userModel.default(EMPTY_MODEL),
      system: userSystem,
      format: userFormat,
      tools: userTools,
      variant: userVariant,
      summary: userSummary,
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
   *
   * Cost, tokens, finish, error and structured also live here so an
   * in-flight `message.updated` (finish-step writes those before
   * `time.completed`) can still derive the v1 row. The sealing `complete`
   * entry is authoritative once it exists.
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
      /** The agent mode the turn ran in — rendered as the step's label. */
      mode: z.string().default(""),
      parentID: z.string().default(""),
      path: z
        .object({
          cwd: z.string(),
          root: z.string(),
        })
        .default(EMPTY_PATH),
      variant: z.string().optional(),
      snapshot: z.string().optional(),
      cost: z.number().optional(),
      tokens: assistantTokens.optional(),
      finish: z.string().optional(),
      error: MessageV2.AssistantError.optional(),
      structured: assistantStructured,
    })
    .meta({ ref: "SessionEntry.Request" })
  export type Request = z.infer<typeof Request>

  /**
   * End of an assistant step — cost, tokens and finish reason. Terminal
   * message errors (abort, auth, overflow) ride on `error` so the conversion
   * from a v1 message stays lossless. `completed` is `info.time.completed`
   * when the engine set it; `timestamp` is the seal time used for sorting.
   */
  export const Complete = z
    .object({
      ...Base,
      type: z.literal("complete"),
      reason: z.string(),
      cost: z.number().default(0),
      tokens: assistantTokens,
      finish: z.string().optional(),
      error: MessageV2.AssistantError.optional(),
      completed: z.number().optional(),
      structured: assistantStructured,
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
      metadata: z.record(z.string(), z.unknown()).optional(),
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
      metadata: z.record(z.string(), z.unknown()).optional(),
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

  /** A workspace snapshot hash. Revert and summary read these off v1 parts. */
  export const Snapshot = z
    .object({
      ...Base,
      type: z.literal("snapshot"),
      snapshot: z.string(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Snapshot" })
  export type Snapshot = z.infer<typeof Snapshot>

  /** Files changed during a step. Revert walks these after the revert point. */
  export const Patch = z
    .object({
      ...Base,
      type: z.literal("patch"),
      hash: z.string(),
      files: z.array(z.string()),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.Patch" })
  export type Patch = z.infer<typeof Patch>

  /**
   * Step-start part. Overlaps the message-level `start` entry but is not the
   * same row: the part carries a snapshot hash `start` does not, and
   * `toModelMessages` emits it as its own UI part.
   */
  export const StepStart = z
    .object({
      ...Base,
      type: z.literal("step-start"),
      snapshot: z.string().optional(),
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.StepStart" })
  export type StepStart = z.infer<typeof StepStart>

  /** Step-finish part. Same overlap with `complete` as step-start with `start`. */
  export const StepFinish = z
    .object({
      ...Base,
      type: z.literal("step-finish"),
      reason: z.string(),
      snapshot: z.string().optional(),
      cost: z.number(),
      tokens: assistantTokens,
      ref: Ref,
    })
    .meta({ ref: "SessionEntry.StepFinish" })
  export type StepFinish = z.infer<typeof StepFinish>

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
      Snapshot,
      Patch,
      StepStart,
      StepFinish,
      Complete,
      Retry,
      Compaction,
    ])
    .meta({ ref: "SessionEntry" })
  export type Entry = z.infer<typeof Entry>

  /** Entry kinds that carry a `ref` and are therefore upsert targets. */
  export type Streamed =
    | Text
    | Reasoning
    | Tool
    | Subtask
    | Retry
    | Compaction
    | Synthetic
    | Snapshot
    | Patch
    | StepStart
    | StepFinish

  const STREAMED = new Set([
    "text",
    "reasoning",
    "tool",
    "subtask",
    "retry",
    "compaction",
    "synthetic",
    "snapshot",
    "patch",
    "step-start",
    "step-finish",
  ])

  export function isStreamed(entry: Entry): entry is Streamed {
    return STREAMED.has(entry.type)
  }

  /** The originating v1 part id, when the entry came from one. */
  export function refOf(entry: Entry): string | undefined {
    return isStreamed(entry) ? entry.ref : undefined
  }

  const ASSISTANT = new Set([
    "start",
    "text",
    "reasoning",
    "tool",
    "subtask",
    "complete",
    "retry",
    "snapshot",
    "patch",
    "step-start",
    "step-finish",
  ])

  /** True for entries produced by an assistant step (as opposed to input). */
  export function isAssistant(entry: Entry): boolean {
    return ASSISTANT.has(entry.type)
  }

  /**
   * User-typed text, files and agents fold into the single `user` entry.
   * Everything else on a user message (compaction, subtask, snapshot, patch,
   * step markers) is a streamed entry of its own.
   */
  export function foldsIntoUser(part: MessageV2.Part): boolean {
    return part.type === "text" || part.type === "file" || part.type === "agent"
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
   * When a part was created, without reading the clock.
   *
   * The live and persisted projections convert the same part independently,
   * so a `Date.now()` fallback made them disagree by a millisecond — a client
   * that seeded from `/v2/entries` and then applied a live update would see
   * the timestamp jump. Identifier ids encode their creation time, so the
   * part itself is the deterministic source.
   */
  function createdAt(part: MessageV2.Part): number {
    try {
      return Identifier.timestamp(part.id)
    } catch {
      return 0
    }
  }

  /**
   * Convert a single v1 message part to its v2 entry. Returns undefined for
   * file/agent parts — those ride on the User entry, not as rows of their own.
   *
   * Deterministic: the same part always converts to the same entry, which is
   * what lets the live and persisted projections agree without coordinating.
   */
  export function fromV1Part(part: MessageV2.Part, ctx: FromV1Context): Entry | undefined {
    const base = {
      // Derived, not generated: the live and persisted projections have to
      // land on the same id without coordinating. See `idForPart`.
      id: ctx.id ?? idForPart(ctx.messageID ?? part.messageID, part.id),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID ?? part.messageID,
      ref: part.id,
    }

    switch (part.type) {
      case "text":
        return Text.parse({
          ...base,
          timestamp: ctx.timestamp ?? part.time?.start ?? createdAt(part),
          type: "text",
          text: part.text,
          ignored: part.ignored,
          synthetic: part.synthetic,
          completed: part.time?.end,
          metadata: part.metadata,
        })
      case "reasoning":
        return Reasoning.parse({
          ...base,
          timestamp: ctx.timestamp ?? part.time?.start ?? createdAt(part),
          type: "reasoning",
          text: part.text,
          completed: part.time?.end,
          metadata: part.metadata,
        })
      case "tool":
        return Tool.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "tool",
          callID: part.callID,
          name: part.tool,
          state: part.state,
          metadata: part.metadata,
        })
      case "subtask":
        return Subtask.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
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
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "compaction",
          auto: part.auto,
        })
      case "snapshot":
        return Snapshot.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "snapshot",
          snapshot: part.snapshot,
        })
      case "patch":
        return Patch.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "patch",
          hash: part.hash,
          files: part.files,
        })
      case "step-start":
        return StepStart.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "step-start",
          snapshot: part.snapshot,
        })
      case "step-finish":
        return StepFinish.parse({
          ...base,
          timestamp: ctx.timestamp ?? createdAt(part),
          type: "step-finish",
          reason: part.reason,
          snapshot: part.snapshot,
          cost: part.cost,
          tokens: part.tokens,
        })
      default:
        return undefined
    }
  }

  /**
   * Reverse of `fromV1Part` for streamed types. Message-level entries
   * (`user`, `start`, `complete`) are not parts.
   *
   * `v1 → entry → v1` may fill `time.start` from the entry timestamp when the
   * original part omitted it. `entry → v1 → entry` is identity for the
   * modeled subset.
   */
  export function toV1Part(entry: Entry): MessageV2.Part | undefined {
    const messageID = entry.messageID
    const id = refOf(entry)
    if (!messageID || !id) return

    switch (entry.type) {
      case "text":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "text",
          text: entry.text,
          ignored: entry.ignored,
          synthetic: entry.synthetic,
          metadata: entry.metadata,
          time: { start: entry.timestamp, end: entry.completed },
        }
      case "reasoning":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "reasoning",
          text: entry.text,
          metadata: entry.metadata,
          time: { start: entry.timestamp, end: entry.completed },
        }
      case "tool":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "tool",
          callID: entry.callID,
          tool: entry.name,
          state: entry.state,
          metadata: entry.metadata,
        }
      case "subtask":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "subtask",
          prompt: entry.prompt,
          description: entry.description,
          agent: entry.agent,
          model: entry.model,
          command: entry.command,
          background: entry.background,
        }
      case "retry":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "retry",
          attempt: entry.attempt,
          error: entry.error,
          time: { created: entry.timestamp },
        }
      case "compaction":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "compaction",
          auto: entry.auto,
        }
      case "snapshot":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "snapshot",
          snapshot: entry.snapshot,
        }
      case "patch":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "patch",
          hash: entry.hash,
          files: [...entry.files],
        }
      case "step-start":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "step-start",
          snapshot: entry.snapshot,
        }
      case "step-finish":
        return {
          id,
          sessionID: entry.sessionID,
          messageID,
          type: "step-finish",
          reason: entry.reason,
          snapshot: entry.snapshot,
          cost: entry.cost,
          tokens: entry.tokens,
        }
      default:
        return undefined
    }
  }

  /**
   * Build the `user` entry from a v1 user message and the parts that fold
   * into it. Non-folding parts are converted separately via `fromV1Part`.
   */
  export function fromV1User(info: MessageV2.User, parts: readonly MessageV2.Part[]): User {
    const texts = parts.filter((part): part is MessageV2.TextPart => part.type === "text")
    return User.parse({
      id: idForMessage(info.id, "user"),
      sessionID: info.sessionID,
      messageID: info.id,
      timestamp: info.time.created,
      type: "user",
      text: texts
        .filter((part) => !part.synthetic && !part.ignored)
        .map((part) => part.text)
        .join("\n"),
      texts,
      files: parts.filter((part): part is MessageV2.FilePart => part.type === "file"),
      agents: parts.filter((part): part is MessageV2.AgentPart => part.type === "agent"),
      agent: info.agent,
      model: info.model,
      system: info.system,
      format: info.format,
      tools: info.tools,
      variant: info.variant,
      summary: info.summary,
    })
  }

  /**
   * Message-level entries for an assistant step: `start`, and `complete` /
   * `compaction` when the v1 row has them. Parts are converted separately.
   */
  export function fromV1Assistant(info: MessageV2.Assistant): Array<Request | Complete | Compaction> {
    const start = Request.parse({
      id: idForMessage(info.id, "start"),
      sessionID: info.sessionID,
      messageID: info.id,
      timestamp: info.time.created,
      type: "start",
      providerID: info.providerID,
      modelID: info.modelID,
      agent: info.agent,
      mode: info.mode,
      parentID: info.parentID,
      path: info.path,
      cost: info.cost,
      tokens: info.tokens,
      finish: info.finish,
      error: info.error,
      structured: info.structured,
    })
    const entries: Array<Request | Complete | Compaction> = [start]

    const completed = info.time.completed
    if (completed !== undefined || info.error) {
      entries.push(
        Complete.parse({
          id: idForMessage(info.id, "complete"),
          sessionID: info.sessionID,
          messageID: info.id,
          timestamp: completed ?? info.time.created,
          type: "complete",
          reason: info.error ? "error" : "completed",
          cost: info.cost,
          tokens: info.tokens,
          finish: info.finish,
          error: info.error,
          completed,
          structured: info.structured,
        }),
      )
    }

    if (info.summary) {
      entries.push(
        Compaction.parse({
          id: idForMessage(info.id, "compaction"),
          sessionID: info.sessionID,
          messageID: info.id,
          timestamp: completed ?? info.time.created,
          type: "compaction",
          auto: true,
        }),
      )
    }

    return entries
  }

  /** Framing entries for a v1 message. User parts must be passed to `fromV1User`. */
  export function fromV1Message(info: MessageV2.Info): Entry[] {
    if (info.role === "user") return [fromV1User(info, [])]
    return fromV1Assistant(info)
  }

  /** Text, file and agent parts stored on the user entry. */
  export function partsFromUser(entry: User): MessageV2.Part[] {
    return [...entry.texts, ...entry.files, ...entry.agents]
  }

  export function toV1User(entry: User): MessageV2.User | undefined {
    if (!entry.messageID) return
    return {
      id: entry.messageID,
      sessionID: entry.sessionID,
      role: "user",
      time: { created: entry.timestamp },
      agent: entry.agent,
      model: entry.model,
      system: entry.system,
      format: entry.format,
      tools: entry.tools,
      variant: entry.variant,
      summary: entry.summary,
    }
  }

  export function toV1Assistant(
    start: Request,
    complete?: Complete,
    summary?: boolean,
  ): MessageV2.Assistant | undefined {
    if (!start.messageID) return
    const message: MessageV2.Assistant = {
      id: start.messageID,
      sessionID: start.sessionID,
      role: "assistant",
      time: { created: start.timestamp },
      parentID: start.parentID,
      modelID: start.modelID,
      providerID: start.providerID,
      mode: start.mode,
      agent: start.agent,
      path: start.path ?? EMPTY_PATH,
      cost: complete?.cost ?? start.cost ?? 0,
      tokens: complete?.tokens ?? start.tokens ?? EMPTY_TOKENS,
      finish: complete?.finish ?? start.finish,
      error: complete?.error ?? start.error,
      structured: complete?.structured ?? start.structured,
    }
    if (complete?.completed !== undefined) message.time.completed = complete.completed
    if (summary) message.summary = true
    return message
  }

  /**
   * Rebuild a v1 message from the framing entries just written (`user`, or
   * `start` plus optional `complete` / message-level `compaction`).
   */
  export function toV1Message(entries: readonly Entry[]): MessageV2.Info | undefined {
    const user = entries.find((entry): entry is User => entry.type === "user")
    if (user) return toV1User(user)

    const start = entries.find((entry): entry is Request => entry.type === "start")
    if (!start) return
    const complete = entries.find((entry): entry is Complete => entry.type === "complete")
    const compaction = entries.some(
      (entry) => entry.type === "compaction" && entry.id === idForMessage(start.messageID ?? "", "compaction"),
    )
    return toV1Assistant(start, complete, compaction)
  }

  /**
   * The v1 part this write should persist. Folded user parts are recovered
   * from the user entry; streamed parts go through `toV1Part`.
   */
  export function toV1WrittenPart(entry: Entry, incoming: MessageV2.Part): MessageV2.Part | undefined {
    if (entry.type === "user") {
      return partsFromUser(entry).find((part) => part.id === incoming.id)
    }
    return toV1Part(entry)
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /** Create an entry, filling in a generated id and timestamp. */
  export function create<T extends Entry>(input: Omit<T, "id" | "timestamp"> & { id?: string; timestamp?: number }): T {
    // SAFETY: Entry.parse validates the payload against the entry schema, so the parsed result conforms to T extends Entry
    return Entry.parse({
      ...input,
      id: input.id ?? Identifier.ascending("event"),
      timestamp: input.timestamp ?? Date.now(),
    }) as T
  }
}
