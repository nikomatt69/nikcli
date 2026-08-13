import { describe, expect, it } from "bun:test"
import { fromEntries, stabilize, type ViewEntry } from "@tui/routes/session/view"
import { groupParts, toolOf } from "@tui/routes/session/rows"
import { liveMarkdown } from "@tui/routes/session/diagram"

/**
 * The turn model the session renderer draws from.
 *
 * Two things are pinned here. What a turn carries — the fields the message
 * components read, which is what made the renderer's move onto entries a
 * mechanical change rather than an exploration. And the **object identity** of
 * turns across rebuilds, which nothing else in the suite can see and which is
 * the difference between a smooth stream and a flickering one.
 */

const sessionID = "ses_1"

/** Mirrors `SessionEntry.idForPart` / `idForMessage` without importing them. */
const body = (id: string) => id.slice(id.indexOf("_") + 1)
const idForPart = (messageID: string, partID: string) => `evt_${body(messageID)}_1_${body(partID)}`
const idForMessage = (messageID: string, rank: number) => `evt_${body(messageID)}_${rank}`

/** One user turn and one assistant step with text, a tool, and a sealing. */
function conversation() {
  const userID = "msg_a"
  const assistantID = "msg_b"

  const entries: ViewEntry[] = [
    {
      id: idForMessage(userID, 0),
      sessionID,
      messageID: userID,
      type: "user",
      timestamp: 1,
      text: "do the thing",
    },
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
    {
      id: idForPart(assistantID, "prt_2"),
      sessionID,
      messageID: assistantID,
      type: "reasoning",
      timestamp: 3,
      ref: "prt_2",
      text: "hmm",
    },
    {
      id: idForPart(assistantID, "prt_3"),
      sessionID,
      messageID: assistantID,
      type: "text",
      timestamp: 4,
      ref: "prt_3",
      text: "here you go",
    },
    {
      id: idForPart(assistantID, "prt_4"),
      sessionID,
      messageID: assistantID,
      type: "tool",
      timestamp: 5,
      ref: "prt_4",
      callID: "c1",
      name: "read",
      state: { status: "completed" },
    },
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

  return { entries, userID, assistantID }
}

describe("session view", () => {
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

  it("the head and trailer entries frame the turn instead of sitting in it", () => {
    const { entries } = conversation()
    const [, assistant] = fromEntries(entries)
    expect(assistant!.body.some((e) => e.type === "start" || e.type === "complete")).toBe(false)
  })

  it("an in-flight turn has no `complete`, which is how the renderer knows it is live", () => {
    const { entries } = conversation()
    const live = fromEntries(entries.filter((e) => e.type !== "complete"))
    expect(live[1]!.complete).toBeUndefined()
    expect(live[1]!.completedAt).toBeUndefined()
  })

  it("a terminal error seals the turn even without a completion time", () => {
    const entries: ViewEntry[] = [
      { id: "evt_x_0", sessionID, messageID: "msg_x", type: "start", timestamp: 1 },
      {
        id: "evt_x_2",
        sessionID,
        messageID: "msg_x",
        type: "complete",
        timestamp: 1,
        error: { name: "MessageAbortedError" },
      },
    ]
    const [turn] = fromEntries(entries)
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

  /**
   * The renderer draws the turn list with `<For>`, which reconciles by
   * reference. `fromEntries` allocates fresh turns on every run, so without
   * `stabilize` every arriving entry handed `<For>` an all-new list and made
   * Solid tear down and repaint the entire transcript — the flicker.
   *
   * These assertions are about object identity, not values, because identity
   * is the whole mechanism. Nothing else in the suite can see a repaint.
   */
  describe("identity across rebuilds", () => {
    it("an unchanged conversation rebuilds to the very same array", () => {
      const { entries } = conversation()
      const first = fromEntries(entries)
      const second = stabilize(first, fromEntries(entries))
      expect(second).toBe(first)
    })

    it("a token delta does not touch the turn at all", () => {
      const { entries } = conversation()
      const first = fromEntries(entries)

      // What the sync store does on `session.entry.updated`: the entry object
      // is updated in place (`reconcile`), so no reference here changes — the
      // leaf component repaints on its own by reading `entry.text`.
      const streaming = entries.find((entry) => entry.type === "text")!
      ;(streaming as unknown as { text: string }).text = "here you go, with more words"

      expect(stabilize(first, fromEntries(entries))).toBe(first)
    })

    it("a new entry rebuilds only the turn it landed in", () => {
      const { entries } = conversation()
      const first = fromEntries(entries)
      const grown = stabilize(
        first,
        fromEntries([
          ...entries,
          {
            id: idForPart("msg_b", "prt_6"),
            sessionID,
            messageID: "msg_b",
            type: "text",
            timestamp: 10,
            text: "and one more thing",
          },
        ]),
      )

      expect(grown).not.toBe(first)
      // the user turn above it is untouched, so `<For>` leaves it mounted
      expect(grown[0]).toBe(first[0])
      expect(grown[1]).not.toBe(first[1])
      expect(grown[1]!.body).toHaveLength(first[1]!.body.length + 1)
    })

    it("a whole new turn leaves every turn before it mounted", () => {
      const { entries } = conversation()
      const first = fromEntries(entries)
      const next = stabilize(
        first,
        fromEntries([
          ...entries,
          { id: idForMessage("msg_c", 0), sessionID, messageID: "msg_c", type: "user", timestamp: 11, text: "again" },
        ]),
      )

      expect(next).toHaveLength(3)
      expect(next[0]).toBe(first[0])
      expect(next[1]).toBe(first[1])
    })

    it("sealing a turn rebuilds it, so the footer appears", () => {
      const { entries } = conversation()
      const live = entries.filter((e) => e.type !== "complete")
      const first = fromEntries(live)
      const sealed = stabilize(first, fromEntries(entries))

      expect(sealed[1]).not.toBe(first[1])
      expect(sealed[1]!.complete).toBeDefined()
      expect(sealed[0]).toBe(first[0])
    })
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

describe("liveMarkdown", () => {
  it("keeps the terminating newline of a live heading so the block type stays put", () => {
    expect(liveMarkdown("## Live projector\n", true)).toBe("## Live projector\n")
    expect(liveMarkdown("  ## Live projector\n\n", true)).toBe("## Live projector\n\n")
  })

  it("trims settled text the way the finished renderer always did", () => {
    expect(liveMarkdown("  ## Live projector\n\n", false)).toBe("## Live projector")
  })
})
