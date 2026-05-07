import { describe, expect, it } from "bun:test"
import { SessionPrompt } from "@/session/prompt"
import { locallyInstance } from "@/effect"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("SessionPrompt.Service", () => {
  it("resolves file prompt parts from the Effect instance context", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-prompt-effect-"))

    try {
      await fs.writeFile(path.join(directory, "notes.md"), "context")

      const parts = await Effect.runPromise(
        locallyInstance(
          { directory, worktree: directory, project: { id: "test" } as any },
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            yield* prompt.assertNotBusy("ses_prompt_effect")
            return yield* prompt.resolvePromptParts("read @notes.md")
          }).pipe(Effect.provide(SessionPrompt.defaultLayer)),
        ),
      )

      expect(parts).toContainEqual({
        type: "file",
        url: `file://${path.join(directory, "notes.md")}`,
        filename: "notes.md",
        mime: "text/plain",
      })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
