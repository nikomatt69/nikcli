import { describe, expect, it } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { fromEntries, stabilize, type Turn, type ViewEntry } from "@tui/routes/session/view"

/**
 * The turn memo against the real store, with the real write the sync context
 * performs on `session.entry.updated`.
 *
 * `test/tui/session-view.test.ts` pins `stabilize` on plain objects. This pins
 * the assumption underneath it — that a token delta reaches the leaf without
 * changing any reference the turn list can see — against `solid-js/store`
 * itself, `reconcile` included. If that assumption ever breaks, every message
 * in the transcript is torn down and repainted on every token, and no unit
 * test above this one would notice.
 */

const sessionID = "ses_1"

function seed(): ViewEntry[] {
  return [
    { id: "evt_a_0", sessionID, messageID: "msg_a", type: "user", timestamp: 1, text: "hello" },
    { id: "evt_b_0", sessionID, messageID: "msg_b", type: "start", timestamp: 2, agent: "build", mode: "build" },
    { id: "evt_b_1_p1", sessionID, messageID: "msg_b", type: "text", timestamp: 3, ref: "p1", text: "Hi" },
  ]
}

/** Mirrors `context/sync.tsx`: the whole entry is reconciled onto the old one. */
function updated(store: ViewEntry[][], set: any, index: number, next: ViewEntry) {
  set("entry", sessionID, index, reconcile(next))
}

function harness() {
  return createRoot((dispose) => {
    const [store, setStore] = createStore<{ entry: Record<string, ViewEntry[]> }>({
      entry: { [sessionID]: seed() },
    })
    let runs = 0
    const turns = createMemo<Turn[]>((previous) => {
      runs++
      return stabilize(previous, fromEntries(store.entry[sessionID] ?? []))
    }, [])
    turns()
    return { store, setStore, turns, dispose, runs: () => runs }
  })
}

describe("turn identity against the real store", () => {
  it("a token delta changes no reference the turn list can see", () => {
    const { store, setStore, turns, dispose } = harness()
    const before = turns()
    const entry = store.entry[sessionID]![2]!

    for (const text of ["Hi t", "Hi the", "Hi there"]) {
      updated(store as never, setStore, 2, { ...entry, text })
      const after = turns()
      expect(after).toBe(before)
      expect(after[1]!.body[0]).toBe(before[1]!.body[0])
    }

    // The leaf still sees the new text: reconcile mutated the entry in place,
    // which is the whole reason the turn above it could hold still.
    expect(store.entry[sessionID]![2]!.text).toBe("Hi there")
    expect(before[1]!.body[0]!.text).toBe("Hi there")
    dispose()
  })

  it("reconcile keeps the entry object, so `body` keeps its element", () => {
    const { store, setStore, dispose } = harness()
    const original = store.entry[sessionID]![2]!
    updated(store as never, setStore, 2, { ...original, text: "grown" })
    expect(store.entry[sessionID]![2]!).toBe(original)
    dispose()
  })

  it("a new part rebuilds one turn and leaves the other mounted", () => {
    const { store, setStore, turns, dispose } = harness()
    const before = turns()

    setStore(
      "entry",
      sessionID,
      produce((entries: ViewEntry[]) => {
        entries.push({ id: "evt_b_1_p2", sessionID, messageID: "msg_b", type: "tool", timestamp: 4, ref: "p2" })
      }),
    )

    const after = turns()
    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    // the parts already on screen keep their identity, so only the new row mounts
    expect(after[1]!.body[0]).toBe(before[1]!.body[0])
    dispose()
  })
})
