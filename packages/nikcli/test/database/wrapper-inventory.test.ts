import { describe, expect, it } from "bun:test"
import { SRC, stripComments } from "../tui/tui-source"

/**
 * The gate for `specs/storage/retire-database-wrapper.md`.
 *
 * That document plans the removal of the synchronous `Database` surface and
 * sequences it by group. A plan with a number in it and no check is a number
 * that drifts, so this asserts the direction of travel: the count may fall, and
 * may not rise.
 *
 * When a group lands, lower the baseline in the same change. When a new call
 * site is genuinely required, raise it deliberately and say why — do not widen
 * the tolerance.
 */

/**
 * Recorded 2026-09-11 after group 1 landed.
 *
 * Counted over code only — `stripComments` first — because the comments in
 * `database.ts` name the APIs they are explaining, and a doc comment is not a
 * call site. Before stripping, the removal of `effect` and `use` read as no
 * change at all.
 */
const BASELINE = {
  references: 90,
  files: 39,
  /** Group 1 removed both: the post-commit queue is handed to the transaction body. */
  effect: 0,
  use: 0,
  syncNative: 2,
} as const

const API = /Database\.[A-Za-z]+/g

async function scan() {
  const counts = new Map<string, number>()
  let references = 0
  const files = new Set<string>()

  for await (const relative of new Bun.Glob("**/*.ts").scan({ cwd: SRC })) {
    const text = stripComments(await Bun.file(SRC + relative).text())
    const matches = text.match(API)
    if (!matches) continue
    files.add(relative)
    references += matches.length
    for (const match of matches) {
      const name = match.slice("Database.".length)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  return { references, files, counts }
}

describe("Database wrapper inventory", () => {
  it("scanned a plausible source tree", async () => {
    // A glob over a cwd that no longer exists yields nothing, which would make
    // every assertion below pass vacuously. Same trap tui-source.ts documents.
    const { files } = await scan()
    expect(files.size).toBeGreaterThan(10)
  })

  it("does not grow past the recorded baseline", async () => {
    const { references, files } = await scan()

    expect(references).toBeLessThanOrEqual(BASELINE.references)
    expect(files.size).toBeLessThanOrEqual(BASELINE.files)
  })

  it("has no ambient transaction context left", async () => {
    const { counts } = await scan()

    // Group 1 landed. `Database.effect` and `Database.use` are gone: a
    // post-commit effect is queued through the `ctx` the transaction body
    // receives, and reads go through `syncDb()` directly. Reintroducing either
    // brings the module-level queue back with it.
    expect(counts.get("effect") ?? 0).toBe(BASELINE.effect)
    expect(counts.get("use") ?? 0).toBe(BASELINE.use)
  })

  it("keeps raw-SQL access to the two analytics callers", async () => {
    const { counts } = await scan()

    // `syncNative` is documented as admin/debug only. Group 2 decides whether
    // those two queries move onto Drizzle or earn a named accessor.
    expect(counts.get("syncNative") ?? 0).toBeLessThanOrEqual(BASELINE.syncNative)
  })
})
