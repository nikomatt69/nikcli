/**
 * Turn model for the session view — the seam between the renderer and the
 * conversation data.
 *
 * The renderer reads messages and parts today; entries are the model every
 * other client (mobile, desktop, plugins, SDK) already uses. Converting the
 * renderer means changing the data shape *and* 3971 lines of components at
 * once, which is neither reviewable nor testable.
 *
 * So this module is introduced first, with both sources behind it:
 *
 *     fromMessages(messages, parts)  ─┐
 *                                     ├─► Turn[] ─► renderer
 *     fromEntries(entries)           ─┘
 *
 * The two are proved equivalent by test, so swapping the provider is a
 * one-line change with a known outcome rather than an exploration.
 *
 * **The unit is the turn, and a turn is a message.** That is deliberate: the
 * renderer virtualizes over messages (see `MESSAGE_HEIGHT_ESTIMATE` in
 * index.tsx), and keying turns on `messageID` keeps the number of windowed
 * units — and therefore the scroll maths, the fork/revert dialogs and
 * `TurnUsage` — exactly where they are. Entries carry `messageID` precisely
 * so this grouping is free.
 *
 * Deliberately dependency-free: no Solid, no store access, no SDK client.
 * It takes data and returns data, which is why it can be tested without
 * standing up a TUI — same rule as `rows.ts`.
 */

// ============================================================================
// Minimum shapes
// ============================================================================
//
// Structural, not imported from the SDK: this module is compiled into tests
// that construct fixtures by hand, and naming only the fields it reads makes
// the renderer's real dependency surface visible. Every field below is one
// the session components actually use.

export type ViewPart = {
  readonly id: string
  readonly messageID: string
  readonly sessionID: string
  readonly type: string
  readonly [key: string]: unknown
}

export type ViewMessage = {
  readonly id: string
  readonly sessionID: string
  readonly role: string
  readonly time: { readonly created: number; readonly completed?: number }
  readonly agent?: string
  readonly mode?: string
  readonly modelID?: string
  readonly providerID?: string
  readonly parentID?: string
  readonly finish?: string
  readonly error?: unknown
  readonly summary?: boolean
  readonly cost?: number
  readonly tokens?: { readonly output?: number }
}

export type ViewEntry = {
  readonly id: string
  readonly sessionID: string
  readonly messageID?: string
  readonly type: string
  readonly timestamp: number
  readonly ref?: string
  readonly [key: string]: unknown
}

/**
 * One turn of the conversation.
 *
 * `head` is what frames it — the `user` entry, or the assistant `start`.
 * `body` is the content the renderer folds into rows. `complete` is present
 * once the turn is sealed, and carries everything the footer shows (finish
 * reason, tokens, terminal error).
 */
export type Turn = {
  readonly messageID: string
  readonly sessionID: string
  readonly role: "user" | "assistant"
  readonly createdAt: number
  readonly completedAt?: number
  /**
   * When the turn before this one started.
   *
   * The footer shows how long a step took counting from the prompt that
   * caused it. v1 read that off `message.parentID`; a turn list has the
   * answer next door, and it does not depend on which source built it.
   */
  readonly previousCreatedAt?: number
  /** Model, agent and mode the turn ran with. Absent on user turns. */
  readonly request?: {
    readonly agent: string
    readonly mode: string
    readonly modelID: string
    readonly providerID: string
  }
  readonly complete?: {
    readonly finish?: string
    readonly error?: unknown
    readonly outputTokens: number
    readonly cost: number
  }
  /** True when history was compacted at this turn. */
  readonly compacted: boolean
  /** Content entries, in order. */
  readonly body: ViewEntry[]
}

// ============================================================================
// From entries — the v2 source
// ============================================================================

const HEAD = new Set(["user", "start"])
const TRAILER = new Set(["complete", "compaction"])

/**
 * Group flat entries into turns.
 *
 * Entries arrive already ordered (their id *is* the sort key — see
 * `SessionEntry.idForPart`), so this is a single pass that only has to notice
 * where `messageID` changes.
 */
export function fromEntries(entries: readonly ViewEntry[]): Turn[] {
  const turns: Turn[] = []
  const index = new Map<string, number>()

  for (const entry of entries) {
    const messageID = entry.messageID
    if (!messageID) continue

    let at = index.get(messageID)
    if (at === undefined) {
      at = turns.length
      index.set(messageID, at)
      turns.push({
        messageID,
        sessionID: entry.sessionID,
        role: entry.type === "user" ? "user" : "assistant",
        createdAt: entry.timestamp,
        compacted: false,
        body: [],
      })
    }

    const turn = turns[at]!
    if (entry.type === "user") {
      turns[at] = { ...turn, role: "user", createdAt: entry.timestamp, body: [...turn.body, entry] }
      continue
    }

    if (entry.type === "start") {
      turns[at] = {
        ...turn,
        role: "assistant",
        createdAt: entry.timestamp,
        request: {
          agent: String(entry.agent ?? ""),
          mode: String(entry.mode ?? ""),
          modelID: String(entry.modelID ?? ""),
          providerID: String(entry.providerID ?? ""),
        },
      }
      continue
    }

    if (entry.type === "complete") {
      const tokens = entry.tokens as { output?: number } | undefined
      turns[at] = {
        ...turn,
        completedAt: entry.timestamp,
        complete: {
          finish: entry.finish as string | undefined,
          error: entry.error,
          outputTokens: tokens?.output ?? 0,
          cost: typeof entry.cost === "number" ? entry.cost : 0,
        },
      }
      continue
    }

    if (entry.type === "compaction") {
      turns[at] = { ...turn, compacted: true }
      continue
    }

    turns[at] = { ...turn, body: [...turn.body, entry] }
  }

  return link(turns)
}

/** Give every turn the start time of the one before it. */
function link(turns: Turn[]): Turn[] {
  return turns.map((turn, index) => (index === 0 ? turn : { ...turn, previousCreatedAt: turns[index - 1]!.createdAt }))
}

// ============================================================================
// From messages and parts — the v1 source
// ============================================================================

/**
 * Build the same turns from v1 messages and parts.
 *
 * Kept structurally identical to `fromEntries` on purpose: the equivalence
 * test compares their output directly, so any divergence is a failure rather
 * than a surprise at render time.
 */
export function fromMessages(
  messages: readonly ViewMessage[],
  parts: (messageID: string) => readonly ViewPart[],
  toEntry: (part: ViewPart, message: ViewMessage) => ViewEntry | undefined,
  userEntry: (message: ViewMessage, parts: readonly ViewPart[]) => ViewEntry,
): Turn[] {
  const turns: Turn[] = []

  for (const message of messages) {
    const own = parts(message.id)

    if (message.role === "user") {
      turns.push({
        messageID: message.id,
        sessionID: message.sessionID,
        role: "user",
        createdAt: message.time.created,
        // v1 carries compaction as a part on the message; v2 as its own
        // entry. Either way it is a property of the turn.
        compacted: own.some((part) => part.type === "compaction"),
        body: [userEntry(message, own)],
      })
      continue
    }

    const body: ViewEntry[] = []
    for (const part of own) {
      const entry = toEntry(part, message)
      if (!entry) continue
      if (HEAD.has(entry.type) || TRAILER.has(entry.type)) continue
      body.push(entry)
    }

    turns.push({
      messageID: message.id,
      sessionID: message.sessionID,
      role: "assistant",
      createdAt: message.time.created,
      completedAt: message.time.completed,
      request: {
        agent: message.agent ?? "",
        mode: message.mode ?? "",
        modelID: message.modelID ?? "",
        providerID: message.providerID ?? "",
      },
      complete:
        message.time.completed !== undefined || message.error
          ? {
              finish: message.finish,
              error: message.error,
              outputTokens: message.tokens?.output ?? 0,
              cost: message.cost ?? 0,
            }
          : undefined,
      compacted: message.summary === true,
      body,
    })
  }

  return link(turns)
}
