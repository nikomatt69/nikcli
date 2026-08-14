import { asc, eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { project } from "./project.sql"
import type { Project } from "./project"

/**
 * SQL-backed repository for project identity.
 *
 * Replaces the `["project", id]` / `["project_directory", id]` JSON key
 * tree. Sanitization stays on the way out: a corrupt row is dropped rather
 * than surfaced. `directories` is excluded from the identity upsert so a
 * full-replace write of `Info` cannot clobber the directory list.
 */
export namespace ProjectRepo {
  function db() {
    return Database.syncDb()
  }

  type Executor = Database.TxOrDb

  function toRow(info: Project.Info) {
    return {
      id: info.id,
      data: JSON.stringify(info),
      createdAt: info.time.created,
      updatedAt: info.time.updated,
    }
  }

  function readInfo(data: string): Project.Info | undefined {
    try {
      const parsed = JSON.parse(data) as Project.Info
      if (!parsed || typeof parsed.id !== "string" || typeof parsed.worktree !== "string") return undefined
      if (!parsed.time || typeof parsed.time.created !== "number" || typeof parsed.time.updated !== "number") {
        return undefined
      }
      return {
        ...parsed,
        canonical: parsed.canonical ?? parsed.worktree,
        sandboxes: Array.isArray(parsed.sandboxes) ? parsed.sandboxes : [],
      }
    } catch {
      return undefined
    }
  }

  function defined<T>(values: (T | undefined)[]): T[] {
    return values.filter((value): value is T => value !== undefined)
  }

  export function get(id: string): Project.Info | undefined {
    const row = db().select({ data: project.data }).from(project).where(eq(project.id, id)).get()
    return row ? readInfo(row.data) : undefined
  }

  /**
   * Insert or replace identity, leaving `directories` alone.
   *
   * That exclusion is the whole reason the directory list used to be its
   * own record: `fromDirectory` round-trips the whole `Info` on every
   * resolve, so a full-replace write must not carry the directory list
   * with it.
   */
  export function upsert(info: Project.Info, executor: Executor = db()): void {
    const row = toRow(info)
    executor
      .insert(project)
      .values(row)
      .onConflictDoUpdate({
        target: project.id,
        set: {
          data: row.data,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      })
      .run()
  }

  /** Mutate-in-place, matching `Storage.update`. Throws when the row is missing. */
  export function update(id: string, fn: (draft: Project.Info) => void): Project.Info {
    const current = get(id)
    if (!current) throw new Error(`Project not found: ${id}`)
    const draft = structuredClone(current)
    fn(draft)
    upsert(draft)
    return draft
  }

  /** Id-ascending, matching the previous JSON key sort. */
  export function list(): Project.Info[] {
    const rows = db().select({ data: project.data }).from(project).orderBy(asc(project.id)).all()
    return defined(rows.map((row) => readInfo(row.data)))
  }

  /**
   * `undefined` means the column is still null (bootstrap). An empty array
   * is a stored empty list and must not re-bootstrap.
   */
  export function directories(id: string): Project.Directory[] | undefined {
    const row = db().select({ directories: project.directories }).from(project).where(eq(project.id, id)).get()
    if (!row || row.directories == null) return undefined
    try {
      const parsed = JSON.parse(row.directories) as unknown
      if (!Array.isArray(parsed)) return undefined
      return parsed.filter((item): item is Project.Directory => {
        return !!item && typeof item === "object" && typeof (item as Project.Directory).directory === "string"
      })
    } catch {
      return undefined
    }
  }

  export function setDirectories(id: string, items: Project.Directory[], executor: Executor = db()): void {
    executor
      .update(project)
      .set({ directories: JSON.stringify(items) })
      .where(eq(project.id, id))
      .run()
  }

  /** Test isolation: wipe every project row. Replaces a `["project"]` prefix delete. */
  export function clear(): void {
    db().delete(project).run()
  }
}
