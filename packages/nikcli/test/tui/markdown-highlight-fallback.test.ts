import { describe, expect, it } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { MarkdownRenderable, SyntaxStyle, getTreeSitterClient } from "@opentui/core"

/**
 * Guards the `@opentui/core` patch in `patches/@opentui%2Fcore@0.4.5.patch`.
 *
 * A markdown block is a `CodeRenderable` that tree-sitter highlights
 * asynchronously, and `###` only disappears because the highlight carries the
 * conceal capture. Upstream, a re-highlight that comes back with no captures
 * drops the block to plain text — the block flips from a styled heading to raw
 * `### …` in the default colour and back, which is the flicker at the bottom of
 * a live response. `_lastHighlights` was already being recorded for exactly
 * this and never read; the patch reads it back when the empty result is for
 * content that has not changed.
 */
describe("markdown highlight fallback", () => {
  const heading = "### d) Index + read API (session/v2/index.ts)"

  async function mount() {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 20 })
    const syntaxStyle = SyntaxStyle.fromTheme([
      { scope: ["default"], style: { foreground: "#cccccc" } },
      { scope: ["markup.heading"], style: { foreground: "#ffcc00", bold: true } },
      { scope: ["conceal"], style: { foreground: "#666666" } },
    ])

    const client = getTreeSitterClient()
    const real = client.highlightOnce.bind(client)
    let starved = false
    ;(client as unknown as { highlightOnce: unknown }).highlightOnce = async (content: string, filetype: string) =>
      starved ? { highlights: [] } : real(content, filetype)

    const md = new MarkdownRenderable(renderer as never, {
      id: "md",
      content: "",
      syntaxStyle,
      conceal: true,
      concealCode: false,
      streaming: true,
      internalBlockMode: "top-level",
      treeSitterClient: client,
    })
    renderer.root.add(md)

    // The first highlight has to load the markdown grammar, which takes an
    // order of magnitude longer than the ones after it.
    const settle = async (until?: () => boolean) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        renderOnce()
        await new Promise((resolve) => setTimeout(resolve, 25))
        renderOnce()
        if (!until || until()) return
      }
    }

    return {
      md,
      settle,
      captureCharFrame,
      starve: (value: boolean) => {
        starved = value
      },
      restore: () => {
        ;(client as unknown as { highlightOnce: unknown }).highlightOnce = real
      },
    }
  }

  it("keeps the heading styled when a re-highlight of unchanged content comes back empty", async () => {
    const { md, settle, captureCharFrame, starve, restore } = await mount()
    try {
      md.content = `${heading}\nbody text here\n`
      const headingBlock = () =>
        (md as never as { _blockStates: { token: { type: string }; renderable: unknown }[] })._blockStates.find(
          (state) => state.token?.type === "heading",
        )?.renderable as { initialStyledText: unknown; _lastHighlights?: unknown[] } | undefined
      await settle(() => (headingBlock()?._lastHighlights?.length ?? 0) > 0)

      const block = headingBlock()!
      expect(block._lastHighlights!.length).toBeGreaterThan(0)
      expect(captureCharFrame()).not.toContain(heading)

      // Re-highlight the block without touching its content — the path
      // `MarkdownRenderable` takes when it re-applies a block whose raw text is
      // unchanged. Starved, upstream would flatten it to raw markdown.
      starve(true)
      block.initialStyledText = undefined
      await settle()

      expect(captureCharFrame()).not.toContain(heading)
    } finally {
      restore()
    }
  })

  it("still falls back to plain text when the content itself changed", async () => {
    const { md, settle, captureCharFrame, starve, restore } = await mount()
    try {
      md.content = `${heading}\nbody text here\n`
      await settle(() => !captureCharFrame().includes(heading))
      expect(captureCharFrame()).not.toContain(heading)

      // A stale highlight must never be painted over different text.
      starve(true)
      md.content = `${heading}s\nbody text here\n`
      await settle(() => captureCharFrame().includes(`${heading}s`))

      expect(captureCharFrame()).toContain(`${heading}s`)
    } finally {
      restore()
    }
  })
})
