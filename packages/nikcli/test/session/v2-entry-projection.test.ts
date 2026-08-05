import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import type { SessionEntry as SessionEntryTypes } from "../../src/session/v2/entry"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-entry-projection-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [
  { Identifier },
  { Instance },
  { Session },
  { SessionV2 },
  { SessionEntryRepo },
  { Database },
  { Bus },
  { SessionProjector },
] = await Promise.all([
  import("../../src/id/id"),
  import("../../src/project/instance"),
  import("../../src/session"),
  import("../../src/session/v2"),
  import("../../src/session/v2/entry-repo"),
  import("../../src/database/database"),
  import("../../src/bus"),
  import("../../src/session/v2/projector"),
])

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-entry-projection-project-")))

function runSession<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

const service = () =>
  Effect.gen(function* () {
    return yield* Session.Service
  })

afterAll(async () => {
  Database.closeAll()
  await removeTestDir(projectDir)
  await removeTestDir(testHome)
})

/** Drive one user turn + one assistant step through the real Session service. */
async function conversation() {
  const session = await runSession(
    Effect.gen(function* () {
      const s = yield* service()
      return yield* s.createNext({ directory: projectDir, title: "entries" })
    }),
  )

  const userID = Identifier.ascending("message")
  await runSession(
    Effect.gen(function* () {
      const s = yield* service()
      yield* s.updateMessage({
        id: userID,
        sessionID: session.id,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "p", modelID: "m" },
      } as any)
      yield* s.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: userID,
        type: "text",
        text: "do the thing",
      } as any)
    }),
  )

  const assistantID = Identifier.ascending("message")
  const assistant = {
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    time: { created: 2 },
    parentID: userID,
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    agent: "build",
    path: { cwd: projectDir, root: projectDir },
    cost: 0,
    tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
  }

  await runSession(
    Effect.gen(function* () {
      const s = yield* service()
      yield* s.updateMessage(assistant as any)
    }),
  )

  return { session, userID, assistantID, assistant }
}

describe("v2 entry projection", () => {
  it("projects a conversation into flat entries, in conversation order", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { session, assistantID, assistant } = await conversation()

        // part ids are ascending, and the sort key is derived from them —
        // so the entries come back in the order the parts were minted
        const textPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "text",
          text: "here you go",
        }
        const toolPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "tool",
          callID: "c1",
          tool: "read",
          state: { status: "pending", input: {}, raw: "" },
        }

        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.updatePart(textPart as any)
            yield* s.updatePart(toolPart as any)
          }),
        )

        expect((await SessionV2.entries(session.id)).map((e) => e.type)).toEqual([
          "user",
          "start",
          "text",
          "tool",
        ])

        // the tool's state transitions collapse onto the one entry
        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.updatePart({
              ...toolPart,
              state: {
                status: "completed",
                input: {},
                output: "ok",
                title: "t",
                metadata: {},
                time: { start: 1, end: 2 },
              },
            } as any)
          }),
        )

        const withTool = await SessionV2.entries(session.id)
        expect(withTool.map((e) => e.type)).toEqual(["user", "start", "text", "tool"])
        const tool = withTool[3] as SessionEntryTypes.Tool
        expect(tool.state.status).toBe("completed")

        // completing the message seals the step
        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.updateMessage({
              ...assistant,
              time: { created: 2, completed: 3 },
              finish: "stop",
            } as any)
          }),
        )

        const sealed = await SessionV2.entries(session.id)
        expect(sealed.map((e) => e.type)).toEqual(["user", "start", "text", "tool", "complete"])
        const complete = sealed[4] as SessionEntryTypes.Complete
        expect(complete.finish).toBe("stop")
        expect(complete.tokens.output).toBe(2)
      },
    })
  })

  it("keeps one row and a stable id across streaming updates", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { session, assistantID } = await conversation()

        const part = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "text",
          text: "",
        }

        const ids: string[] = []
        for (const text of ["a", "ab", "abc"]) {
          await runSession(
            Effect.gen(function* () {
              const s = yield* service()
              yield* s.updatePart({ ...part, text } as any)
            }),
          )
          const entries = await SessionV2.entries(session.id)
          const streamed = entries.find((e) => e.type === "text") as SessionEntryTypes.Text
          ids.push(streamed.id)
        }

        const entries = await SessionV2.entries(session.id)
        expect(entries.filter((e) => e.type === "text")).toHaveLength(1)
        expect((entries.find((e) => e.type === "text") as SessionEntryTypes.Text).text).toBe("abc")
        // a churning id would remount the row in every consumer on every delta
        expect(new Set(ids).size).toBe(1)
      },
    })
  })

  it("removing a part drops its entry", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { session, assistantID } = await conversation()
        const partID = Identifier.ascending("part")

        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.updatePart({
              id: partID,
              sessionID: session.id,
              messageID: assistantID,
              type: "text",
              text: "regrettable",
            } as any)
          }),
        )
        expect((await SessionV2.entries(session.id)).some((e) => e.type === "text")).toBe(true)

        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.removePart({ sessionID: session.id, messageID: assistantID, partID })
          }),
        )
        expect((await SessionV2.entries(session.id)).some((e) => e.type === "text")).toBe(false)
      },
    })
  })

  it("backfills a session that predates the entry table", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { session, assistantID } = await conversation()
        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.updatePart({
              id: Identifier.ascending("part"),
              sessionID: session.id,
              messageID: assistantID,
              type: "text",
              text: "legacy",
            } as any)
          }),
        )

        const before = (await SessionV2.entries(session.id)).map((e) => e.type)
        expect(before.length).toBeGreaterThan(0)

        // simulate a session written before session_entry existed
        SessionEntryRepo.clear(session.id)
        expect(SessionV2.entryCount(session.id)).toBe(0)

        const after = await SessionV2.entries(session.id)
        expect(after.map((e) => e.type)).toEqual(before)
        // the backfill persisted, so the next read is a plain row read
        expect(SessionV2.entryCount(session.id)).toBe(after.length)
      },
    })
  })

  it("deleting a session clears its entries", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { session } = await conversation()
        expect(SessionV2.entryCount(session.id)).toBeGreaterThan(0)

        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            yield* s.remove(session.id)
          }),
        )

        expect(SessionV2.entryCount(session.id)).toBe(0)
      },
    })
  })
})

/**
 * The load-bearing invariant of the whole design: the live projection (bus →
 * `session.entry.updated`) and the persisted one (`session_entry`, written in
 * the v1 write transaction) never coordinate, and must still agree. They do
 * because entry ids are derived from the v1 ids — and because those ids are
 * also the sort key, so a client ordering by id gets the same order the server
 * serves.
 *
 * If someone ever replaces the derived ids with generated ones, this fails.
 */
describe("live and persisted projections agree", () => {
  it("a client applying only live events reconstructs exactly /v2/entries", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        SessionProjector.init()

        // A client's view: a map keyed by entry id, ordered by id — which is
        // precisely what the TUI sync store does.
        const client = new Map<string, SessionEntryTypes.Entry>()
        const unsubscribes = [
          Bus.subscribe(SessionProjector.Event.EntryUpdated, (event) => {
            const { entry } = event.properties as { entry: SessionEntryTypes.Entry }
            client.set(entry.id, entry)
          }),
          Bus.subscribe(SessionProjector.Event.EntryRemoved, (event) => {
            client.delete((event.properties as { entryID: string }).entryID)
          }),
        ]

        const { session, assistantID, assistant } = await conversation()

        const textPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "text",
          text: "",
        }
        const toolPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "tool",
          callID: "c1",
          tool: "read",
          state: { status: "pending", input: {}, raw: "" },
        }
        const doomedPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantID,
          type: "text",
          text: "removed later",
        }

        await runSession(
          Effect.gen(function* () {
            const s = yield* service()
            // a stream of deltas on one part
            for (const text of ["a", "ab", "abc"]) yield* s.updatePart({ ...textPart, text } as any)
            // a tool moving through its states
            yield* s.updatePart(toolPart as any)
            yield* s.updatePart({
              ...toolPart,
              state: { status: "running", input: { filePath: "a.ts" }, time: { start: 1 } },
            } as any)
            yield* s.updatePart({
              ...toolPart,
              state: {
                status: "completed",
                input: { filePath: "a.ts" },
                output: "ok",
                title: "a.ts",
                metadata: {},
                time: { start: 1, end: 2 },
              },
            } as any)
            // a part that appears and then goes away
            yield* s.updatePart(doomedPart as any)
            yield* s.removePart({
              sessionID: session.id,
              messageID: assistantID,
              partID: doomedPart.id,
            })
            // seal the step
            yield* s.updateMessage({ ...assistant, time: { created: 2, completed: 3 }, finish: "stop" } as any)
          }),
        )

        const persisted = await SessionV2.entries(session.id)
        // The live entry is compared in its wire form: `session.entry.updated`
        // reaches clients as JSON over SSE, and the persisted side has been
        // through the same round trip on its way into the row. Comparing the
        // in-memory object instead would fail on nothing but `k: undefined`
        // vs. absent `k`, which no client can observe.
        const live = [...client.values()]
          .filter((entry) => entry.sessionID === session.id)
          .map((entry) => JSON.parse(JSON.stringify(entry)) as SessionEntryTypes.Entry)
          .toSorted((a, b) => a.id.localeCompare(b.id))

        expect(live.map((e) => e.id)).toEqual(persisted.map((e) => e.id))
        expect(live.map((e) => e.type)).toEqual(persisted.map((e) => e.type))
        expect(live).toEqual(persisted)

        for (const unsubscribe of unsubscribes) unsubscribe()
      },
    })
  })
})
