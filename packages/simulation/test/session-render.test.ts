import { expect, test } from "bun:test"
import { join } from "node:path"
import { start, normalize, type Harness } from "./helpers/harness"

/**
 * Golden screens for the session renderer.
 *
 * The TUI still draws from v1 messages and parts while every other client is
 * on v2 entries. Converting it is mechanical (see
 * `routes/session/view.ts`), but a paint regression is user-visible and
 * invisible to the unit suite — the smoke test only asserts that *something*
 * was painted.
 *
 * So this captures what the real TUI actually renders, as text, for a corpus
 * of conversations. Text rather than PNG on purpose: the failure of a render
 * refactor should be a readable diff, not "the hashes differ".
 *
 * Regenerate with `UPDATE_GOLDENS=1 bun test test/session-render.test.ts`,
 * and *read the diff* before committing it — that is the entire value.
 */

const goldens = new URL("./fixtures/render/", import.meta.url).pathname

async function check(name: string, screen: string) {
  const file = join(goldens, `${name}.txt`)
  const actual = normalize(screen)

  if (process.env.UPDATE_GOLDENS === "1") {
    await Bun.write(file, actual + "\n")
    return
  }

  const golden = Bun.file(file)
  expect(await golden.exists()).toBe(true)
  expect(actual).toBe((await golden.text()).trimEnd())
}

/** Settle so a still-streaming frame can never be what gets captured. */
async function settled(h: Harness, marker: string) {
  await h.waitFor(marker)
  await Bun.sleep(600)
  return h.screen()
}

test(
  "renders a single assistant turn",
  async () => {
    const h = await start()
    try {
      await h.send("what is this")
      await h.respond([{ type: "textDelta", text: "A deterministic answer." }])
      await check("single-turn", await settled(h, "A deterministic answer."))
    } finally {
      await h.close()
    }
  },
  120_000,
)

test(
  "renders a multi-paragraph reply with a list and code",
  async () => {
    const h = await start()
    try {
      await h.send("explain")
      await h.respond([
        {
          type: "textDelta",
          text: [
            "First paragraph of the answer.",
            "",
            "- one",
            "- two",
            "- three",
            "",
            "```ts",
            "const answer = 42",
            "```",
            "",
            "Closing line.",
          ].join("\n"),
        },
      ])
      await check("multi-paragraph", await settled(h, "Closing line."))
    } finally {
      await h.close()
    }
  },
  120_000,
)

test(
  "renders two turns, which is where the turn boundary shows",
  async () => {
    const h = await start()
    try {
      await h.send("first question")
      await h.respond([{ type: "textDelta", text: "First answer." }])
      await h.waitFor("First answer.")

      await h.send("second question")
      await h.respond([{ type: "textDelta", text: "Second answer." }])
      await check("two-turns", await settled(h, "Second answer."))
    } finally {
      await h.close()
    }
  },
  120_000,
)

/**
 * Tool rendering is where the risk of a renderer conversion is concentrated:
 * ~30 tool-specific components hang off `ToolPart`. Fixtures are written into
 * the project so paths render short and relative — an absolute temp path
 * wraps across lines, and the wrapped tail escapes normalization.
 */
test(
  "renders a run of tool calls",
  async () => {
    const h = await start()
    try {
      for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) {
        await Bun.write(join(h.projectDir, name), `${name}\n`)
      }
      await h.send("read them")
      await h.respond(
        [
          { type: "toolCall", index: 0, id: "c1", name: "read", input: { filePath: "alpha.txt" } },
          { type: "toolCall", index: 1, id: "c2", name: "read", input: { filePath: "beta.txt" } },
          { type: "toolCall", index: 2, id: "c3", name: "read", input: { filePath: "gamma.txt" } },
        ],
        "tool-calls",
      )
      await check("tool-run", await settled(h, "Done."))
    } finally {
      await h.close()
    }
  },
  120_000,
)

/**
 * The same run with exploration grouping on — the `groupParts` path, which is
 * the one module already ported to accept entries as well as parts. Without
 * this scenario that port would have no render-level guard at all.
 */
test(
  "folds a finished exploration run into one row",
  async () => {
    const h = await start({ experimental: { tui: { explorationGrouping: true } } })
    try {
      for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) {
        await Bun.write(join(h.projectDir, name), `${name}\n`)
      }
      await h.send("read them")
      await h.respond(
        [
          { type: "toolCall", index: 0, id: "c1", name: "read", input: { filePath: "alpha.txt" } },
          { type: "toolCall", index: 1, id: "c2", name: "read", input: { filePath: "beta.txt" } },
          { type: "toolCall", index: 2, id: "c3", name: "read", input: { filePath: "gamma.txt" } },
        ],
        "tool-calls",
      )
      const screen = await settled(h, "Done.")
      expect(normalize(screen)).toContain("Explored 3 locations")
      await check("tool-run-grouped", screen)
    } finally {
      await h.close()
    }
  },
  120_000,
)
