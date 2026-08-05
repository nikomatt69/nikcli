import { describe, expect, it } from "bun:test"
import { fromEntries, fromMessages, type ViewEntry, type ViewMessage, type ViewPart } from "@tui/routes/session/view"
import { groupParts, toolOf } from "@tui/routes/session/rows"

/**
 * The seam's contract: both sources produce the same turns.
 *
 * This is what makes converting the renderer a one-line provider swap with a
 * known outcome instead of an exploration. If the two ever diverge, the swap
 * would change what is painted — and that is exactly what this catches.
 */

const sessionID = "ses_1"

function part(messageID: string, id: string, extra: Record<string, unknown>): ViewPart {
  return { id, messageID, sessionID, ...extra } as ViewPart
}

/** Mirrors `SessionEntry.idForPart` / `idForMessage` without importing them. */
const body = (id: string) => id.slice(id.indexOf("_") + 1)
const idForPart = (messageID: string, partID: string) => `evt_${body(messageID)}_1_${body(partID)}`
const idForMessage = (messageID: string, rank: number) => `evt_${body(messageID)}_${rank}`

/** The v1 → entry conversion, mirroring `SessionEntry.fromV1Part`. */
function toEntry(p: ViewPart, message: ViewMessage): ViewEntry | undefined {
  const base = { id: idForPart(message.id, p.id), sessionID, messageID: message.id, ref: p.id }
  switch (p.type) {
    case "text":
      return { ...base, type: "text", timestamp: 0, text: p.text as string }
    case "reasoning":
      return { ...base, type: "reasoning", timestamp: 0, text: p.text as string }
    case "tool":
      return {
        ...base,
        type: "tool",
        timestamp: 0,
        callID: p.callID as string,
        name: p.tool as string,
        state: p.state,
      }
    default:
      return undefined
  }
}

function userEntry(message: ViewMessage, parts: readonly ViewPart[]): ViewEntry {
  return {
    id: idForMessage(message.id, 0),
    sessionID,
    messageID: message.id,
    type: "user",
    timestamp: message.time.created,
    text: parts
      .filter((p) => p.type === "text")
      .map((p) => p.text as string)
      .join("\n"),
  }
}

/** One user turn and one assistant step with text, a tool, and a sealing. */
function conversation() {
  const userID = "msg_a"
  const assistantID = "msg_b"

  const messages: ViewMessage[] = [
    { id: userID, sessionID, role: "user", time: { created: 1 } },
    {
      id: assistantID,
      sessionID,
      role: "assistant",
      time: { created: 2, completed: 9 },
      parentID: userID,
      agent: "build",
      mode: "build",
      modelID: "m",
      providerID: "p",
      finish: "stop",
      cost: 0.5,
      tokens: { output: 42 },
    },
  ]

  const parts: Record<string, ViewPart[]> = {
    [userID]: [part(userID, "prt_1", { type: "text", text: "do the thing" })],
    [assistantID]: [
      part(assistantID, "prt_2", { type: "reasoning", text: "hmm" }),
      part(assistantID, "prt_3", { type: "text", text: "here you go" }),
      part(assistantID, "prt_4", {
        type: "tool",
        callID: "c1",
        tool: "read",
        state: { status: "completed" },
      }),
      // not modelled as an entry — must be dropped by both sources alike
      part(assistantID, "prt_5", { type: "step-start" }),
    ],
  }

  // What the projections would have persisted for the same conversation.
  const entries: ViewEntry[] = [
    userEntry(messages[0]!, parts[userID]!),
    {
      id: idForMessage(assistantID, 0),
      sessionID,
      messageID: assistantID,
      type: "start",
      timestamp: 2,
      agent: "build",
      mode: "build",
      modelID: "m",
      providerID: "p",
    },
    ...parts[assistantID]!.flatMap((p) => {
      const entry = toEntry(p, messages[1]!)
      return entry ? [entry] : []
    }),
    {
      id: idForMessage(assistantID, 2),
      sessionID,
      messageID: assistantID,
      type: "complete",
      timestamp: 9,
      reason: "completed",
      finish: "stop",
      cost: 0.5,
      tokens: { output: 42 },
    },
  ]

  return { messages, parts, entries }
}

describe("session view seam", () => {
  it("both sources produce the same turns", () => {
    const { messages, parts, entries } = conversation()

    const viaMessages = fromMessages(messages, (id) => parts[id] ?? [], toEntry, userEntry)
    const viaEntries = fromEntries(entries)

    expect(viaEntries).toEqual(viaMessages)
  })

  it("a turn carries everything the components read off a message", () => {
    const { entries } = conversation()
    const [user, assistant] = fromEntries(entries)

    expect(user!.role).toBe("user")
    expect(user!.messageID).toBe("msg_a")
    expect(user!.createdAt).toBe(1)

    // the twelve fields UserMessage/AssistantMessage read, all present
    expect(assistant!.request).toEqual({ agent: "build", mode: "build", modelID: "m", providerID: "p" })
    expect(assistant!.complete).toEqual({ finish: "stop", error: undefined, outputTokens: 42, cost: 0.5 })
    expect(assistant!.completedAt).toBe(9)
    expect(assistant!.body.map((e) => e.type)).toEqual(["reasoning", "text", "tool"])
  })

  it("an in-flight turn has no `complete`, which is how the renderer knows it is live", () => {
    const { entries } = conversation()
    const live = fromEntries(entries.filter((e) => e.type !== "complete"))
    expect(live[1]!.complete).toBeUndefined()
    expect(live[1]!.completedAt).toBeUndefined()
  })

  it("a terminal error seals the turn even without a completion time", () => {
    const messages: ViewMessage[] = [
      {
        id: "msg_x",
        sessionID,
        role: "assistant",
        time: { created: 1 },
        error: { name: "MessageAbortedError" },
      },
    ]
    const [turn] = fromMessages(messages, () => [], toEntry, userEntry)
    expect(turn!.complete?.error).toEqual({ name: "MessageAbortedError" })
  })

  it("compaction is a property of the turn, not a row in it", () => {
    const { entries } = conversation()
    const withCompaction = [
      ...entries,
      { id: "evt_b_3", sessionID, messageID: "msg_b", type: "compaction", timestamp: 9, auto: true },
    ]
    const turns = fromEntries(withCompaction)
    expect(turns[1]!.compacted).toBe(true)
    expect(turns[1]!.body.some((e) => e.type === "compaction")).toBe(false)
  })

  it("row folding works unchanged on entries", () => {
    const explorations = ["c1", "c2", "c3"].map((callID) => ({
      type: "tool",
      callID,
      // entries name it `name`, v1 parts name it `tool` — both fold
      name: "read",
      state: { status: "completed" },
    }))

    const rows = groupParts(explorations, { closed: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe("group")
    expect(toolOf(explorations[0]!)).toBe("read")
  })
})
