import { describe, expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import { SessionPrompt } from "@/session/prompt";
import { locallyInstance } from "@/effect";
import { Effect } from "effect";
import fs from "fs/promises";
import os from "os";
import path from "path";

describe("SessionPrompt.Service", () => {
  it("resolves file prompt parts from the Effect instance context", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "nikcli-session-prompt-effect-"),
    );

    try {
      await fs.writeFile(path.join(directory, "notes.md"), "context");

      const parts = await Effect.runPromise(
        locallyInstance(
          { directory, worktree: directory, project: { id: "test" } as any },
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service;
            yield* prompt.assertNotBusy("ses_prompt_effect");
            return yield* prompt.resolvePromptParts("read @notes.md");
          }).pipe(Effect.provide(SessionPrompt.defaultLayer)),
        ),
      );

      // resolvePromptParts echoes the original template as a text part and
      // appends a file part per `@name` reference. Build the expected URL via
      // pathToFileURL so the assertion holds on Windows (where
      // `file://${path.join(...)}` would produce backslashes and miss the
      // RFC-8089 percent-encoded username).
      expect(parts).toContainEqual({
        type: "text",
        text: "read @notes.md",
      });
      expect(parts).toContainEqual({
        type: "file",
        url: pathToFileURL(path.join(directory, "notes.md")).href,
        filename: "notes.md",
        mime: "text/plain",
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
