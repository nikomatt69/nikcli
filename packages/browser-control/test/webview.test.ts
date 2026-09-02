import { describe, expect, test } from "bun:test"
import { createWebView } from "@nikcli-ai/util/bun-utils"

describe("Bun.WebView", () => {
  test("loads a data URL and evaluates", async () => {
    let view: ReturnType<typeof createWebView>
    try {
      view = createWebView({ width: 320, height: 240 })
    } catch (error) {
      console.warn("Bun.WebView unavailable, skipping", error)
      return
    }
    try {
      await view.navigate("data:text/html,<h1 id=t>hello</h1>")
      expect(await view.evaluate("document.getElementById('t').textContent")).toBe("hello")
      const png = await view.screenshot({ encoding: "buffer" })
      expect(Buffer.isBuffer(png) || png instanceof Uint8Array).toBe(true)
    } finally {
      view.close()
    }
  }, 30_000)
})
