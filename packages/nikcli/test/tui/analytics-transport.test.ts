import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

/**
 * The analytics panel must reach the server through `sdk.client`.
 *
 * In a normal TUI run there is no listening HTTP server at all: `thread.ts`
 * sets `url = "http://nikcli.local"` and hands the SDK a worker-RPC transport
 * that dispatches straight into `Server.fetch`. A request built by hand from
 * `sdk.url` therefore resolves nothing — it fails DNS instantly, the caller
 * swallows it, and the panel silently falls back to live-sync data showing a
 * single day. Nothing fails at build time and no request is ever logged, which
 * is what made this expensive to find.
 *
 * Mounting the context would drag in the whole TUI, so read the source instead
 * (same trade as `profile-command.test.ts`).
 */
const root = fileURLToPath(new URL("../../src/", import.meta.url))

async function source(file: string) {
  return await Bun.file(root + file).text()
}

/** Comments explain the trap by name, so assert against code only. */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("analytics transport", () => {
  it("reads history through the SDK client, never a URL built by hand", async () => {
    const context = await code("cli/cmd/tui/context/analytics.tsx")

    expect(context).toContain("sdk.client.analytics.global()")
    expect(context).toContain("sdk.client.analytics.daily(")
    expect(context).toContain("sdk.client.analytics.sessions()")

    // The exact shape that broke: a request assembled from the base URL.
    expect(context).not.toMatch(/[^.]\bfetch\(`\$\{/)
    expect(context).not.toContain("sdk.url")
  })

  it("does not gate the panel on sdk.url", async () => {
    // `http://nikcli.local` is truthy, so a `!sdk.url` guard passes and then
    // every request behind it fails anyway — the guard only hid the problem.
    const dialog = await code("cli/cmd/tui/component/dialog-analytics.tsx")
    expect(dialog).not.toContain("sdk.url")
  })

  it("still asks for a full year of daily history", async () => {
    const context = await code("cli/cmd/tui/context/analytics.tsx")
    expect(context).toContain('days: "365"')
  })
})
