import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import z from "zod"
import { InstanceState } from "@/effect"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-bridge-"))
process.env.NIKCLI_TEST_HOME = testDir
process.env.NIKCLI_DB = path.join(testDir, "nikcli.db")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB"])

const { Instance } = await import("@/project/instance")
const { Bus } = await import("@/bus")
const { BusEvent } = await import("@/bus/bus-event")
const { SessionStatus } = await import("@/session/status")
const { SessionSyncBridge } = await import("@/session/sync-bridge")
const { SyncStorage } = await import("@/sync")

const NoopEvent = BusEvent.define("test.session-bridge.noop", z.object({ sessionID: z.string() }))

afterAll(async () => {
  await removeTestDir(testDir)
})

async function waitForEvents(projectID: string, aggregate: string, count: number, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await SyncStorage.getEvents(projectID, aggregate)
    if (events.length >= count) return events
    await Bun.sleep(25)
  }
  return SyncStorage.getEvents(projectID, aggregate)
}

describe("SessionSyncBridge", () => {
  it("journals local session restore events and stops after unsubscribe", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-bridge-project-"))
    const run = Math.random().toString(36).slice(2)
    const sessionID = `ses_bridge_${run}`

    try {
      await Instance.provide({
        directory,
        fn: async () => {
          const instance = InstanceState.ambient()
          const projectID = instance.project.id
          const unsubscribe = SessionSyncBridge.init(instance)
          try {
            await Bus.publish(SessionStatus.Event.Idle, { sessionID })
            const events = await waitForEvents(projectID, sessionID, 1)
            expect(events).toHaveLength(1)
            expect(events[0].type).toBe("session.idle")
            // SAFETY: the assertion above pins this to the single
            // `session.idle` event the bridge under test just published, whose
            // payload carries `properties.sessionID`.
            expect((events[0].data as any).properties.sessionID).toBe(sessionID)

            // Event types outside the restore set are not journaled.
            await Bus.publish(NoopEvent, { sessionID: `${sessionID}_noop` })
            await Bun.sleep(100)
            expect(await SyncStorage.getEvents(projectID, `${sessionID}_noop`)).toHaveLength(0)
          } finally {
            unsubscribe()
          }

          // After unsubscribe nothing new lands in the journal.
          await Bus.publish(SessionStatus.Event.Idle, { sessionID: `${sessionID}_after` })
          await Bun.sleep(100)
          expect(await SyncStorage.getEvents(projectID, `${sessionID}_after`)).toHaveLength(0)
        },
      })
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await removeTestDir(directory)
    }
  })
})
