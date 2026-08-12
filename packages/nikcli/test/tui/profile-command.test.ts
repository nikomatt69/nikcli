import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

/**
 * `/profile` stays reachable.
 *
 * The dialog is lazily imported by name from `app.tsx`, so a rename or a moved
 * file breaks the command at runtime with nothing failing at build time. Reading
 * the source is the cheap way to catch that — mounting the dialog would drag in
 * the whole TUI (see `entry-coverage.test.ts` for the same trade).
 */
const root = fileURLToPath(new URL("../../src/", import.meta.url))

async function source(file: string) {
  return await Bun.file(root + file).text()
}

describe("profile command", () => {
  it("is registered with its slash names and lazily loads the dialog", async () => {
    const app = await source("cli/cmd/tui/app.tsx")

    expect(app).toContain('value: "account.profile"')
    expect(app).toContain('name: "profile"')
    expect(app).toContain('aliases: ["me", "personalize"]')
    expect(app).toContain('import("@tui/component/dialog-profile")')
  })

  it("resolves to an exported dialog", async () => {
    const dialog = await source("cli/cmd/tui/component/dialog-profile.tsx")
    expect(dialog).toContain("export function DialogProfile()")
  })

  it("keeps the profile in the system prompt parts every session builds", async () => {
    const prompt = await source("session/prompt.ts")
    expect(prompt).toContain("systemPrompt.profile()")
    // Last, so instruction files and the user's own message outrank it.
    expect(prompt).toMatch(/system: \[\.\.\.environment, \.\.\.custom, \.\.\.profile\]/)
  })
})
