import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-transport-"))
process.env.NIKCLI_TEST_HOME ??= testDir
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db")
process.env.XDG_DATA_HOME ??= path.join(testDir, "data")

const { createHttpRemoteTransport, createInMemoryRemoteTransport, createInMemoryScheduler, realScheduler } =
  await import("@/sync/transport")
import type { SyncEventRecord } from "@/sync"

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  if (process.env.NIKCLI_DB === path.join(testDir, "nikcli.db")) {
    await fs.rm(testDir, { recursive: true, force: true })
  }
})

const sampleEvent = (seq: number): SyncEventRecord => ({
  id: `evt_${seq}_${run}`,
  projectId: `proj_${run}`,
  aggregate: `wrk_${run}`,
  seq,
  type: "test.event",
  data: { n: seq },
  timestamp: Date.now(),
  origin: "remote:test",
})

describe("InMemoryRemoteTransport", () => {
  it("pullBacklog returns events newer than `since`", async () => {
    const transport = createInMemoryRemoteTransport()
    transport.enqueue(sampleEvent(1))
    transport.enqueue(sampleEvent(2))
    transport.enqueue(sampleEvent(3))

    const page = await transport.pullBacklog(1)
    expect(page.events.map((e) => e.seq)).toEqual([2, 3])
    expect(page.hasMore).toBe(false)
  })

  it("subscribe delivers events and can be unsubscribed", async () => {
    const transport = createInMemoryRemoteTransport()
    const received: number[] = []
    const unsubscribe = transport.subscribe((event) => {
      received.push(event.seq)
    })
    transport.enqueue(sampleEvent(1))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(received).toEqual([1])

    unsubscribe()
    transport.enqueue(sampleEvent(2))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(received).toEqual([1])
  })

  it("push returns the next override outcome when set", async () => {
    const transport = createInMemoryRemoteTransport()
    transport.setNextPush({ ok: false, permanent: true, error: "HTTP 401" })
    const outcome = await transport.push(sampleEvent(1))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.permanent).toBe(true)
    expect(transport.pushed).toHaveLength(0)

    const ok = await transport.push(sampleEvent(2))
    expect(ok.ok).toBe(true)
    expect(transport.pushed).toHaveLength(1)
  })

  it("close clears subscribers", () => {
    const transport = createInMemoryRemoteTransport()
    const unsubscribe = transport.subscribe(() => undefined)
    transport.close()
    // After close, the underlying set is cleared. Calling enqueue with no
    // subscribers must not throw.
    transport.enqueue(sampleEvent(1))
    unsubscribe()
  })
})

describe("InMemoryScheduler", () => {
  it("fires interval callbacks when tick advances past the period", () => {
    const scheduler = createInMemoryScheduler({ initialNow: 0 })
    let count = 0
    const handle = scheduler.interval(() => count++, 1_000)

    scheduler.tick(2_500)
    expect(count).toBe(2) // tick at 1000 and 2000
    handle.clear()
    scheduler.tick(5_000)
    expect(count).toBe(2)
    scheduler.tick(10_000)
    expect(scheduler.pendingCount()).toBe(0)
  })

  it("runs one-shot timers at the right time", () => {
    const scheduler = createInMemoryScheduler({ initialNow: 0 })
    let fired = false
    scheduler.timeout(() => (fired = true), 500)
    scheduler.tick(499)
    expect(fired).toBe(false)
    scheduler.tick(1)
    expect(fired).toBe(true)
    scheduler.tick(5_000)
    expect(scheduler.pendingCount()).toBe(0)
  })

  it("now() tracks the simulated clock", () => {
    const scheduler = createInMemoryScheduler({ initialNow: 100 })
    expect(scheduler.now()).toBe(100)
    scheduler.tick(250)
    expect(scheduler.now()).toBe(350)
  })
})

describe("HttpRemoteTransport", () => {
  it("throws when no EventSource is available", () => {
    expect(() =>
      createHttpRemoteTransport({
        url: "http://localhost",
        token: "x",
        projectID: "p",
        eventSourceImpl: undefined as never,
      }),
    ).toThrow(/EventSource/)
  })

  it("delegates push and pullBacklog to the injected fetch", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = Object.assign(
      async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        const url = String(input)
        if (url.includes("/sync/outbox")) {
          return new Response(JSON.stringify({ events: [], hasMore: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }
        return new Response("{}", { status: 200 })
      },
      { preconnect: () => undefined },
    ) as unknown as typeof fetch

    const transport = createHttpRemoteTransport({
      url: "http://hub.example",
      token: "tok",
      projectID: "proj_http",
      fetchImpl: fakeFetch,
      // Inject a no-op EventSource to satisfy the constructor.
      eventSourceImpl: class {
        url: string
        withCredentials = false
        readyState = 0
        onopen: ((e: Event) => void) | null = null
        onmessage: ((e: MessageEvent) => void) | null = null
        onerror: ((e: Event) => void) | null = null
        constructor(url: string) {
          this.url = url
        }
        addEventListener() {
          /* no-op */
        }
        removeEventListener() {
          /* no-op */
        }
        close() {
          /* no-op */
        }
        dispatchEvent() {
          return true
        }
      } as unknown as typeof EventSource,
    })

    const backlog = await transport.pullBacklog(0)
    expect(backlog.events).toEqual([])
    expect(calls.some((c) => c.url.includes("/sync/outbox"))).toBe(true)

    const ok = await transport.push(sampleEvent(7))
    expect(ok.ok).toBe(true)
    expect(calls.some((c) => c.url.endsWith("/sync/event"))).toBe(true)
    transport.close()
  })
})

describe("realScheduler", () => {
  it("interval and clear work against the real clock", () => {
    let count = 0
    const handle = realScheduler.interval(() => count++, 5)
    setTimeout(() => handle.clear(), 25)
    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      expect(count).toBeGreaterThan(0)
    })
  })
})
