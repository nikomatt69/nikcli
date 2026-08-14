import { describe, expect, it } from "bun:test"
import { EventFeed } from "@/server/httpapi/event-feed"

/**
 * A controller that models a reader with a finite, observable backlog.
 *
 * `desiredSize` mirrors what a real `ReadableStream` built with
 * `CountQueuingStrategy({ highWaterMark: LAG_BUDGET })` reports: the budget
 * minus the chunks the reader has not consumed. `drain()` is the reader
 * catching up.
 */
function fakeConnection(budget = EventFeed.LAG_BUDGET) {
  const frames: string[] = []
  const decoder = new TextDecoder()
  let queued = 0
  let closed = false

  const controller = {
    get desiredSize() {
      return closed ? null : budget - queued
    },
    enqueue(chunk: Uint8Array) {
      if (closed) throw new Error("stream is closed")
      queued++
      frames.push(decoder.decode(chunk))
    },
    close() {
      closed = true
    },
    error() {
      closed = true
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>

  return {
    controller,
    frames,
    drain() {
      queued = 0
    },
    get closed() {
      return closed
    },
    /** Parsed `data:` payloads, in order. */
    get data() {
      return frames.map((frame) => JSON.parse(frame.replace(/^data: /, "").replace(/\n\n$/, "")))
    },
  }
}

const identity: EventFeed.Envelope = (event) => event
const wrapped: EventFeed.Envelope = (event) => ({ payload: event })

describe("EventFeed", () => {
  it("encodes an event once regardless of how many connections are attached", () => {
    const feed = new EventFeed.Feed(identity)
    const a = fakeConnection()
    const b = fakeConnection()
    const c = fakeConnection()
    feed.attach(a.controller)
    feed.attach(b.controller)
    feed.attach(c.controller)

    // `toJSON` is called exactly once per serialization, so it counts encodes
    // without mocking the module.
    let encodes = 0
    const event = {
      type: "session.updated",
      properties: {
        toJSON() {
          encodes++
          return { id: "ses_1" }
        },
      },
    }

    feed.broadcast(event)

    expect(encodes).toBe(1)
    expect(a.data).toEqual([{ type: "session.updated", properties: { id: "ses_1" } }])
    expect(b.data).toEqual(a.data)
    expect(c.data).toEqual(a.data)
  })

  it("does not encode at all when nothing is attached", () => {
    const feed = new EventFeed.Feed(identity)
    let encodes = 0
    feed.broadcast({
      type: "session.updated",
      properties: {
        toJSON() {
          encodes++
          return {}
        },
      },
    })
    expect(encodes).toBe(0)
  })

  it("evicts only the connection that exceeds its lag budget", () => {
    const feed = new EventFeed.Feed(identity)
    const slow = fakeConnection(2)
    const healthy = fakeConnection(2)
    feed.attach(slow.controller)
    feed.attach(healthy.controller)

    feed.broadcast({ type: "a", properties: {} })
    feed.broadcast({ type: "b", properties: {} })
    // The healthy reader keeps up; the slow one never consumes.
    healthy.drain()

    feed.broadcast({ type: "c", properties: {} })

    expect(slow.closed).toBe(true)
    expect(healthy.closed).toBe(false)
    expect(feed.size).toBe(1)

    // The evicted connection is told why, instead of the previous silent close.
    const last = slow.data.at(-1)
    expect(last).toMatchObject({
      type: "server.error",
      properties: { name: "SubscriberOverflowError" },
    })
    // ...and it did not receive the frame that overflowed it.
    expect(slow.data.map((event) => event.type)).toEqual(["a", "b", "server.error"])
  })

  it("keeps delivering to survivors after another connection overflows", () => {
    const feed = new EventFeed.Feed(identity)
    const slow = fakeConnection(1)
    const healthy = fakeConnection(64)
    feed.attach(slow.controller)
    feed.attach(healthy.controller)

    feed.broadcast({ type: "a", properties: {} })
    feed.broadcast({ type: "b", properties: {} })
    feed.broadcast({ type: "c", properties: {} })

    expect(slow.closed).toBe(true)
    expect(healthy.data.map((event) => event.type)).toEqual(["a", "b", "c"])
  })

  it("drops current connections on an encoding failure but stays usable", () => {
    const feed = new EventFeed.Feed(identity)
    const first = fakeConnection()
    feed.attach(first.controller)

    const cyclic: Record<string, unknown> = { type: "bad" }
    cyclic.self = cyclic
    feed.broadcast(cyclic)

    expect(first.closed).toBe(true)
    expect(first.data.at(-1)).toMatchObject({
      type: "server.error",
      properties: { name: "EncodingError" },
    })

    const second = fakeConnection()
    feed.attach(second.controller)
    feed.broadcast({ type: "session.updated", properties: {} })
    expect(second.data.map((event) => event.type)).toEqual(["session.updated"])
  })

  it("keeps connection-local frames outside the lag budget", () => {
    const feed = new EventFeed.Feed(identity)
    const connection = fakeConnection(1)
    const attached = feed.attach(connection.controller)

    // A heartbeat on a stalled connection must not be the thing that evicts
    // it — the greeting and heartbeat exist to hold the connection open.
    attached.local({ type: "server.connected", properties: {} })
    attached.local({ type: "server.heartbeat", properties: {} })
    attached.local({ type: "server.heartbeat", properties: {} })

    expect(connection.closed).toBe(false)
  })

  it("preserves both wire shapes", () => {
    const instance = fakeConnection()
    const instanceFeed = new EventFeed.Feed(identity)
    instanceFeed.attach(instance.controller).local({ type: "server.connected", properties: {} })
    instanceFeed.broadcast({ type: "session.updated", properties: { id: "ses_1" } })

    const global = fakeConnection()
    const globalFeed = new EventFeed.Feed(wrapped)
    globalFeed.attach(global.controller).local({ type: "server.connected", properties: {} })
    globalFeed.broadcast({ directory: "/tmp/p", payload: { type: "session.updated", properties: { id: "ses_1" } } })

    // /event: unwrapped. The TUI reads `data.type` directly.
    expect(instance.data).toEqual([
      { type: "server.connected", properties: {} },
      { type: "session.updated", properties: { id: "ses_1" } },
    ])
    // /global/event: the greeting is wrapped, and bus events already carry
    // their own `{directory, payload}` envelope and pass through untouched.
    expect(global.data).toEqual([
      { payload: { type: "server.connected", properties: {} } },
      { directory: "/tmp/p", payload: { type: "session.updated", properties: { id: "ses_1" } } },
    ])
  })

  it("removes a connection that the client hung up on", () => {
    const feed = new EventFeed.Feed(identity)
    const connection = fakeConnection()
    const attached = feed.attach(connection.controller)
    expect(feed.size).toBe(1)

    attached.abandon()

    expect(feed.size).toBe(0)
    feed.broadcast({ type: "session.updated", properties: {} })
    expect(connection.frames).toHaveLength(0)
  })

  it("frames events as SSE data lines", () => {
    const decoded = new TextDecoder().decode(EventFeed.frame({ type: "a" }))
    expect(decoded).toBe('data: {"type":"a"}\n\n')
  })
})
