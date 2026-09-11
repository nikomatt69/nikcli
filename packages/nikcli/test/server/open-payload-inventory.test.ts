import { describe, expect, it } from "bun:test"
import { SRC, stripComments } from "../tui/tui-source"

/**
 * The open-payload inventory EOT-10 owes, as a ceiling.
 *
 * `specs/README.md` §Open Payloads: only genuine opaque passthroughs,
 * polymorphic event payloads, SSE frames, or bodyless redirects may use
 * `Schema.Unknown`. An ordinary domain success object may not, and neither may
 * a schema that was widened to make response encoding or generated-client
 * validation pass.
 *
 * This does not claim the 48 below are all justified — auditing them is the
 * rest of EOT-10's work, and that audit is what lowers these numbers. What it
 * does is stop the count growing while the audit is outstanding, per file, so a
 * new widening has to be argued for in review rather than blending into a
 * repository-wide total.
 *
 * Counted over code only: a comment naming `Schema.Unknown` to explain why one
 * is there is the opposite of a violation.
 */

const HTTPAPI = SRC + "server/httpapi/"

/** Recorded 2026-09-12. Lower a number when an audit removes a widening; do not raise one. */
const BASELINE: Record<string, number> = {
  "session.ts": 9,
  "tui.ts": 7,
  "mobile.ts": 5,
  "sync.ts": 5,
  "contract-extra.ts": 4,
  "config.ts": 3,
  "workspace.ts": 2,
  "pty.ts": 2,
  "loop.ts": 2,
  "mission.ts": 2,
  "top-level.ts": 2,
  "app.ts": 1,
  "discord.ts": 1,
  "permission.ts": 1,
  "experimental.ts": 1,
  "connectors.ts": 1,
}

const OPEN_PAYLOAD = /Schema\.(Unknown|Any)\b/g

async function inventory() {
  const counts: Record<string, number> = {}
  let scanned = 0

  for await (const relative of new Bun.Glob("**/*.ts").scan({ cwd: HTTPAPI })) {
    scanned++
    const text = stripComments(await Bun.file(HTTPAPI + relative).text())
    const matches = text.match(OPEN_PAYLOAD)
    if (matches) counts[relative] = matches.length
  }

  return { counts, scanned }
}

describe("httpapi open payloads", () => {
  it("scanned the httpapi tree", async () => {
    const { scanned } = await inventory()
    expect(scanned).toBeGreaterThan(20)
  })

  it("does not widen a new response schema", async () => {
    const { counts } = await inventory()

    const grown = Object.entries(counts)
      .filter(([file, count]) => count > (BASELINE[file] ?? 0))
      .map(([file, count]) => `${file}: ${BASELINE[file] ?? 0} -> ${count}`)

    expect(
      grown,
      grown.length === 0
        ? ""
        : `New Schema.Unknown/Schema.Any in httpapi response or payload schemas.\n` +
            `Only opaque passthrough, polymorphic events, SSE frames and bodyless redirects qualify — see\n` +
            `specs/README.md §Open Payloads. If this one does, raise the baseline in the same change and say why:\n  ` +
            grown.join("\n  "),
    ).toEqual([])
  })

  it("has no stale baseline entries", async () => {
    const { counts } = await inventory()

    // A file that dropped to zero should leave the baseline, so the number
    // keeps meaning "what is still outstanding".
    const stale = Object.keys(BASELINE).filter((file) => (counts[file] ?? 0) === 0)
    expect(stale).toEqual([])
  })
})
