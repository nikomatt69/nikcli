import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import type { MessageV2 as MessageV2Types } from "@/session/message-v2"
import type { SessionEntry as SessionEntryTypes } from "@/session/v2/entry"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-v2-persistence-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Identifier } = await import("@/id/id")
const { Bus } = await import("@/bus")
const { MessageV2 } = await import("@/session/message-v2")
const { SessionEntry } = await import("@/session/v2/entry")
const { SessionProjector } = await import("@/session/v2/projector")
const { SessionV2 } = await import("@/session/v2")
const { Instance } = await import("@/project/instance")

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-v2-persistence-project-")))

function assistantInfo(sessionID: string, overrides: Record<string, unknown> = {}) {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant" as const,
    time: { created: Date.now() },
    parentID: Identifier.ascending("message"),
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    agent: "build",
    path: { cwd: projectDir, root: projectDir },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as MessageV2Types.Assistant
}

afterAll(async () => {
  await removeTestDir(projectDir)
  await removeTestDir(testHome)
})

/**
 * The live projection is what a client with an open stream sees. It has to
 * agree with the persisted one entry-for-entry and id-for-id, which is the
 * whole reason entry ids are derived rather than generated.
 */
describe("live v2 entry stream", () => {
  it("publishes an entry per change, with ids derived from the v1 ids", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        const updates: Array<{ sessionID: string; entry: SessionEntryTypes.Entry }> = []
        const unsubscribe = Bus.subscribe(SessionProjector.Event.EntryUpdated, (event) => {
          updates.push(event.properties as { sessionID: string; entry: SessionEntryTypes.Entry })
        })

        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })

        const textPart = {
          id: Identifier.ascending("part"),
          sessionID,
          messageID: info.id,
          type: "text" as const,
          text: "partial",
        }
        await Bus.publish(MessageV2.Event.PartUpdated, { part: textPart })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: { ...textPart, text: "partial answer" } })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: { ...textPart, text: "partial answer, final" } })

        // the step opened with a `start` entry, then every delta republished
        // the same text entry — same id, never a new one
        expect(updates[0]?.entry.type).toBe("start")
        expect(updates[0]?.entry.id).toBe(SessionEntry.idForMessage(info.id, "start"))

        const texts = updates.filter((u) => u.entry.type === "text")
        expect(texts).toHaveLength(3)
        expect(new Set(texts.map((t) => t.entry.id)).size).toBe(1)
        expect(texts[0]!.entry.id).toBe(SessionEntry.idForPart(info.id, textPart.id))
        expect((texts[2]!.entry as SessionEntryTypes.Text).text).toBe("partial answer, final")

        // completion publishes the sealing entry
        await Bus.publish(MessageV2.Event.Updated, {
          info: assistantInfo(sessionID, {
            id: info.id,
            time: { created: info.time.created, completed: Date.now() },
            finish: "stop",
          }),
        })

        const complete = updates.at(-1)
        expect(complete?.entry.type).toBe("complete")
        expect(complete?.entry.id).toBe(SessionEntry.idForMessage(info.id, "complete"))

        unsubscribe()
      },
    })
  })

  it("announces a removed entry by its derived id", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        const removed: string[] = []
        const unsubscribe = Bus.subscribe(SessionProjector.Event.EntryRemoved, (event) => {
          removed.push((event.properties as { entryID: string }).entryID)
        })

        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })
        const partID = Identifier.ascending("part")
        await Bus.publish(MessageV2.Event.PartUpdated, {
          part: { id: partID, sessionID, messageID: info.id, type: "text" as const, text: "gone" },
        })
        await Bus.publish(MessageV2.Event.PartRemoved, { sessionID, messageID: info.id, partID })

        expect(removed).toEqual([SessionEntry.idForPart(info.id, partID)])
        unsubscribe()
      },
    })
  })

  it("keeps the in-flight tail in `pending` and drops it on completion", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })
        await Bus.publish(MessageV2.Event.PartUpdated, {
          part: {
            id: Identifier.ascending("part"),
            sessionID,
            messageID: info.id,
            type: "text" as const,
            text: "in flight",
          },
        })

        expect(SessionV2.state(sessionID).pending.map((e) => e.type)).toEqual(["start", "text"])

        await Bus.publish(MessageV2.Event.Updated, {
          info: assistantInfo(sessionID, {
            id: info.id,
            time: { created: info.time.created, completed: Date.now() },
          }),
        })
        expect(SessionV2.state(sessionID).pending).toHaveLength(0)
      },
    })
  })
})

describe("SessionV2.events", () => {
  it("serves the durable sync log, which token deltas deliberately never enter", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const session = await SessionV2.create({ title: "durable" })

        const events = SessionV2.events(session.id)
        expect(events.map((e) => e.type)).toEqual(["session.created.1", "session.updated.1"])
        expect(events.map((e) => e.seq)).toEqual([1, 2])
        // message.part.updated is defined `log: false` — its state lives in
        // `entries()`, not in the log
        expect(events.some((e) => e.type.startsWith("message.part.updated"))).toBe(false)
      },
    })
  })
})
