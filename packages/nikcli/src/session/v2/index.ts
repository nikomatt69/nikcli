import z from "zod"
import { Identifier } from "@/id/id"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
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
 *   `toEntries`), and `SessionProjector` overlays the in-flight assistant
 *   work streamed by the v1 engine — see projector.ts
 * - writes (`create`, `prompt`) delegate to the v1 Session/SessionPrompt
 *   services, so behavior (retry, abort, tool state machine, snapshots,
 *   permissions) is exactly the production engine's
 * - `Stepper` remains the reducer for the future native v2 engine
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
   * Storage (v1) is the authoritative source for committed messages; the
   * projector's in-flight assistant work is appended as the live tail.
   */
  export async function entries(sessionID: string): Promise<SessionEntry.Entry[]> {
    const messages = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID })
      }),
    )
    const committed = new Set(messages.map((message) => message.info.id))
    const live = SessionProjector.inflight(sessionID).filter((message) => !committed.has(message.info.id))
    return toEntries([...messages, ...live], sessionID)
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
   * `pending` reflects the projector's in-flight assistant messages.
   */
  export function state(sessionID: string): Stepper.MemoryState {
    return {
      entries: [],
      pending: toEntries(SessionProjector.inflight(sessionID), sessionID),
    }
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
   * Convert a v1 message to v2 entries — lossless for everything the v2
   * shape models: text/reasoning parts, every tool state (including
   * "error"), retry parts, finish reason and terminal message errors.
   */
  function convertMessage(msg: MessageV2.WithParts, sessionID: string): SessionEntry.Entry[] {
    const entries: SessionEntry.Entry[] = []
    const timestamp = msg.info.time?.created ?? Date.now()

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
          timestamp,
          role: "user",
          text: textParts,
          files,
          agents,
        }),
      )
    }

    if (msg.info.role === "assistant") {
      const assistantParts: SessionEntry.AssistantText["parts"] = []

      for (const part of msg.parts) {
        if (part.type === "retry") {
          entries.push(
            SessionEntry.AssistantRetry.parse({
              id: Identifier.ascending("event"),
              sessionID,
              timestamp: part.time.created,
              role: "assistant",
              sub: "retry",
              attempt: part.attempt,
              error: part.error,
            }),
          )
          continue
        }
        const converted = SessionEntry.fromV1Part(part)
        if (converted) assistantParts.push(converted)
      }

      if (assistantParts.length > 0 || msg.info.error) {
        entries.push(
          SessionEntry.AssistantText.parse({
            id: Identifier.ascending("event"),
            sessionID,
            timestamp,
            role: "assistant",
            sub: "text",
            modelID: msg.info.modelID,
            providerID: msg.info.providerID,
            agent: msg.info.agent,
            finish: msg.info.finish,
            parts: assistantParts,
            // Terminal message error (abort, auth, overflow, ...) — carried
            // as metadata so the projection stays lossless.
            metadata: msg.info.error ? { error: msg.info.error } : undefined,
          }),
        )
      }
    }

    return entries
  }
}
