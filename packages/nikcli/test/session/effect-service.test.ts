import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ Session }, { locallyInstance }, { Global }, { Identifier }] = await Promise.all([
  import("@/session"),
  import("@/effect"),
  import("@nikcli-ai/util/global"),
  import("@nikcli-ai/util/id"),
])

afterAll(async () => {
  await removeTestDir(testHome)
})

describe("Session.Service", () => {
  it("uses the Effect instance context for session storage and paths", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-effect-"))
    const project = { id: `project-${path.basename(directory)}`, vcs: true } as any

    try {
      await fs.mkdir(path.join(Global.Path.data, "storage", "session", project.id), { recursive: true })
      const result = await Effect.runPromise(
        locallyInstance(
          { directory, worktree: directory, project },
          Effect.gen(function* () {
            const session = yield* Session.Service
            const created = yield* session.createNext({
              directory,
              title: "Effect service session",
            })
            const loaded = yield* session.get(created.id)
            const updated = yield* session.update(created.id, (draft) => {
              draft.title = "Updated through service"
            })
            const plan = yield* session.plan(updated)
            const messageID = Identifier.ascending("message")
            const partID = Identifier.ascending("part")
            yield* Effect.promise(() =>
              Promise.all([
                fs.mkdir(path.join(Global.Path.data, "storage", "message", created.id), { recursive: true }),
                fs.mkdir(path.join(Global.Path.data, "storage", "part", messageID), { recursive: true }),
              ]),
            )
            const message = yield* session.updateMessage({
              id: messageID,
              sessionID: created.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test-model" },
            })
            const part = yield* session.updatePart({
              id: partID,
              sessionID: created.id,
              messageID,
              type: "text",
              text: "hello",
            })
            const messages = yield* session.messages({ sessionID: created.id })
            const removedPart = yield* session.removePart({ sessionID: created.id, messageID, partID })
            const removedMessage = yield* session.removeMessage({ sessionID: created.id, messageID })

            yield* session.remove(created.id)

            return { created, loaded, updated, plan, message, part, messages, removedPart, removedMessage }
          }).pipe(Effect.provide(Session.defaultLayer)),
        ),
      )

      expect(result.created.projectID).toBe(project.id)
      expect(result.loaded.id).toBe(result.created.id)
      expect(result.updated.title).toBe("Updated through service")
      expect(result.plan).toContain(path.join(directory, ".nikcli", "plans"))
      expect(result.message.id).toBe(result.removedMessage)
      expect(result.part.id).toBe(result.removedPart)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]?.parts).toHaveLength(1)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
