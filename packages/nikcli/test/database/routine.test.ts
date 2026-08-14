import { describe, expect, it } from "bun:test"
import { existsSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { withIsolatedDatabase } from "../helpers/sqlite"

function routineRecord(id = "hourly-blue-fox", projectID = "proj_rt_1") {
  return {
    id,
    name: "hourly check",
    prompt: "inspect the repo",
    triggers: [{ type: "schedule" as const, cron: "@hourly", enabled: true }],
    paused: false,
    projectID,
    directory: "/tmp/project",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
  }
}

describe("routine SQL", () => {
  it("backfills the JSON tree into SQL on first open", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const projectID = "proj_rt_1"
      const storage = path.join(home, "data", "storage")
      const record = routineRecord()

      await fs.mkdir(path.join(storage, "routine", projectID), { recursive: true })
      await fs.writeFile(path.join(storage, "routine", projectID, `${record.id}.json`), JSON.stringify(record))

      const { Database } = await import("@/database/database")
      const { RoutineRepo } = await import("@/mobile/repo")
      Database.syncDb()

      expect(RoutineRepo.get(projectID, record.id)?.name).toBe("hourly check")
      expect(RoutineRepo.list(projectID).map((row) => row.id)).toEqual([record.id])

      const migration = (await import("@/database/migration/20260814070000_routine")).default
      migration.up(Database.syncNative())
      expect(RoutineRepo.list(projectID)).toHaveLength(1)

      expect(await fs.readFile(path.join(storage, "routine", projectID, `${record.id}.json`), "utf8")).toContain(
        "hourly check",
      )
    })
  })

  it("does not write JSON files after the domain has moved", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const { Database } = await import("@/database/database")
      const { RoutineRepo } = await import("@/mobile/repo")
      Database.syncDb()

      const projectID = "proj_no_json"
      const record = routineRecord("quiet-red-owl", projectID)
      RoutineRepo.upsert(projectID, record)

      const storage = path.join(home, "data", "storage")
      expect(existsSync(path.join(storage, "routine"))).toBe(false)
      expect(RoutineRepo.get(projectID, record.id)?.prompt).toBe("inspect the repo")
    })
  })

  it("runtime reads ignore leftover JSON after the domain has moved", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const { Database } = await import("@/database/database")
      const { RoutineRepo } = await import("@/mobile/repo")
      Database.syncDb()

      const projectID = "proj_trap"
      const record = routineRecord("stale-json-rt", projectID)
      RoutineRepo.upsert(projectID, { ...record, name: "sql-name" })

      const storage = path.join(home, "data", "storage")
      await fs.mkdir(path.join(storage, "routine", projectID), { recursive: true })
      await fs.writeFile(
        path.join(storage, "routine", projectID, `${record.id}.json`),
        JSON.stringify({ ...record, name: "json-name" }),
      )

      expect(RoutineRepo.get(projectID, record.id)?.name).toBe("sql-name")

      const onlyJson = routineRecord("json-only-rt", projectID)
      await fs.writeFile(path.join(storage, "routine", projectID, `${onlyJson.id}.json`), JSON.stringify(onlyJson))
      expect(RoutineRepo.get(projectID, onlyJson.id)).toBeUndefined()
    })
  })

  it("update and remove operate on the SQL row", async () => {
    await withIsolatedDatabase(async () => {
      const { Database } = await import("@/database/database")
      const { RoutineRepo } = await import("@/mobile/repo")
      Database.syncDb()

      const projectID = "proj_mutate"
      const record = routineRecord("keep-going", projectID)
      RoutineRepo.upsert(projectID, record)
      const updated = RoutineRepo.update(projectID, record.id, (draft) => {
        draft.paused = true
        draft.lastRunAt = 42
      })
      expect(updated?.paused).toBe(true)
      expect(RoutineRepo.get(projectID, record.id)?.lastRunAt).toBe(42)

      expect(RoutineRepo.remove(projectID, record.id)).toBe(true)
      expect(RoutineRepo.get(projectID, record.id)).toBeUndefined()
    })
  })
})
