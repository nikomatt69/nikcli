import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { MessageV2 as MessageV2Types } from "../../src/session/message-v2"

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

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

async function createSession() {
  return Session.createNext({
    directory: Instance.directory,
    title: "session lifecycle test",
  })
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

      await Session.updateMessage(msg)
      await Session.updatePart(part)

      await Session.removeMessage({ sessionID: session.id, messageID: msg.id })

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

      await Session.updateMessage(user)
      await Session.updatePart(keep)
      await Session.updatePart(remove)
      await Session.updateMessage(assistant)
      await Session.updatePart(assistantPart)
      const reverted = await Session.update(session.id, (draft) => {
        draft.revert = { messageID: user.id, partID: remove.id }
      })

      await SessionRevert.cleanup(reverted)

      const after = await MessageV2.get({ sessionID: session.id, messageID: user.id })
      expect(after.parts.map((part) => part.id)).toEqual([keep.id])
      expect(await MessageV2.parts(assistant.id)).toEqual([])
      await expect(MessageV2.get({ sessionID: session.id, messageID: assistant.id })).rejects.toThrow()
    })
  })

  it("removes stored session diffs when deleting a session", async () => {
    await withProject(async () => {
      const session = await createSession()
      await Storage.write(["session_diff", session.id], [])

      await Session.remove(session.id)

      await expect(Storage.read(["session_diff", session.id])).rejects.toThrow()
    })
  })

  it("links forked sessions to their parent session", async () => {
    await withProject(async () => {
      const session = await createSession()
      const user = userMessage(session.id)
      const assistant = assistantMessage(session.id, user.id)
      await Session.updateMessage(user)
      await Session.updatePart(textPart(session.id, user.id, "hello"))
      await Session.updateMessage(assistant)
      await Session.updatePart(textPart(session.id, assistant.id, "hi"))

      const fork = await Session.fork({ sessionID: session.id })
      const forkMessages = await Session.messages({ sessionID: fork.id })

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
      await Storage.write(["session", "other-project", foreignSessionID], {
        id: foreignSessionID,
        slug: "foreign",
        projectID: "other-project",
        directory: "/foreign",
        title: "foreign session",
        version: "test",
        time: { created: Date.now(), updated: Date.now() },
      })
      await Storage.write(["message", foreignSessionID, msg.id], msg)
      await Storage.write(["part", msg.id, Identifier.ascending("part")], textPart(foreignSessionID, msg.id, "private"))

      await expect(Session.messages({ sessionID: foreignSessionID })).rejects.toThrow()
    })
  })
})
