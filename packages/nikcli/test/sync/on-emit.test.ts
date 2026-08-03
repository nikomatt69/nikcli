import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it, afterAll } from "bun:test"
import { Database } from "@/database/database"
import { Sync, type SyncEventRecord } from "@/sync"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const tempDir = mkdtempSync(join(tmpdir(), "nikcli-sync-on-emit-"))
process.env.NIKCLI_DB = join(tempDir, "test.db")
process.env.XDG_DATA_HOME = tempDir
preserveTestEnv(["NIKCLI_DB", "XDG_DATA_HOME"])

afterAll(() => {
  Database.close(join(tempDir, "test.db"))
  rmSync(tempDir, { recursive: true, force: true })
})

describe("Sync.onEmit", () => {
  it("notifies listeners after the row lands, with the resolved origin", async () => {
    const projectID = "test_proj_on_emit"
    const seen: Array<{ record: SyncEventRecord; origin: string }> = []
    const unsubscribe = Sync.onEmit((record, meta) => {
      seen.push({ record, origin: meta.origin })
    })

    try {
      const local = await Sync.emitRaw(projectID, "wrk_hook_local", { type: "workspace.test" })
      const remote = await Sync.emitRaw(
        projectID,
        "wrk_hook_remote",
        { type: "workspace.test" },
        { origin: "remote:cli", originSeq: 7 },
      )

      expect(seen).toHaveLength(2)
      expect(seen[0].record.id).toBe(local.id)
      expect(seen[0].origin).toBe("local")
      expect(seen[1].record.id).toBe(remote.id)
      expect(seen[1].origin).toBe("remote:cli")

      // The row is already visible to readers when the listener fires.
      const stored = await Sync.getEvents(projectID, "wrk_hook_local")
      expect(stored.map((event) => event.id)).toContain(local.id)
    } finally {
      unsubscribe()
    }

    await Sync.emitRaw(projectID, "wrk_hook_local", { type: "workspace.test" })
    expect(seen).toHaveLength(2)
  })

  it("keeps emitting when a listener throws, and still runs the other listeners", async () => {
    const projectID = "test_proj_on_emit_throw"
    const seen: string[] = []
    const unsubscribeBad = Sync.onEmit(() => {
      throw new Error("listener boom")
    })
    const unsubscribeGood = Sync.onEmit((record) => {
      seen.push(record.id)
    })

    try {
      const record = await Sync.emitRaw(projectID, "wrk_hook_throw", { type: "workspace.test" })
      expect(seen).toEqual([record.id])
    } finally {
      unsubscribeBad()
      unsubscribeGood()
    }
  })
})
