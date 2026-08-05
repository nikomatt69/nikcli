import { describe, expect, it } from "bun:test"
import { wrapDiagramsInFences } from "@tui/routes/session/diagram"
import { extractTuiImageUrls } from "@tui/component/tui-image"

/**
 * What a text part costs per token, and why the scans moved off the live path.
 *
 * opencode's `TextPart` is a trim and a `<markdown>`. Ours wraps ASCII diagrams
 * in fences and pulls image URLs out of the prose, and both walk the *whole*
 * message — so on a streaming part they cost O(n) per token, which is O(n²)
 * over the message. This measures that, and pins the two properties that let
 * the work be deferred to the moment the part completes.
 */

const PARA =
  "Il renderer piega il messaggio in blocchi e dipinge ognuno nel buffer, " +
  "quindi il costo di un delta dipende da quanta parte deve rivisitare. "

function message(chars: number): string {
  let out = ""
  while (out.length < chars) out += PARA + (out.length % 400 < 140 ? "\n\n" : "")
  return out.slice(0, chars)
}

/** Total time to run the whole-message scans once per token, as opencode never does. */
function perToken(text: string, tokens: number): number {
  const step = Math.max(1, Math.floor(text.length / tokens))
  const start = performance.now()
  for (let n = step; n <= text.length; n += step) {
    const prefix = text.slice(0, n)
    wrapDiagramsInFences(prefix)
    extractTuiImageUrls(prefix, 2)
  }
  return performance.now() - start
}

/** The same scans, run once on the finished text — what the live path pays now. */
function once(text: string): number {
  const start = performance.now()
  wrapDiagramsInFences(text)
  extractTuiImageUrls(text, 2)
  return performance.now() - start
}

describe("the scans a live text part no longer pays", () => {
  it("running them per token costs orders of magnitude more than running them once", () => {
    const text = message(16_000)
    const streamed = perToken(text, 200)
    const settled = once(text)

    // Every scan restarts from the top of the message, so a stream pays for the
    // whole message once per token. Deferring turns that back into one pass.
    expect(streamed).toBeGreaterThan(settled * 20)

    const rows = [2_000, 4_000, 8_000, 16_000].map((size) => {
      const body = message(size)
      return (
        `${String(size).padStart(6)} chars  ` +
        `per token: ${perToken(body, 200).toFixed(1).padStart(6)} ms   ` +
        `una volta: ${once(body).toFixed(2)} ms`
      )
    })
    console.log("\nscansioni sull'intero messaggio, 200 token:\n" + rows.join("\n"))
  })

  /**
   * The first property that makes deferring safe: on settled text the answer is
   * the same one the old code produced, because it is the same call.
   */
  it("fencing a finished message is unchanged", () => {
    const diagram = ["Ecco:", "", "┌────────┐", "│  node  │", "└────────┘", "", "Fine."].join("\n")
    const out = wrapDiagramsInFences(diagram)
    expect(out).toContain("```\n┌────────┐")
    expect(out).toContain("└────────┘\n```")
    expect(out.startsWith("Ecco:")).toBe(true)
    expect(out.endsWith("Fine.")).toBe(true)
  })

  /**
   * The second: a half-written line genuinely does change its mind, so running
   * the scan mid-stream produces answers that are not merely early but wrong,
   * and each change rebuilds the block the renderer had already painted.
   */
  it("an incomplete line classifies differently from the complete one", () => {
    // `│ n` holds one box character — prose. `│ node │` holds two — a diagram.
    expect(wrapDiagramsInFences("┌───┐\n│ n")).not.toContain("│ n\n```")
    expect(wrapDiagramsInFences("┌───┐\n│ node │")).toContain("```")
    // ``` is an ordinary line until its third backtick lands, and then every
    // line after it flips in or out of a code block.
    const before = wrapDiagramsInFences("``\n┌───┐\n│ a │\n└───┘")
    const after = wrapDiagramsInFences("```\n┌───┐\n│ a │\n└───┘")
    expect(before).not.toBe(after)
  })

  it("text with no diagram characters is returned untouched", () => {
    const plain = "Solo una frase.\n\n- una lista\n- di cose\n"
    expect(wrapDiagramsInFences(plain)).toBe(plain)
  })
})
