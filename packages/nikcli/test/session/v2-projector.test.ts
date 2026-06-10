import { afterAll, describe, expect, it } from "bun:test"
import type { MessageV2 as MessageV2Types } from "@/session/message-v2"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-v2-projector-home-"))
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
const { Instance } = await import("@/project/instance")

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-v2-projector-project-")))

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

describe("SessionProjector", () => {
  it("mirrors in-flight assistant work from v1 bus events and drops it on completion", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()

        const sessionID = Identifier.descending("session")
        const updates: string[] = []
        const unsubscribe = Bus.subscribe(SessionProjector.Event.Updated, (event) => {
          updates.push(event.properties.sessionID)
        })

        // v1 engine creates the assistant message (in flight)
        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })

        // streams a text part and a completed tool part
        const textPart = {
          id: Identifier.ascending("part"),
          sessionID,
          messageID: info.id,
          type: "text" as const,
          text: "partial answer",
        }
        await Bus.publish(MessageV2.Event.PartUpdated, { part: textPart })
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

        const inflight = SessionProjector.inflight(sessionID)
        expect(inflight).toHaveLength(1)
        expect(inflight[0].parts.map((p) => p.type)).toEqual(["text", "tool"])

        // live state surfaces the in-flight work as pending v2 entries
        const live = SessionV2.state(sessionID)
        expect(live.pending).toHaveLength(1)
        expect(live.pending[0].role).toBe("assistant")

        // completion drops the mirror (storage becomes the source of truth)
        await Bus.publish(MessageV2.Event.Updated, {
          info: assistantInfo(sessionID, { id: info.id, time: { created: info.time.created, completed: Date.now() } }),
        })
        expect(SessionProjector.inflight(sessionID)).toHaveLength(0)
        expect(SessionV2.state(sessionID).pending).toHaveLength(0)

        // entry-grade updates were published (message created, tool transition,
        // completion) — text deltas alone would not have fired
        expect(updates.filter((id) => id === sessionID).length).toBeGreaterThanOrEqual(3)

        unsubscribe()
      },
    })
  })

  it("ignores parts for unknown messages and cleans up on clear", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()
        const sessionID = Identifier.descending("session")

        await Bus.publish(MessageV2.Event.PartUpdated, {
          part: {
            id: Identifier.ascending("part"),
            sessionID,
            messageID: Identifier.ascending("message"),
            type: "text" as const,
            text: "orphan",
          },
        })
        expect(SessionProjector.inflight(sessionID)).toHaveLength(0)

        const info = assistantInfo(sessionID)
        await Bus.publish(MessageV2.Event.Updated, { info })
        expect(SessionProjector.inflight(sessionID)).toHaveLength(1)

        SessionV2.clear(sessionID)
        expect(SessionProjector.inflight(sessionID)).toHaveLength(0)
      },
    })
  })
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(projectDir, { recursive: true, force: true })
  await fs.rm(testHome, { recursive: true, force: true })
})
