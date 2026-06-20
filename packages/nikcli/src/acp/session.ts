import type { McpServer } from "@agentclientprotocol/sdk"
import { Log } from "@/util/log"

/**
 * In-memory store of ACP session state.
 *
 * The store mirrors opencode's `ACPSession` service: a `Map` of session
 * records, one per live ACP session, with helpers to mutate and look up
 * state without going through Effect's `Ref` machinery. We avoid `Ref`
 * because:
 *
 * 1. The session map only mutates from request handlers (one at a time
 *    per session because the protocol is sequential), so contention is
 *    not a concern.
 * 2. The store is short-lived — every connection creates its own
 *    `ACPAgent`, which owns its own store.
 * 3. Keeping the surface tiny makes the protocol boundary easy to audit.
 */
const log = Log.create({ service: "acp-session-store" })

export type SelectedModel = {
  readonly providerID: string
  readonly modelID: string
}

export type Variant = string | undefined

/**
 * Recorded metadata for a single message part so we can route streamed
 * deltas to the right update channel even after the backend has emitted
 * the part's `message.part.updated` event.
 */
export type KnownMessagePartMetadata = {
  readonly messageId: string
  readonly partId: string
  readonly partType?: string
  readonly role?: "user" | "assistant"
  readonly ignored?: boolean
  readonly toolCallId?: string
  readonly metadata?: unknown
}

export type Info = {
  readonly id: string
  readonly cwd: string
  readonly mcpServers: ReadonlyArray<McpServer>
  readonly createdAt: Date
  model?: SelectedModel
  variant?: Variant
  modeId?: string
  readonly knownParts: Map<string, KnownMessagePartMetadata>
}

export type StoreInput = {
  readonly id: string
  readonly cwd: string
  readonly mcpServers?: ReadonlyArray<McpServer>
  readonly createdAt?: Date
  readonly model?: SelectedModel
  readonly variant?: Variant
  readonly modeId?: string
}

export type RecordPartMetadataInput = {
  readonly sessionId: string
  readonly messageId: string
  readonly partId: string
  readonly partType?: string
  readonly role?: "user" | "assistant"
  readonly ignored?: boolean
  readonly toolCallId?: string
  readonly metadata?: unknown
}

export type PartMetadataLookupInput = {
  readonly sessionId: string
  readonly messageId: string
  readonly partId: string
}

/**
 * Read-only view of the session info returned to callers. The store
 * always clones on the way out so callers cannot mutate live state
 * by holding a reference.
 */
export type ReadonlyInfo = Readonly<Info>

export class SessionNotFound extends Error {
  constructor(readonly sessionId: string) {
    super(`session not found: ${sessionId}`)
    this.name = "SessionNotFound"
  }
}

/**
 * `Store` is the imperative API the agent / service layer calls. It is
 * deliberately small: create / load / get / set / remove / list, plus the
 * `knownParts` metadata side-channel used by the event subscription.
 */
export class Store {
  private readonly sessions = new Map<string, Info>()

  /**
   * Insert a new session entry. Used by `session/new`.
   */
  create(input: StoreInput): Info {
    const info = makeSession(input)
    this.sessions.set(info.id, info)
    log.debug("created session", { id: info.id, cwd: info.cwd })
    return snapshot(info)
  }

  /**
   * Insert (or overwrite) an existing session. Used by `session/load`,
   * `session/fork`, and `session/resume`.
   */
  load(input: StoreInput): Info {
    const info = makeSession(input)
    this.sessions.set(info.id, info)
    log.debug("loaded session", { id: info.id, cwd: info.cwd })
    return snapshot(info)
  }

  /**
   * Return all live sessions, sorted most-recently-created first. Used by
   * `session/list` to merge with the server-side session list.
   */
  list(): ReadonlyArray<ReadonlyInfo> {
    return [...this.sessions.values()].toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(snapshot)
  }

  /**
   * Return a snapshot of the session or `undefined` if it has been closed.
   * Use this when the caller can tolerate a missing session (e.g. when an
   * event arrives for a session we already removed).
   */
  tryGet(sessionId: string): ReadonlyInfo | undefined {
    const session = this.sessions.get(sessionId)
    return session ? snapshot(session) : undefined
  }

  /**
   * Return a snapshot of the session or throw `SessionNotFound`. Use this
   * from request handlers where a missing session is a protocol error.
   */
  get(sessionId: string): ReadonlyInfo {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.error("session not found", { sessionId })
      throw new SessionNotFound(sessionId)
    }
    return snapshot(session)
  }

  /**
   * Remove a session and return its final snapshot. Returns `undefined`
   * when the session id was unknown so `session/close` can answer with
   * an idempotent success.
   */
  remove(sessionId: string): ReadonlyInfo | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    this.sessions.delete(sessionId)
    log.debug("removed session", { sessionId })
    return snapshot(session)
  }

  /**
   * Set the active model for the session. Pass `undefined` to clear.
   * Returns the new snapshot, or throws if the session is gone.
   */
  setModel(sessionId: string, model: SelectedModel | undefined): ReadonlyInfo {
    return this.update(sessionId, (info) => {
      info.model = model
    })
  }

  /**
   * Set the active variant for the session. Pass `undefined` to clear.
   */
  setVariant(sessionId: string, variant: Variant): ReadonlyInfo {
    return this.update(sessionId, (info) => {
      info.variant = variant
    })
  }

  /**
   * Set the active mode (agent name) for the session.
   */
  setMode(sessionId: string, modeId: string | undefined): ReadonlyInfo {
    return this.update(sessionId, (info) => {
      info.modeId = modeId
    })
  }

  /**
   * Record the metadata of a message part we have seen so we can route
   * streaming deltas correctly. The map is keyed by `messageId:partId`
   * so collisions across parts in the same message cannot occur.
   */
  recordPartMetadata(input: RecordPartMetadataInput): KnownMessagePartMetadata {
    const session = this.sessions.get(input.sessionId)
    if (!session) throw new SessionNotFound(input.sessionId)
    const metadata: KnownMessagePartMetadata = {
      messageId: input.messageId,
      partId: input.partId,
      partType: input.partType,
      role: input.role,
      ignored: input.ignored,
      toolCallId: input.toolCallId,
      metadata: input.metadata,
    }
    session.knownParts.set(partMetadataKey(input), metadata)
    return metadata
  }

  /**
   * Look up metadata for a part. Throws if the session is gone (since the
   * caller almost always also needs the session itself).
   */
  getPartMetadata(input: PartMetadataLookupInput): KnownMessagePartMetadata | undefined {
    const session = this.sessions.get(input.sessionId)
    if (!session) throw new SessionNotFound(input.sessionId)
    return session.knownParts.get(partMetadataKey(input))
  }

  /**
   * Non-throwing variant of `getPartMetadata` used when the caller already
   * tolerates a missing session.
   */
  tryGetPartMetadata(input: PartMetadataLookupInput): KnownMessagePartMetadata | undefined {
    return this.sessions.get(input.sessionId)?.knownParts.get(partMetadataKey(input))
  }

  private update(sessionId: string, mutate: (info: Info) => void): ReadonlyInfo {
    const session = this.sessions.get(sessionId)
    if (!session) throw new SessionNotFound(sessionId)
    mutate(session)
    return snapshot(session)
  }
}

function makeSession(input: StoreInput): Info {
  return {
    id: input.id,
    cwd: input.cwd,
    mcpServers: [...(input.mcpServers ?? [])],
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
    model: input.model,
    variant: input.variant,
    modeId: input.modeId,
    knownParts: new Map(),
  }
}

/**
 * Deep-clone the parts of `Info` callers could accidentally mutate
 * (arrays, dates, maps) so external code never sees live references.
 */
function snapshot(info: Info): Info {
  return {
    id: info.id,
    cwd: info.cwd,
    mcpServers: [...info.mcpServers],
    createdAt: new Date(info.createdAt),
    model: info.model,
    variant: info.variant,
    modeId: info.modeId,
    knownParts: new Map(info.knownParts),
  }
}

function partMetadataKey(input: { messageId: string; partId: string }): string {
  return `${input.messageId}:${input.partId}`
}

export * as ACPSession from "./session"
