import z from "zod"
import { Identifier } from "@nikcli-ai/util/id"
import { Session } from "../index"
import { MessageRepo } from "../message-repo"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import { SessionEntryRepo } from "./entry-repo"
import { SyncEvent } from "@/sync/sync-event"
import { SessionEntryProjection } from "./projection"
import { SessionV2Write } from "./write"
import { Database } from "@/database/database"
import { SessionProjector } from "./projector"
import { SessionPrompt } from "../prompt"
import { Stepper } from "./stepper"
import { Log } from "@nikcli-ai/util/log"
import { Effect } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer } from "@/effect"
import { zodObject } from "@nikcli-ai/util/effect-zod"

/**
 * STATUS: v2 read model live; write path slices 1–3 + S4r — entries persist
 * first, v1 is derived from them, HTTP create/prompt and import/teleport/run
 * share this write API.
 *
 * SessionV2 is the entry/event/stepper redesign, migrated by strangler:
 *
 * - reads (`entries`, `state`, `pending`) are first-class
 * - message/part projectors write `session_entry` from the event payload
 *   before the v1 row; v1 is `toV1*` of those entries
 * - `create` / `prompt` / `admit` / `loop` are the public write API HTTP uses
 * - `SessionPrompt.loop` still runs the step engine
 *
 * See specs/v2/session-v2-write-path.md.
 */
export namespace SessionV2 {
  const log = Log.create({ service: "session-v2" })

  // These are the module's promise-side entry points; nothing upstream of them
  // carries an `InstanceContext`, so the ambient scope is read here and bound
  // explicitly for the run rather than re-derived inside the fiber.
  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, locallyInstance(InstanceState.ambient(), effect))
  }

  function runPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
    return runPromiseWithLayer(SessionPrompt.defaultLayer, locallyInstance(InstanceState.ambient(), effect))
  }

  export const Event = SessionProjector.Event

  // ============================================================================
  // Types
  // ============================================================================

  /**
   * Input for creating a new v2 session. Same fields HTTP `session.create`
   * accepts, plus an optional `sessionID` for callers that mint the id.
   */
  export const CreateInput = z.object({
    sessionID: Identifier.schema("session").optional(),
    parentID: Identifier.schema("session").optional(),
    title: z.string().optional(),
    permission: Session.Info.shape.permission,
    skills: z.array(z.string()).optional(),
    disabledInstructions: z.array(z.string()).optional(),
    disabledTools: z.record(z.string(), z.boolean()).optional(),
    workspaceID: Session.Info.shape.workspaceID,
    github: zodObject(Session.GithubInfoSchema).optional(),
    worktree: zodObject(Session.WorktreeInfoSchema).optional(),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * Input for prompting a v2 session. This is the HTTP prompt body (parts,
   * delivery, noReply, …). `{ text, files, agents }` is still accepted and
   * folded into `parts`.
   */
  export const PromptInput = SessionPrompt.PromptInput
  export type PromptInput = SessionPrompt.PromptInput

  const LegacyPromptInput = z.object({
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
    noReply: z.boolean().optional(),
  })
  export type LegacyPromptInput = z.infer<typeof LegacyPromptInput>

  export type PromptRequest = PromptInput | LegacyPromptInput

  function normalizePrompt(input: PromptRequest): PromptInput {
    if ("parts" in input && Array.isArray(input.parts)) return PromptInput.parse(input)
    const legacy = LegacyPromptInput.parse(input)
    return PromptInput.parse({
      sessionID: legacy.sessionID,
      agent: legacy.agent,
      model: legacy.model,
      noReply: legacy.noReply,
      parts: [
        { type: "text" as const, text: legacy.text },
        ...(legacy.files ?? []).map(({ messageID: _messageID, sessionID: _sessionID, ...file }) => file),
        ...(legacy.agents ?? []).map(({ messageID: _messageID, sessionID: _sessionID, ...agent }) => agent),
      ],
    })
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /** Activate the live projection for the current instance (idempotent). */
  export function init(): void {
    SessionProjector.init()
  }

  /**
   * Persist a prepared user message through the entry write.
   *
   * Safe to call inside an outer `Database.transaction` — `SyncEvent.run`
   * joins it, so pending promotion still batches into one transaction.
   */
  export const persist = SessionV2Write.persist

  /**
   * Create a new session. Uses the current instance directory (HTTP create
   * used to call `Session.create` for that; this is that call).
   */
  export function createEffect(input: CreateInput = {}) {
    return Effect.gen(function* () {
      const session = yield* Session.Service
      const ctx = yield* InstanceState.context
      return yield* session.createNext({
        id: input.sessionID,
        parentID: input.parentID,
        directory: ctx.directory,
        title: input.title,
        permission: input.permission,
        skills: input.skills,
        disabledInstructions: input.disabledInstructions,
        disabledTools: input.disabledTools,
        workspaceID: input.workspaceID,
        github: input.github,
        worktree: input.worktree,
      })
    })
  }

  export async function create(input: CreateInput = {}): Promise<Session.Info> {
    const info = await runSession(createEffect(CreateInput.parse(input)))
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
   * in-flight work alike and cannot have drifted.
   *
   * What it can be is *incomplete*. Sessions written before the table existed
   * arrive with v1 rows the projectors never saw. Import, teleport, and
   * `run --session` now persist through `SessionV2Write.persist`, so they
   * are not that case. The guard is still coverage, not emptiness: if the
   * entries do not account for every message, rebuild them. Checking "are
   * there any rows" instead would hand a half-drawn transcript to the
   * renderer, which is worse than the blank one it was meant to prevent.
   *
   * Both counts are indexed scans of one column, and this runs when a session
   * is opened, not per frame.
   *
   * The live projector tail is *not* appended here: it would duplicate rows
   * the projection already holds. Consumers that want the sub-flush-interval
   * tail read `state()` / `pending()`.
   */
  export async function entries(sessionID: string): Promise<SessionEntry.Entry[]> {
    const rows = SessionEntryRepo.list(sessionID)
    if (SessionEntryRepo.messageCount(sessionID) >= MessageRepo.countMessages(sessionID)) return rows

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
   * Prompt a session. `SessionPrompt.loop` still runs the step engine;
   * persistence goes through `persist` (entry-first).
   */
  export function promptEffect(input: PromptRequest) {
    const parsed = normalizePrompt(input)
    return Effect.gen(function* () {
      const sessionPrompt = yield* SessionPrompt.Service
      return yield* sessionPrompt.prompt(parsed)
    })
  }

  export async function prompt(input: PromptRequest) {
    const parsed = normalizePrompt(input)
    log.info("prompting", { sessionID: parsed.sessionID })
    return runPrompt(promptEffect(parsed))
  }

  /** Admit without starting the model loop — `prompt_async` waits on this. */
  export function admitEffect(input: PromptRequest) {
    const parsed = normalizePrompt(input)
    return Effect.gen(function* () {
      const sessionPrompt = yield* SessionPrompt.Service
      return yield* sessionPrompt.admit(parsed)
    })
  }

  export async function admit(input: PromptRequest) {
    return runPrompt(admitEffect(input))
  }

  /** Run the model loop. Used by `prompt_async` after admission. */
  export function loopEffect(
    sessionID: string,
    options?: {
      controller?: AbortController
      messageID?: string
      waitFor?: "reply" | "promotion"
    },
  ) {
    return Effect.gen(function* () {
      const sessionPrompt = yield* SessionPrompt.Service
      return yield* sessionPrompt.loop(sessionID, options)
    })
  }

  export async function loop(
    sessionID: string,
    options?: {
      controller?: AbortController
      messageID?: string
      waitFor?: "reply" | "promotion"
    },
  ) {
    return runPrompt(loopEffect(sessionID, options))
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
   * The durable event log for a session, in sequence order.
   *
   * This is `sync_event` — the one log the write path appends to
   * (sync/sync-event.ts), not a second v2-specific one. `session_v2_event`
   * used to hold a parallel stream translated off the bus; entries are
   * persisted transactionally now, so it was a second answer to a question
   * that already had one, and it is gone.
   *
   * Token-level part updates are deliberately absent: they are defined
   * `log: false` because logging them would be one row per token. The state
   * they would reconstruct is `entries()`.
   */
  export function events(sessionID: string): SyncEvent.HistoryEntry[] {
    return SyncEvent.history(sessionID)
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
   * compaction, snapshot, patch, step-start, step-finish) and a sealing
   * `complete` entry carrying cost, tokens, finish reason and any terminal
   * message error.
   */
  function convertMessage(msg: MessageV2.WithParts, sessionID: string): SessionEntry.Entry[] {
    const messageID = msg.info.id

    if (msg.info.role === "user") {
      const entries: SessionEntry.Entry[] = [SessionEntry.fromV1User(msg.info, msg.parts)]
      for (const part of msg.parts) {
        if (SessionEntry.foldsIntoUser(part)) continue
        const converted = SessionEntry.fromV1Part(part, {
          sessionID,
          messageID,
        })
        if (converted) entries.push(converted)
      }
      return entries
    }

    const framing = SessionEntry.fromV1Assistant(msg.info)
    const start = framing.filter((entry) => entry.type === "start")
    const rest = framing.filter((entry) => entry.type !== "start")
    const parts: SessionEntry.Entry[] = []
    for (const part of msg.parts) {
      const converted = SessionEntry.fromV1Part(part, { sessionID, messageID })
      if (converted) parts.push(converted)
    }
    return [...start, ...parts, ...rest]
  }
}
