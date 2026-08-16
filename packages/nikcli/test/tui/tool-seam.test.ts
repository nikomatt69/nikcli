import { describe, expect, it } from "bun:test"
import { stripComments, tuiSource } from "./tui-source"

/**
 * The session view renders tool calls from what the wire carries, not from the server's tool
 * definitions.
 *
 * It used to import 17 backend tool modules to type `input` and `metadata`. Those imports were
 * `import type`, so they cost nothing at runtime and nothing failed — they simply pinned the
 * terminal app to the server's module graph, which is what `specs/tui-package.md` §2 removes.
 * The shapes now live in `@tui/util/tool-shapes`, declared from what the renderers read.
 *
 * Mounting the view would drag in the whole TUI, so read the source instead (same trade as
 * `analytics-transport.test.ts`).
 */
async function code(file: string) {
  return stripComments(await tuiSource(file))
}

describe("tool rendering seam", () => {
  it("types tool parts from local shapes, not from the tool implementations", async () => {
    const view = await code("routes/session/tool-view.tsx")

    expect(view).toContain("@tui/util/tool-shapes")
    // Any `@/tool/<name>` at all means a renderer went back to the server for its types. Adding a
    // tool renderer means adding a shape, not an import. The viz catalog was the last one out —
    // it is a contract between the tool and the terminal, so it lives in @nikcli-ai/util/viz.
    const backendTools = [...view.matchAll(/from "@\/tool\/([^"]+)"/g)].map((match) => match[1])

    expect(backendTools).toEqual([])
  })

  it("renders diagnostics without importing the LSP module", async () => {
    const view = await code("routes/session/tool-view.tsx")

    expect(view).toContain("diagnosticMessage(")
    expect(view).not.toMatch(/from "@\/lsp"/)
  })

  it("keeps every rendered field optional", async () => {
    // The view draws half-streamed arguments and payloads from servers of other versions. A
    // required field here would be a lie the renderer cannot check.
    const shapes = await code("util/tool-shapes.ts")
    const fields = [...shapes.matchAll(/^\s{2}(\w+)(\??):/gm)]
    const required = fields.filter(([, name, optional]) => optional !== "?" && name !== "range")

    // The exceptions are entries that only exist once a tool finished (`PatchedFile`,
    // `TodoEntry`, `AskedQuestion`, a diagnostic's `message`) and the two carrier fields.
    expect(required.map(([, name]) => name).sort()).toEqual(
      [
        "type",
        "relativePath",
        "filePath",
        "deletions",
        "diff",
        "status",
        "content",
        "question",
        "input",
        "metadata",
        "message",
      ].sort(),
    )
  })
})
