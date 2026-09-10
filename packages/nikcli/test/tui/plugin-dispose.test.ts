import { describe, expect, test } from "bun:test"
import { createPluginScope } from "@tui/plugin/runtime"

/**
 * Dispose order is the whole point of this file.
 *
 * The scope walks its cleanups newest-first, and the host's own
 * deregistrations — the command list, the routes, the event listeners, the
 * plugin host entry — are *in* that queue alongside whatever the plugin
 * registered. Stopping at the first callback that hangs or throws therefore
 * left a disposed plugin still wired into the TUI: its commands in the palette,
 * its routes resolvable, its listeners receiving events.
 */
function scope(timeoutMs: number) {
  return createPluginScope({ spec: "test://plugin" } as Parameters<typeof createPluginScope>[0], "test", timeoutMs)
}

describe("plugin scope dispose", () => {
  test("a hung callback does not strand the cleanups queued before it", async () => {
    const ran: string[] = []
    const s = scope(20)

    // Registered first, so it runs *last*: it is the one a `break` dropped.
    s.lifecycle.onDispose(() => {
      ran.push("host-unregister")
    })
    s.lifecycle.onDispose(() => new Promise<void>(() => {}))

    await s.dispose()
    expect(ran).toEqual(["host-unregister"])
  })

  test("a throwing callback does not stop the queue either", async () => {
    const ran: string[] = []
    const s = scope(500)

    s.lifecycle.onDispose(() => {
      ran.push("host-unregister")
    })
    s.lifecycle.onDispose(() => {
      throw new Error("plugin cleanup blew up")
    })

    await s.dispose()
    expect(ran).toEqual(["host-unregister"])
  })

  test("every remaining cleanup still runs once the budget is spent", async () => {
    const ran: string[] = []
    const s = scope(10)

    s.lifecycle.onDispose(() => {
      ran.push("a")
    })
    s.lifecycle.onDispose(() => {
      ran.push("b")
    })
    // Two hangs: the first eats the budget, the second gets no wait at all —
    // both must still be *invoked*, and both must still be followed by a and b.
    s.lifecycle.onDispose(() => new Promise<void>(() => {}))
    s.lifecycle.onDispose(() => new Promise<void>(() => {}))

    await s.dispose()
    expect(ran).toEqual(["b", "a"])
  })

  test("tracked host disposers run in reverse registration order", async () => {
    const ran: string[] = []
    const s = scope(500)

    s.track(() => ran.push("first"))
    s.track(() => ran.push("second"))

    await s.dispose()
    expect(ran).toEqual(["second", "first"])
  })

  test("the lifecycle signal is aborted before any cleanup runs", async () => {
    const s = scope(500)
    let abortedDuringCleanup = false
    s.lifecycle.onDispose(() => {
      abortedDuringCleanup = s.lifecycle.signal.aborted
    })

    await s.dispose()
    expect(abortedDuringCleanup).toBe(true)
  })

  test("repeated dispose cycles leave no residual owner callbacks", async () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const ran: string[] = []
      const s = scope(50)
      s.lifecycle.onDispose(() => {
        ran.push("cleanup")
      })
      await s.dispose()
      expect(ran).toEqual(["cleanup"])
      expect(s.lifecycle.signal.aborted).toBe(true)
      s.lifecycle.onDispose(() => {
        ran.push("late")
      })
      await s.dispose()
      expect(ran).toEqual(["cleanup"])
    }
  })
})
