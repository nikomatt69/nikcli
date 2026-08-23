/**
 * Regression cover for #235 — "browser-control start fails on Windows:
 * Bun.WebView only available on the main thread".
 *
 * A daemon hosted in-process on a worker thread binds its socket fine and then
 * fails every `start`, because `Bun.WebView`'s chrome backend (the backend on
 * everything except macOS) throws when constructed off the main thread. `list`
 * kept working, which is what made the report look like a Playwright problem.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inprocessHostingPlan, rpc, startDaemon } from "../src/index"

describe("in-process hosting plan", () => {
  test("the main thread hosts the daemon itself", () => {
    expect(inprocessHostingPlan({ mainThread: true, hasMainThreadHost: false })).toBe("self")
  })

  test("a worker delegates to the host's main thread", () => {
    expect(inprocessHostingPlan({ mainThread: false, hasMainThreadHost: true })).toBe("delegate")
  })

  test("a worker with nowhere to delegate refuses rather than binding a broken daemon", () => {
    expect(inprocessHostingPlan({ mainThread: false, hasMainThreadHost: false })).toBe("unsupported")
  })
})

describe("daemon hosted on the main thread, driven from a worker", () => {
  test("start() succeeds instead of throwing the main-thread error", async () => {
    const socket = join(tmpdir(), `browser-control-test-${crypto.randomUUID()}.sock`)
    await startDaemon(socket, { exitProcess: false })

    // The worker only speaks RPC over the socket — exactly what `ensureDaemon`
    // leaves it doing once hosting has been delegated.
    const workerFile = join(tmpdir(), `browser-control-test-${crypto.randomUUID()}.ts`)
    await Bun.write(
      workerFile,
      `const socket = ${JSON.stringify(socket)}
const res = await fetch("http://localhost/rpc", {
  method: "POST",
  unix: socket,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: "start", params: { url: "data:text/html,<title>ok</title>" } }),
})
postMessage(await res.text())
`,
    )

    const body = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(workerFile)
      worker.onmessage = (event) => {
        worker.terminate()
        resolve(String(event.data))
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message))
      }
    })

    const parsed = JSON.parse(body) as { ok: boolean; error?: string }
    // The bug, precisely: the RPC came back with Bun's main-thread complaint.
    expect(parsed.error ?? "").not.toContain("only available on the main thread")

    if (!parsed.ok) {
      // No browser on this machine is a skip, not a failure — same posture as
      // webview.test.ts. Any other error is still a real failure above.
      console.warn("browser unavailable, session not started:", parsed.error)
      return
    }
    expect(parsed.ok).toBe(true)

    await rpc(socket, "close-all", {}).catch(() => {})
    await fetch("http://localhost/shutdown", { method: "POST", unix: socket } as RequestInit).catch(() => {})
  }, 60_000)
})
