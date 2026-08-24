import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"
import type { MessageV2 as MessageV2Types } from "../../src/session/message-v2"
import { Cause, Effect, Layer } from "effect"
import { runPromiseExitWithLayer, runPromiseWithLayer, withCurrentInstance } from "../../src/effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [
  { Identifier },
  { Instance },
  { MessageV2 },
  { Session },
  { SessionError },
  { SessionRevert },
  { ShareRepo },
  { SessionDiffRepo },
  { Global },
] = await Promise.all([
  import("@nikcli-ai/util/id"),
  import("../../src/project/instance"),
  import("../../src/session/message-v2"),
  import("../../src/session"),
  import("../../src/session/error"),
  import("../../src/session/revert"),
  import("../../src/share/repo"),
  import("../../src/session/diff-repo"),
  import("@nikcli-ai/util/global"),
])

const projectDirs: string[] = []

function runRevert<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(SessionRevert.defaultLayer, withCurrentInstance(effect))
}

function runRevertExit<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseExitWithLayer(SessionRevert.defaultLayer, withCurrentInstance(effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

async function writeLeftoverJson(key: string[], content: unknown) {
  const file = path.join(Global.Path.data, "storage", ...key) + ".json"
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(content))
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
  await removeTestDir(testHome)
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
          yield* sessionService.removeMessage({
            sessionID: session.id,
            messageID: msg.id,
          })
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

      const after = await MessageV2.get({
        sessionID: session.id,
        messageID: user.id,
      })
      expect(after.parts.map((part) => part.id)).toEqual([keep.id])
      expect(await MessageV2.parts(assistant.id)).toEqual([])
      await expect(MessageV2.get({ sessionID: session.id, messageID: assistant.id })).rejects.toThrow()
    })
  })

  it("removes stored session diffs when deleting a session", async () => {
    await withProject(async () => {
      const session = await createSession()
      SessionDiffRepo.upsert(session.id, [
        {
          file: "src/a.ts",
          patch: "@@ -0,0 +1 @@\n+hello",
          additions: 1,
          deletions: 0,
          before: "",
          after: "hello",
        },
      ])
      expect(SessionDiffRepo.get(session.id)).toHaveLength(1)

      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.remove(session.id)
        }),
      )

      expect(SessionDiffRepo.get(session.id)).toEqual([])
    })
  })

  it("getShare reads SQL and ignores leftover session_share JSON", async () => {
    await withProject(async () => {
      const session = await createSession()
      await writeLeftoverJson(["session_share", session.id], {
        url: "http://json-trap/share",
        mode: "local",
        id: "share_json_trap",
      })
      ShareRepo.put(session.id, {
        url: "http://sql/share",
        mode: "local",
        id: "share_sql",
      })

      const share = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.getShare(session.id)
        }),
      )
      expect(share.url).toBe("http://sql/share")
      expect(share.id).toBe("share_sql")
    })
  })

  it("getShare throws SessionNotFoundError when the share row is missing", async () => {
    await withProject(async () => {
      const session = await createSession()
      await expect(
        runSession(
          Effect.gen(function* () {
            const sessionService = yield* Session.Service
            return yield* sessionService.getShare(session.id)
          }),
        ),
      ).rejects.toBeInstanceOf(SessionError.NotFoundError)
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
          const forkMessages = yield* sessionService.messages({
            sessionID: fork.id,
          })
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

  it("does not read session or message rows from the JSON tree", async () => {
    await withProject(async () => {
      const missingID = Identifier.descending("session")
      const msg = userMessage(missingID)
      // Sessions and messages live in SQL. These JSON files are a trap: a
      // read-through fallback would resurrect the two-model problem the
      // move is meant to end (specs/storage/remove-json-storage.md).
      await writeLeftoverJson(["session", "other-project", missingID], {
        id: missingID,
        slug: "foreign",
        projectID: "other-project",
        directory: "/foreign",
        title: "foreign session",
        version: "test",
        time: { created: Date.now(), updated: Date.now() },
      })
      await writeLeftoverJson(["message", missingID, msg.id], msg)
      await writeLeftoverJson(["part", msg.id, Identifier.ascending("part")], textPart(missingID, msg.id, "private"))

      await expect(
        runSession(
          Effect.gen(function* () {
            const sessionService = yield* Session.Service
            return yield* sessionService.messages({ sessionID: missingID })
          }),
        ),
      ).rejects.toBeInstanceOf(SessionError.NotFoundError)
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

  // E5.1 — pin the channel before changing it. The revert / summary adapters
  // currently wrap their implementations in `Effect.tryPromise(() => …)` with
  // no rejection mapping. A missing session therefore surfaces as a generic
  // defect, not as the typed `Session.NotFoundError` the service exposes.
  // These assertions inspect `Exit` / `Cause` to prove whether the failure
  // is a typed fail or an untyped die. They fail today against the untyped
  // adapters and go green after E5.2 supplies an explicit `catch`.
  describe("E5.1 typed failure channel", () => {
    it("SessionRevert.revert rejects with SessionNotFoundError on a typed failure channel", async () => {
      await withProject(async () => {
        const missingID = Identifier.descending("session")
        const exit = await runRevertExit(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            return yield* revert.revert({
              sessionID: missingID,
              messageID: "msg_does_not_exist",
            })
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        // `Cause.squash` reads through both channels; `hasDies` is what
        // separates a typed `Effect.fail` from an `Effect.die`.
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionError.NotFoundError)
      })
    })

    it("SessionRevert.unrevert rejects with SessionNotFoundError on a typed failure channel", async () => {
      await withProject(async () => {
        const missingID = Identifier.descending("session")
        const exit = await runRevertExit(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            return yield* revert.unrevert({ sessionID: missingID })
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        // `Cause.squash` reads through both channels; `hasDies` is what
        // separates a typed `Effect.fail` from an `Effect.die`.
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionError.NotFoundError)
      })
    })

    it("SessionRevert.revert rejects with SessionBusyError on a typed failure channel", async () => {
      await withProject(async () => {
        const { PromptState } = await import("../../src/session/prompt-state")
        const session = await createSession()
        // Reserving the session is what `SessionPrompt.assertNotBusy` reads;
        // a busy revert must reach the caller as `Session.BusyError` on the
        // failure channel, not as a defect the HTTP boundary has to recover.
        PromptState.reserve(session.id)
        const exit = await runRevertExit(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            return yield* revert.revert({
              sessionID: session.id,
              messageID: "msg_does_not_exist",
            })
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Session.BusyError)
      })
    })

    it("SessionSummary.diff rejects with SessionNotFoundError on a typed failure channel", async () => {
      await withProject(async () => {
        const { SessionSummary } = await import("../../src/session/summary")
        const missingID = Identifier.descending("session")
        // SessionSummary.defaultLayer provides SessionSummary.Service only;
        // Session.Service must be in the same layer stack for `diff` to
        // resolve a missing session on the typed channel.
        const exit = await runPromiseExitWithLayer(
          Layer.merge(SessionSummary.defaultLayer, Session.defaultLayer),
          withCurrentInstance(
            Effect.gen(function* () {
              const summary = yield* SessionSummary.Service
              return yield* summary.diff({ sessionID: missingID })
            }),
          ),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        // `Cause.squash` reads through both channels; `hasDies` is what
        // separates a typed `Effect.fail` from an `Effect.die`.
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionError.NotFoundError)
      })
    })
  })
})
