import { preserveTestEnv } from "../helpers/env"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-rollup-home-"))
const dbPath = path.join(testHome, "rollup.db")
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DB = dbPath
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_DB",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Database } = await import("@/database/database")
const { AnalyticsRollup } = await import("@/analytics/rollup")
const { Instance } = await import("@/project/instance")
const { runPromiseWithLayer } = await import("@/effect")
const { Effect } = await import("effect")

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-rollup-project-")))

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true }).catch(() => {})
  await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
})

/** Midday UTC on the given day, so a timezone slip would move the bucket visibly. */
function at(day: string, hour = 12) {
  return Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`)
}

type Turn = {
  session: string
  day: string
  provider: string
  model: string
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
  durationMs?: number
  tools?: number
}

let seq = 0

async function seed(turns: Turn[]) {
  await runPromiseWithLayer(
    Database.layerFromPath(dbPath),
    Effect.gen(function* () {
      const { native } = yield* Database.Service
      yield* Effect.sync(() => {
        native.exec("DELETE FROM message_part; DELETE FROM message_info; DELETE FROM session_info;")
        for (const turn of turns) {
          seq++
          native
            .query(
              `INSERT OR IGNORE INTO session_info (id, project_id, title, directory, version, data, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?)`,
            )
            .run(turn.session, "proj", "t", projectDir, "1", "{}", at(turn.day), at(turn.day))

          const created = at(turn.day)
          const messageID = `msg-${seq}`
          const info = {
            providerID: turn.provider,
            modelID: turn.model,
            cost: turn.cost ?? 0,
            time: { created, completed: created + (turn.durationMs ?? 0) },
            tokens: {
              input: turn.input ?? 0,
              output: turn.output ?? 0,
              reasoning: turn.reasoning ?? 0,
              cache: { read: turn.cacheRead ?? 0, write: turn.cacheWrite ?? 0 },
            },
          }
          native
            .query(`INSERT INTO message_info (id, session_id, role, info, created_at) VALUES (?,?,?,?,?)`)
            .run(messageID, turn.session, "assistant", JSON.stringify(info), created)

          for (let i = 0; i < (turn.tools ?? 0); i++) {
            native
              .query(`INSERT INTO message_part (id, message_id, session_id, type, info, sort_key) VALUES (?,?,?,?,?,?)`)
              .run(`part-${seq}-${i}`, messageID, turn.session, "tool", "{}", String(i))
          }
        }
      })
    }),
  )
}

function rebuild(from: string, to: string) {
  return Instance.provide({ directory: projectDir, fn: () => AnalyticsRollup.rebuild({ from, to }) })
}

function read(from: string, to: string) {
  return Instance.provide({ directory: projectDir, fn: () => AnalyticsRollup.read({ from, to }) })
}

function pending(from: string, to: string) {
  return Instance.provide({ directory: projectDir, fn: () => AnalyticsRollup.pending({ from, to }) })
}

function markPublished(periods: string[]) {
  return Instance.provide({ directory: projectDir, fn: () => AnalyticsRollup.markPublished(periods) })
}

describe("AnalyticsRollup", () => {
  beforeEach(async () => {
    await seed([])
  })

  it("groups by day, provider and model with the full token breakdown", async () => {
    await seed([
      {
        session: "s1",
        day: "2026-08-01",
        provider: "anthropic",
        model: "claude-opus-5",
        input: 10,
        output: 20,
        reasoning: 5,
        cacheRead: 3,
        cacheWrite: 2,
        cost: 1.5,
        durationMs: 1000,
        tools: 2,
      },
    ])
    await rebuild("2026-08-01", "2026-08-01")
    const rows = await read("2026-08-01", "2026-08-01")

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.periodKey).toBe("2026-08-01")
    expect(row.provider).toBe("anthropic")
    expect(row.model).toBe("claude-opus-5")
    expect(row.messages).toBe(1)
    expect(row.sessions).toBe(1)
    expect(row.toolCalls).toBe(2)
    expect(row.inputTokens).toBe(10)
    expect(row.cacheWriteTokens).toBe(2)
    // Every bucket, so a tokens total matches what the model was billed for.
    expect(row.totalTokens).toBe(40)
    // USD float in, micro-cent integer out.
    expect(row.costMicroCents).toBe(150_000_000)
    expect(row.durationMs).toBe(1000)
  })

  it("counts distinct sessions per model instead of summing them", async () => {
    // One session that used two models, plus a second session on one of them.
    // Summing the per-model rows would claim 3 sessions; the truth is 2.
    await seed([
      { session: "s1", day: "2026-08-02", provider: "anthropic", model: "opus" },
      { session: "s1", day: "2026-08-02", provider: "anthropic", model: "haiku" },
      { session: "s2", day: "2026-08-02", provider: "anthropic", model: "opus" },
    ])
    await rebuild("2026-08-02", "2026-08-02")
    const rows = await read("2026-08-02", "2026-08-02")

    const opus = rows.find((r) => r.model === "opus")!
    const haiku = rows.find((r) => r.model === "haiku")!
    expect(opus.sessions).toBe(2)
    expect(haiku.sessions).toBe(1)
    // The published rows cannot be summed back into a session count — which is
    // exactly why a distinct count has to be stored, not derived downstream.
    expect(opus.sessions + haiku.sessions).not.toBe(2)
  })

  it("keeps the same model on different providers apart", async () => {
    await seed([
      { session: "s1", day: "2026-08-03", provider: "anthropic", model: "opus", input: 1 },
      { session: "s2", day: "2026-08-03", provider: "bedrock", model: "opus", input: 2 },
    ])
    await rebuild("2026-08-03", "2026-08-03")
    const rows = await read("2026-08-03", "2026-08-03")

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.provider).sort()).toEqual(["anthropic", "bedrock"])
  })

  it("is a rebuild, not an accumulation", async () => {
    const turns: Turn[] = [
      { session: "s1", day: "2026-08-04", provider: "anthropic", model: "opus", input: 100, cost: 2 },
    ]
    await seed(turns)
    await rebuild("2026-08-04", "2026-08-04")
    await rebuild("2026-08-04", "2026-08-04")
    const rows = await read("2026-08-04", "2026-08-04")

    expect(rows).toHaveLength(1)
    // Running twice must not double anything.
    expect(rows[0]!.inputTokens).toBe(100)
    expect(rows[0]!.messages).toBe(1)
    expect(rows[0]!.costMicroCents).toBe(200_000_000)
  })

  it("drops a model that no longer has messages on a rebuilt day", async () => {
    await seed([{ session: "s1", day: "2026-08-05", provider: "anthropic", model: "gone" }])
    await rebuild("2026-08-05", "2026-08-05")
    expect(await read("2026-08-05", "2026-08-05")).toHaveLength(1)

    await seed([])
    await rebuild("2026-08-05", "2026-08-05")
    expect(await read("2026-08-05", "2026-08-05")).toEqual([])
  })

  it("ignores turns that never reached a provider", async () => {
    await seed([{ session: "s1", day: "2026-08-06", provider: "", model: "", input: 999 }])
    await rebuild("2026-08-06", "2026-08-06")
    expect(await read("2026-08-06", "2026-08-06")).toEqual([])
  })

  it("stops offering a period once it has been published", async () => {
    await seed([{ session: "s1", day: "2026-08-09", provider: "anthropic", model: "opus", input: 1 }])
    await rebuild("2026-08-09", "2026-08-09")

    expect(await pending("2026-08-09", "2026-08-09")).toEqual(["2026-08-09"])
    await markPublished(["2026-08-09"])
    expect(await pending("2026-08-09", "2026-08-09")).toEqual([])
  })

  it("offers a published period again once it is recomputed with new messages", async () => {
    await seed([{ session: "s1", day: "2026-08-10", provider: "anthropic", model: "opus", input: 1 }])
    await rebuild("2026-08-10", "2026-08-10")
    await markPublished(["2026-08-10"])
    expect(await pending("2026-08-10", "2026-08-10")).toEqual([])

    // A session resumed just before midnight lands on a day already reported. A
    // high-water mark on the last day sent would keep the stale numbers forever.
    await seed([
      { session: "s1", day: "2026-08-10", provider: "anthropic", model: "opus", input: 1 },
      { session: "s2", day: "2026-08-10", provider: "anthropic", model: "opus", input: 99 },
    ])
    await new Promise((resolve) => setTimeout(resolve, 2))
    await rebuild("2026-08-10", "2026-08-10")

    expect(await pending("2026-08-10", "2026-08-10")).toEqual(["2026-08-10"])
    expect((await read("2026-08-10", "2026-08-10"))[0]!.inputTokens).toBe(100)
  })

  it("only rebuilds the requested window", async () => {
    await seed([
      { session: "s1", day: "2026-08-07", provider: "anthropic", model: "opus", input: 1 },
      { session: "s2", day: "2026-08-08", provider: "anthropic", model: "opus", input: 2 },
    ])
    await rebuild("2026-08-07", "2026-08-07")

    expect(await read("2026-08-07", "2026-08-07")).toHaveLength(1)
    expect(await read("2026-08-08", "2026-08-08")).toEqual([])
  })
})
