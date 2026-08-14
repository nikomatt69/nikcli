import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import type { Session } from "@/session"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-restart-continuation-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "XDG_DATA_HOME"])

const { Database } = await import("@/database/database")
const { SessionRepo } = await import("@/session/repo")
const { sessionInfo } = await import("@/session/session.sql")

afterEach(() => {
  Database.syncDb().delete(sessionInfo).run()
})

afterAll(async () => {
  await removeTestDir(testHome)
})

let counter = 0
function makeSession(overrides: Partial<Session.Info> = {}): Session.Info {
  const now = Date.now()
  counter++
  return {
    id: `ses_test_${counter}`,
    projectID: "proj_test",
    directory: "/tmp/project",
    title: "test session",
    version: "local",
    time: { created: now, updated: now },
    ...overrides,
  } as Session.Info
}

describe("session restart continuation", () => {
  it("round-trips a suspension and returns the directory needed to resume", () => {
    const info = makeSession({ directory: "/tmp/project-a" })
    SessionRepo.upsert(info)

    SessionRepo.suspend([info.id])

    expect(SessionRepo.consumeSuspended()).toEqual([{ id: info.id, directory: "/tmp/project-a" }])
  })

  it("claims each suspension exactly once", () => {
    const first = makeSession()
    const second = makeSession()
    SessionRepo.upsert(first)
    SessionRepo.upsert(second)
    SessionRepo.suspend([first.id, second.id])

    // Two servers racing on one data directory: the clear happens in the same
    // statement as the read, so the second claim comes back empty.
    const claimed = SessionRepo.consumeSuspended()
    const raced = SessionRepo.consumeSuspended()

    expect(claimed.map((row) => row.id).sort()).toEqual([first.id, second.id].sort())
    expect(raced).toEqual([])
  })

  it("returns nothing when no server suspended anything (the hard-crash case)", () => {
    SessionRepo.upsert(makeSession())
    expect(SessionRepo.consumeSuspended()).toEqual([])
  })

  it("suspending an empty list is a no-op", () => {
    SessionRepo.upsert(makeSession())
    SessionRepo.suspend([])
    expect(SessionRepo.consumeSuspended()).toEqual([])
  })

  it("keeps the mark across an unrelated session write", () => {
    const info = makeSession()
    SessionRepo.upsert(info)
    SessionRepo.suspend([info.id])

    // A session can still be touched between the mark and the next startup —
    // a title update, a projector. Neither the upsert nor the update names
    // `time_suspended` in its set clause, so the mark must survive.
    SessionRepo.upsert({ ...info, title: "renamed" })
    SessionRepo.update(info.id, (session) => ({
      ...session,
      title: "renamed again",
    }))

    expect(SessionRepo.consumeSuspended().map((row) => row.id)).toEqual([info.id])
  })

  it("keeps the mark out of Session.Info", () => {
    const info = makeSession()
    SessionRepo.upsert(info)
    SessionRepo.suspend([info.id])

    const read = SessionRepo.get(info.id)
    expect(read).toBeDefined()
    expect(read).not.toHaveProperty("timeSuspended")
    expect(read).not.toHaveProperty("time_suspended")
    expect(Object.keys(read!.time).sort()).toEqual(["created", "updated"])
  })
})
