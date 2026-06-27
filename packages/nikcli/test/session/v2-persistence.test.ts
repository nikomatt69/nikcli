import { afterAll, describe, expect, it } from "bun:test"
import type { MessageV2 as MessageV2Types } from "@/session/message-v2"
import type { SessionEntry as SessionEntryTypes } from "@/session/v2/entry"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { rmrf } from "../helpers/rmrf"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-v2-persistence-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { Identifier } = await import("@/id/id")
const { Bus } = await import("@/bus")
const { MessageV2 } = await import("@/session/message-v2")
const { SessionProjector } = await import("@/session/v2/projector")
const { SessionV2 } = await import("@/session/v2")
const { SessionV2EventRepo } = await import("@/session/v2/event-repo")
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

describe("SessionV2 event persistence", () => {
  it("persists the in-flight step, coalesces part deltas, and seals on completion", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

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
        // streaming deltas must coalesce into the same row, not append rows
        await Bus.publish(MessageV2.Event.PartUpdated, { part: { ...textPart, text: "partial answer" } })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: { ...textPart, text: "partial answer, final" } })

        await Bus.publish(MessageV2.Event.PartUpdated, {
          part: {
            id: Identifier.ascending("part"),
            sessionID,
            messageID: info.id,
            type: "tool" as const,
            callID: "c1",
            tool: "read",
            state: {
              status: "completed" as const,
              input: {},
              output: "ok",
              title: "t",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        })

        await Bus.publish(MessageV2.Event.Updated, {
          info: assistantInfo(sessionID, { id: info.id, time: { created: info.time.created, completed: Date.now() } }),
        })

        const events = SessionV2.events(sessionID)
        expect(events.map((e) => e.type)).toEqual(["step.started", "part.updated", "part.updated", "step.ended"])

        // the coalesced text row carries the final content
        const persistedText = events.find((e) => e.type === "part.updated" && e.part.type === "text")
        expect(
          persistedText && persistedText.type === "part.updated" && (persistedText.part as { text: string }).text,
        ).toBe("partial answer, final")

        // replay reproduces the completed step from the log alone
        const replayed = SessionV2.replay(sessionID)
        expect(replayed.pending).toHaveLength(0)
        expect(replayed.entries).toHaveLength(1)
        const entry = replayed.entries[0] as SessionEntryTypes.AssistantText
        expect(entry.modelID).toBe("test-model")
        expect(entry.parts.map((p) => p.type)).toEqual(["text", "tool-result"])
        expect(entry.parts[0]).toMatchObject({ type: "text", text: "partial answer, final" })
      },
    })
  })

  it("a step without step.ended replays as pending (crash recovery shape)", async () => {
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
            text: "interrupted",
          },
        })

        const replayed = SessionV2.replay(sessionID)
        expect(replayed.entries).toHaveLength(0)
        expect(replayed.pending).toHaveLength(1)
      },
    })
  })

  it("removed parts and removed messages disappear from the log", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })

        const partID = Identifier.ascending("part")
        await Bus.publish(MessageV2.Event.PartUpdated, {
          part: { id: partID, sessionID, messageID: info.id, type: "text" as const, text: "to remove" },
        })
        expect(SessionV2.events(sessionID).some((e) => e.type === "part.updated")).toBe(true)

        await Bus.publish(MessageV2.Event.PartRemoved, { sessionID, messageID: info.id, partID })
        expect(SessionV2.events(sessionID).some((e) => e.type === "part.updated")).toBe(false)

        await Bus.publish(MessageV2.Event.Removed, { sessionID, messageID: info.id })
        expect(SessionV2.events(sessionID)).toHaveLength(0)
      },
    })
  })

  it("clear removes all rows for a session", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        await Bus.publish(MessageV2.Event.Updated, { info: assistantInfo(sessionID) })
        expect(SessionV2.events(sessionID).length).toBeGreaterThan(0)

        SessionV2EventRepo.clear(sessionID)
        expect(SessionV2.events(sessionID)).toHaveLength(0)
      },
    })
  })
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await rmrf(projectDir)
  await rmrf(testHome)
})
