import { describe, expect, it } from "bun:test"
import { pathToFileURL } from "node:url"
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

      // resolvePromptParts echoes the original template as a text part and
      // appends a file part per `@name` reference. The expected URL mirrors
      // the resolver's own `pathToFileURL(path.resolve(worktree, name)).href`
      // construction exactly (using `path.resolve` rather than `path.join`)
      // so the assertion stays in lock-step with the implementation across
      // platforms — Bun's `pathToFileURL` on Windows differs from Node's
      // (it preserves native separators instead of emitting RFC-3986
      // forward-slashes), and only `path.resolve` guarantees that the input
      // string the test hands to `pathToFileURL` is byte-identical to the
      // one the resolver built.
      expect(parts).toContainEqual({
        type: "text",
        text: "read @notes.md",
      })
      expect(parts).toContainEqual({
        type: "file",
        url: pathToFileURL(path.resolve(directory, "notes.md")).href,
        filename: "notes.md",
        mime: "text/plain",
      })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
