import z from "zod"
import { Identifier } from "@/id/id"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import { Stepper } from "./stepper"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export namespace SessionV2 {
  const log = Log.create({ service: "session-v2" })

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }

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
    files: SessionEntry.User.shape.files.optional(),
    agents: SessionEntry.User.shape.agents.optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  // ============================================================================
  // State management
  // ============================================================================

  /**
   * Per-session v2 state
   */
  const sessions = new Map<string, Stepper.MemoryState>()

  /**
   * Get or create state for a session
   */
  function getState(sessionID: string): Stepper.MemoryState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = { entries: [], pending: [] }
      sessions.set(sessionID, state)
    }
    return state
  }

  /**
   * Clear state for a session
   */
  export function clear(sessionID: string): void {
    sessions.delete(sessionID)
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Create a new v2 session
   * Delegates to Session v1 for storage, manages v2 state separately
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

    // Initialize v2 state
    sessions.set(info.id, { entries: [], pending: [] })

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
   * Get v2 entries for a session
   * Reads messages from v1 storage and converts to entries
   */
  export async function entries(sessionID: string): Promise<SessionEntry.Entry[]> {
    // Check in-memory state first
    const state = getState(sessionID)
    if (state.entries.length > 0) {
      return state.entries
    }

    // Fall back to reading from v1 storage
    const messages = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID })
      }),
    )
    return toEntries(messages, sessionID)
  }

  /**
   * Prompt a v2 session with user input
   * Updates state and returns the new entries
   */
  export async function prompt(input: PromptInput): Promise<SessionEntry.Entry[]> {
    const sessionID = input.sessionID
    const state = getState(sessionID)

    // Create user entry
    const userEntry = SessionEntry.User.parse({
      id: Identifier.ascending("event"),
      sessionID,
      timestamp: Date.now(),
      role: "user",
      text: input.text,
      files: input.files ?? [],
      agents: input.agents ?? [],
    })

    // Update state
    const nextState = Stepper.reduce(state, { type: "append", entry: userEntry })
    sessions.set(sessionID, nextState)

    log.info("prompted", { sessionID, text: input.text.slice(0, 100) })

    return nextState.entries
  }

  /**
   * Get pending entries (not yet committed)
   */
  export function pending(sessionID: string): SessionEntry.Entry[] {
    const state = getState(sessionID)
    return state.pending
  }

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
   * Convert a v1 message to v2 entries
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
        if (part.type === "text") {
          assistantParts.push({
            type: "text" as const,
            text: (part as MessageV2.TextPart).text,
            ignored: (part as MessageV2.TextPart).ignored,
          })
        }
        if (part.type === "reasoning") {
          assistantParts.push({
            type: "reasoning" as const,
            text: (part as MessageV2.ReasoningPart).text,
          })
        }
        if (part.type === "tool") {
          const toolPart = part as MessageV2.ToolPart
          if (toolPart.state.status === "completed") {
            assistantParts.push({
              type: "tool-result" as const,
              toolCallId: toolPart.callID,
              toolName: toolPart.tool,
              result: toolPart.state.output,
            })
          } else if (toolPart.state.status === "pending" || toolPart.state.status === "running") {
            assistantParts.push({
              type: "tool-call" as const,
              toolCallId: toolPart.callID,
              toolName: toolPart.tool,
              args: toolPart.state.input,
            })
          }
        }
      }

      if (assistantParts.length > 0) {
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
          }),
        )
      }
    }

    return entries
  }

  /**
   * Stepper integration - reduce state with an action
   */
  export function step(sessionID: string, action: Stepper.Action): SessionEntry.Entry[] {
    const state = getState(sessionID)
    const nextState = Stepper.reduce(state, action)
    sessions.set(sessionID, nextState)
    return nextState.entries
  }

  /**
   * Get the current state for a session
   */
  export function state(sessionID: string): Stepper.MemoryState {
    return getState(sessionID)
  }
}
