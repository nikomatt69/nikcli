import z from "zod"
import { Identifier } from "@/id/id"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import type { SessionEvent } from "./event"
import { SessionV2EventRepo } from "./event-repo"
import { SessionEntryRepo } from "./entry-repo"
import { SessionEntryProjection } from "./projection"
import { Database } from "@/database/database"
import { SessionProjector } from "./projector"
import { SessionPrompt } from "../prompt"
import { Stepper } from "./stepper"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

/**
 * STATUS: v2 read model, live — write path still delegates to v1.
 *
 * SessionV2 is the entry/event/stepper redesign explored in
 * specs/v2/message-shape.md, migrated by strangler:
 *
 * - reads (`entries`, `state`, `pending`) are first-class: storage is
 *   authoritative for completed messages (converted losslessly via
 *   `toEntries`), and `SessionProjector` translates the v1 engine's live
 *   bus events into `SessionEvent`s reduced through `Stepper.stepWith` —
 *   the in-flight tail is already native v2 state, see projector.ts
 * - writes (`create`, `prompt`) delegate to the v1 Session/SessionPrompt
 *   services, so behavior (retry, abort, tool state machine, snapshots,
 *   permissions) is exactly the production engine's
 *
 * Consumers can adopt the v2 API today without behavior change; swapping
 * the engine underneath is a later, isolated step.
 */
export namespace SessionV2 {
  const log = Log.create({ service: "session-v2" })

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }

  function runPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
    return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
  }

  export const Event = SessionProjector.Event

  // ============================================================================
  // Types
  // ============================================================================

  /**
   * Input for creating a new v2 session
   */
  export const CreateInput = z.object({
    sessionID: Identifier.schema("session").optional(),
    parentID: Identifier.schema("session").optional(),
    title: z.string().optional(),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * Input for prompting a v2 session
   */
  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    text: z.string(),
    files: MessageV2.FilePart.array().optional(),
    agents: MessageV2.AgentPart.array().optional(),
    agent: z.string().optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  // ============================================================================
  // Public API
  // ============================================================================

  /** Activate the live projection for the current instance (idempotent). */
  export function init(): void {
    SessionProjector.init()
  }

  /**
   * Create a new v2 session.
   * Delegates to the v1 Session service for storage.
   */
  export async function create(input: CreateInput = {}): Promise<Session.Info> {
    const info = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.createNext({
          id: input.sessionID,
          parentID: input.parentID,
          directory: "",
          title: input.title,
        })
      }),
    )

    log.info("created", { sessionID: info.id })

    return info
  }

  /**
   * Get session info by ID
   */
  export async function fromID(sessionID: string): Promise<Session.Info | undefined> {
    try {
      return await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          return yield* session.get(sessionID)
        }),
      )
    } catch {
      return undefined
    }
  }

  /**
   * Get v2 entries for a session.
   *
   * `session_entry` is authoritative: the projectors write it in the same
   * transaction as the v1 row it derives from, so it covers committed and
   * in-flight work alike and cannot have drifted. A session written before
   * the table existed has no rows, so the first read backfills it from v1
   * messages — a one-time cost per legacy session.
   *
   * The live projector tail is *not* appended here: it would duplicate rows
   * the projection already holds. Consumers that want the sub-flush-interval
   * tail read `state()` / `pending()`.
   */
  export async function entries(sessionID: string): Promise<SessionEntry.Entry[]> {
    const rows = SessionEntryRepo.list(sessionID)
    if (rows.length > 0) return rows

    const messages = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID })
      }),
    )
    if (messages.length === 0) return []

    try {
      Database.transaction((tx) => {
        SessionEntryProjection.backfill(tx, sessionID, messages)
      })
      return SessionEntryRepo.list(sessionID)
    } catch (error) {
      // A backfill failure must not make history unreadable: fall back to
      // converting in memory, and let the next read try again.
      log.warn("failed to backfill session entries", { sessionID, error })
      return toEntries(messages, sessionID)
    }
  }

  /** Number of persisted entries for a session, without materializing them. */
  export function entryCount(sessionID: string): number {
    return SessionEntryRepo.count(sessionID)
  }

  /** Force a rebuild of a session's entry projection from its v1 messages. */
  export async function reproject(sessionID: string): Promise<SessionEntry.Entry[]> {
    const messages = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID })
      }),
    )
    Database.transaction((tx) => {
      SessionEntryProjection.backfill(tx, sessionID, messages)
    })
    return SessionEntryRepo.list(sessionID)
  }

  /**
   * Prompt a v2 session.
   * Delegates to the v1 prompt engine — retries, aborts, tool execution,
   * permissions and snapshots behave exactly like a v1 prompt.
   */
  export async function prompt(input: PromptInput) {
    const parsed = PromptInput.parse(input)
    log.info("prompting", { sessionID: parsed.sessionID })
    return runPrompt(
      Effect.gen(function* () {
        const sessionPrompt = yield* SessionPrompt.Service
        return yield* sessionPrompt.prompt({
          sessionID: parsed.sessionID,
          model: parsed.model,
          agent: parsed.agent,
          parts: [
            { type: "text" as const, text: parsed.text },
            ...(parsed.files ?? []).map(({ messageID: _messageID, sessionID: _sessionID, ...file }) => file),
            ...(parsed.agents ?? []).map(({ messageID: _messageID, sessionID: _sessionID, ...agent }) => agent),
          ],
        })
      }),
    )
  }

  /**
   * Live state for a session: committed entries are not duplicated here —
   * `pending` is the Stepper reduction of the in-flight assistant work.
   */
  export function state(sessionID: string): Stepper.MemoryState {
    return SessionProjector.snapshot(sessionID)
  }

  /**
   * Get pending (in-flight, not yet persisted as completed) entries
   */
  export function pending(sessionID: string): SessionEntry.Entry[] {
    return state(sessionID).pending
  }

  /**
   * Clear live projection state for a session
   */
  export function clear(sessionID: string): void {
    SessionProjector.clear(sessionID)
  }

  /**
   * Persisted v2 event log for a session, in replay order.
   */
  export function events(sessionID: string): SessionEvent.Event[] {
    return SessionV2EventRepo.list(sessionID)
  }

  /**
   * Rebuild the Stepper reduction of a session from the persisted event
   * log. Completed steps land in `entries`; a step without a sealing
   * `step.ended` (crash, still in flight) stays in `pending`.
   */
  export function replay(sessionID: string): Stepper.MemoryState {
    return SessionV2EventRepo.replay(sessionID)
  }

  // ============================================================================
  // v1 → v2 conversion
  // ============================================================================

  /**
   * Convert v1 messages to v2 entries
   */
  export function toEntries(messages: MessageV2.WithParts[], sessionID: string): SessionEntry.Entry[] {
    const entries: SessionEntry.Entry[] = []

    for (const msg of messages) {
      entries.push(...convertMessage(msg, sessionID))
    }

    return entries
  }

  /**
   * Convert a v1 message to flat v2 entries — lossless for everything the v2
   * shape models: an assistant step becomes a `start` entry, one entry per
   * part (text, reasoning, tool with its full state, subtask, retry,
   * compaction) and a sealing `complete` entry carrying cost, tokens, finish
   * reason and any terminal message error.
   */
  function convertMessage(msg: MessageV2.WithParts, sessionID: string): SessionEntry.Entry[] {
    const entries: SessionEntry.Entry[] = []
    const timestamp = msg.info.time?.created ?? Date.now()
    const messageID = msg.info.id

    if (msg.info.role === "user") {
      const textParts = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as MessageV2.TextPart).text)
        .join("\n")

      const files = msg.parts.filter((p) => p.type === "file") as MessageV2.FilePart[]
      const agents = msg.parts.filter((p) => p.type === "agent") as MessageV2.AgentPart[]

      entries.push(
        SessionEntry.User.parse({
          id: Identifier.ascending("event"),
          sessionID,
          messageID,
          timestamp,
          type: "user",
          text: textParts,
          files,
          agents,
        }),
      )

      // A user message can still carry non-prompt parts (a compaction marker,
      // a delegated subtask) — those are entries in their own right.
      for (const part of msg.parts) {
        if (part.type === "text" || part.type === "file" || part.type === "agent") continue
        const converted = SessionEntry.fromV1Part(part, { sessionID, messageID })
        if (converted) entries.push(converted)
      }

      return entries
    }

    if (msg.info.role === "assistant") {
      entries.push(
        SessionEntry.Request.parse({
          id: Identifier.ascending("event"),
          sessionID,
          messageID,
          timestamp,
          type: "start",
          providerID: msg.info.providerID,
          modelID: msg.info.modelID,
          agent: msg.info.agent,
        }),
      )

      for (const part of msg.parts) {
        const converted = SessionEntry.fromV1Part(part, { sessionID, messageID })
        if (converted) entries.push(converted)
      }

      const completed = msg.info.time?.completed
      if (completed !== undefined || msg.info.error) {
        entries.push(
          SessionEntry.Complete.parse({
            id: Identifier.ascending("event"),
            sessionID,
            messageID,
            timestamp: completed ?? timestamp,
            type: "complete",
            reason: msg.info.error ? "error" : "completed",
            cost: msg.info.cost,
            tokens: msg.info.tokens,
            finish: msg.info.finish,
            error: msg.info.error,
          }),
        )
      }

      if (msg.info.summary) {
        entries.push(
          SessionEntry.Compaction.parse({
            id: Identifier.ascending("event"),
            sessionID,
            messageID,
            timestamp: completed ?? timestamp,
            type: "compaction",
            auto: true,
          }),
        )
      }
    }

    return entries
  }
}
