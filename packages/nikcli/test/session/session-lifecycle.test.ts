import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { MessageV2 as MessageV2Types } from "../../src/session/message-v2"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const [{ Identifier }, { Instance }, { MessageV2 }, { Session }, { SessionRevert }, { Storage }] = await Promise.all([
  import("../../src/id/id"),
  import("../../src/project/instance"),
  import("../../src/session/message-v2"),
  import("../../src/session"),
  import("../../src/session/revert"),
  import("../../src/storage/storage"),
])

const projectDirs: string[] = []

function runRevert<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(SessionRevert.defaultLayer, withCurrentInstance(effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runStorage<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

function storageWrite<T>(key: string[], content: T) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(key, content)
    }),
  )
}

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

async function createSession() {
  return runSession(
    Effect.gen(function* () {
      const session = yield* Session.Service
      return yield* session.createNext({
        directory: Instance.directory,
        title: "session lifecycle test",
      })
    }),
  )
}

function userMessage(sessionID: string): MessageV2Types.User {
  return {
    id: Identifier.ascending("message"),
    role: "user",
    sessionID,
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function assistantMessage(sessionID: string, parentID: string): MessageV2Types.Assistant {
  return {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID,
    parentID,
    modelID: "test",
    providerID: "test",
    mode: "build",
    agent: "build",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }
}

function textPart(sessionID: string, messageID: string, text: string): MessageV2Types.TextPart {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "text",
    text,
  }
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("session lifecycle", () => {
  it("removes parts when removing a message", async () => {
    await withProject(async () => {
      const session = await createSession()
      const msg = userMessage(session.id)
      const part = textPart(session.id, msg.id, "hello")

      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.updateMessage(msg)
          yield* sessionService.updatePart(part)
        }),
      )

      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.removeMessage({ sessionID: session.id, messageID: msg.id })
        }),
      )

      expect(await MessageV2.parts(msg.id)).toEqual([])
      await expect(MessageV2.get({ sessionID: session.id, messageID: msg.id })).rejects.toThrow()
    })
  })

  it("cleans up partial revert without deleting the target message", async () => {
    await withProject(async () => {
      const session = await createSession()
      const user = userMessage(session.id)
      const keep = textPart(session.id, user.id, "keep")
      const remove = textPart(session.id, user.id, "remove")
      const assistant = assistantMessage(session.id, user.id)
      const assistantPart = textPart(session.id, assistant.id, "assistant")

      const reverted = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.updateMessage(user)
          yield* sessionService.updatePart(keep)
          yield* sessionService.updatePart(remove)
          yield* sessionService.updateMessage(assistant)
          yield* sessionService.updatePart(assistantPart)
          return yield* sessionService.update(session.id, (draft) => {
            draft.revert = { messageID: user.id, partID: remove.id }
          })
        }),
      )

      await runRevert(
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          yield* revert.cleanup(reverted)
        }),
      )

      const after = await MessageV2.get({ sessionID: session.id, messageID: user.id })
      expect(after.parts.map((part) => part.id)).toEqual([keep.id])
      expect(await MessageV2.parts(assistant.id)).toEqual([])
      await expect(MessageV2.get({ sessionID: session.id, messageID: assistant.id })).rejects.toThrow()
    })
  })

  it("removes stored session diffs when deleting a session", async () => {
    await withProject(async () => {
      const session = await createSession()
      await storageWrite(["session_diff", session.id], [])

      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.remove(session.id)
        }),
      )

      await expect(storageRead(["session_diff", session.id])).rejects.toThrow()
    })
  })

  it("links forked sessions to their parent session", async () => {
    await withProject(async () => {
      const session = await createSession()
      const user = userMessage(session.id)
      const assistant = assistantMessage(session.id, user.id)
      const { fork, forkMessages } = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.updateMessage(user)
          yield* sessionService.updatePart(textPart(session.id, user.id, "hello"))
          yield* sessionService.updateMessage(assistant)
          yield* sessionService.updatePart(textPart(session.id, assistant.id, "hi"))
          const fork = yield* sessionService.fork({ sessionID: session.id })
          const forkMessages = yield* sessionService.messages({ sessionID: fork.id })
          return { fork, forkMessages }
        }),
      )

      expect(fork.parentID).toBe(session.id)
      expect(forkMessages).toHaveLength(2)
      expect(forkMessages[1].info.role).toBe("assistant")
      if (forkMessages[1].info.role === "assistant") {
        expect(forkMessages[1].info.parentID).toBe(forkMessages[0].info.id)
      }
    })
  })

  it("does not read messages for sessions outside the current project", async () => {
    await withProject(async () => {
      const foreignSessionID = Identifier.descending("session")
      const msg = userMessage(foreignSessionID)
      await storageWrite(["session", "other-project", foreignSessionID], {
        id: foreignSessionID,
        slug: "foreign",
        projectID: "other-project",
        directory: "/foreign",
        title: "foreign session",
        version: "test",
        time: { created: Date.now(), updated: Date.now() },
      })
      await storageWrite(["message", foreignSessionID, msg.id], msg)
      await storageWrite(["part", msg.id, Identifier.ascending("part")], textPart(foreignSessionID, msg.id, "private"))

      await expect(
        runSession(
          Effect.gen(function* () {
            const sessionService = yield* Session.Service
            return yield* sessionService.messages({ sessionID: foreignSessionID })
          }),
        ),
      ).rejects.toThrow()
    })
  })

  it("archives and unarchives a session", async () => {
    await withProject(async () => {
      const session = await createSession()
      const now = Date.now()

      // Archive the session
      const archived = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.update(session.id, (draft) => {
            draft.time.archived = now
          })
        }),
      )

      expect(archived.time.archived).toBe(now)

      // Unarchive by removing the archived timestamp
      const unarchived = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.update(session.id, (draft) => {
            draft.time.archived = undefined
          })
        }),
      )

      expect(unarchived.time.archived).toBeUndefined()
    })
  })
})
