import { describe, expect, test } from "bun:test"
import { tuiSource } from "./tui-source"

/**
 * Routes without a sessionID in the path cannot be workspace-resolved by the
 * server: `ServerRouter.context` derives the workspace from `sessionForRequest`
 * only when the path carries a session, otherwise it needs the
 * `x-nikcli-workspace` header that `scopedClient()` sets. Fetching those routes
 * through the unscoped client answers for the root instance, which silently
 * overwrites a worktree's state with another workspace's.
 */
describe("sync fetches workspace-scoped routes through the scoped client", () => {
  test("lsp status is never fetched through the unscoped client", async () => {
    const src = await tuiSource("context/sync.tsx")
    // Calls only — `typeof sdk.client.lsp.status` is a type position and fine.
    expect(src).not.toMatch(/sdk\.client\s*\.\s*lsp\s*\.?\s*status\(\)/)
    expect(src).toMatch(/scopedClient\(\)\s*\.?\s*lsp\s*\.\s*status\(\)/)
  })

  test("provider refresh uses the same client bootstrap does", async () => {
    // A worktree can carry its own nikcli.json, so its provider list is not
    // necessarily the root's.
    const src = await tuiSource("context/sync.tsx")
    expect(src).not.toMatch(/sdk\.client\.config\.providers/)
    expect(src).not.toMatch(/sdk\.client\.provider\.list/)
    expect(src).not.toMatch(/sdk\.client\.provider\.auth/)
  })

  test("the scoped client resolves the workspace when it is called, not once at init", async () => {
    // Capturing a client at context creation would pin the workspace that was
    // active then and keep answering for it after a switch.
    const src = await tuiSource("context/sync.tsx")
    expect(src).toMatch(/function scopedClient\(\)/)
    expect(src).toMatch(/const workspace = project\.workspace\.current\(\)/)
  })

  test("session routes may stay unscoped because the server derives them", async () => {
    // Not an oversight: `/session/:id` carries the id, and the router looks the
    // workspace up from it. Scoping those too would be harmless but this test
    // records why they differ, so nobody "fixes" them into inconsistency.
    const src = await tuiSource("context/sync.tsx")
    expect(src).toMatch(/sdk\.client\.session\.(get|messages|diff)/)
  })
})
