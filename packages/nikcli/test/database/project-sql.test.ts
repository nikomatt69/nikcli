import { describe, expect, it } from "bun:test"
import { existsSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { withIsolatedDatabase } from "../helpers/sqlite"

function projectInfo(id = "proj_sql_1") {
  return {
    id,
    worktree: "/tmp/proj-sql",
    canonical: "/tmp/proj-sql",
    vcs: "git" as const,
    name: "sql project",
    sandboxes: ["/tmp/proj-sql-sandbox"],
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_100 },
  }
}

describe("project SQL", () => {
  it("backfills the JSON tree into SQL on first open", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const storage = path.join(home, "data", "storage")
      const info = projectInfo()
      const directories = [{ directory: "/tmp/proj-sql" }, { directory: "/tmp/other", strategy: "git_worktree" }]

      await fs.mkdir(path.join(storage, "project"), { recursive: true })
      await fs.mkdir(path.join(storage, "project_directory"), { recursive: true })
      await fs.writeFile(path.join(storage, "project", `${info.id}.json`), JSON.stringify(info))
      await fs.writeFile(path.join(storage, "project_directory", `${info.id}.json`), JSON.stringify(directories))

      const { Database } = await import("@/database/database")
      const { ProjectRepo } = await import("@/project/repo")
      Database.syncDb()

      expect(ProjectRepo.get(info.id)?.name).toBe("sql project")
      expect(ProjectRepo.list().map((row) => row.id)).toEqual([info.id])
      expect(ProjectRepo.directories(info.id)).toEqual(directories)

      const projectSql = (await import("@/database/migration/20260814030000_project_sql")).default
      projectSql.up(Database.syncNative())
      expect(ProjectRepo.list()).toHaveLength(1)
      expect(ProjectRepo.directories(info.id)).toEqual(directories)

      expect(await fs.readFile(path.join(storage, "project", `${info.id}.json`), "utf8")).toContain(info.name)
      expect(await fs.readFile(path.join(storage, "project_directory", `${info.id}.json`), "utf8")).toContain(
        "/tmp/other",
      )
    })
  })

  it("does not write JSON files after the domain has moved", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const { Database } = await import("@/database/database")
      const { ProjectRepo } = await import("@/project/repo")
      Database.syncDb()

      const info = projectInfo("proj_no_json")
      ProjectRepo.upsert(info)
      ProjectRepo.setDirectories(info.id, [{ directory: info.worktree }])

      const storage = path.join(home, "data", "storage")
      expect(existsSync(path.join(storage, "project"))).toBe(false)
      expect(existsSync(path.join(storage, "project_directory"))).toBe(false)
      expect(ProjectRepo.get(info.id)?.name).toBe("sql project")
      expect(ProjectRepo.directories(info.id)).toEqual([{ directory: info.worktree }])
    })
  })

  it("runtime reads ignore leftover JSON after the domain has moved", async () => {
    await withIsolatedDatabase(async ({ home }) => {
      const { Database } = await import("@/database/database")
      const { ProjectRepo } = await import("@/project/repo")
      Database.syncDb()

      const info = projectInfo("proj_trap")
      ProjectRepo.upsert({ ...info, name: "sql-title" })

      const storage = path.join(home, "data", "storage")
      await fs.mkdir(path.join(storage, "project"), { recursive: true })
      await fs.writeFile(
        path.join(storage, "project", `${info.id}.json`),
        JSON.stringify({ ...info, name: "json-title" }),
      )

      expect(ProjectRepo.get(info.id)?.name).toBe("sql-title")
    })
  })

  it("keeps directories null until written so bootstrap can still run", async () => {
    await withIsolatedDatabase(async () => {
      const { Database } = await import("@/database/database")
      const { ProjectRepo } = await import("@/project/repo")
      Database.syncDb()

      const info = projectInfo("proj_dirs")
      ProjectRepo.upsert(info)
      expect(ProjectRepo.directories(info.id)).toBeUndefined()

      ProjectRepo.setDirectories(info.id, [])
      expect(ProjectRepo.directories(info.id)).toEqual([])

      ProjectRepo.upsert({ ...info, name: "renamed" })
      expect(ProjectRepo.get(info.id)?.name).toBe("renamed")
      expect(ProjectRepo.directories(info.id)).toEqual([])
    })
  })
})
