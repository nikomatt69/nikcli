import { describe, expect, it } from "bun:test"
import { Schema } from "effect"

// Side-effect import: the registry is only complete once every defining module
// has loaded, which is what makes the "marks exactly these types" assertion
// meaningful rather than a check on whatever this file happened to pull in.
import "@/bus/all-events"
import { BusEvent } from "@/bus/bus-event"
import { EventFeed } from "@/server/httpapi/event-feed"

/**
 * An internal event stays on the bus and stays off the wire.
 *
 * Both halves matter. Two of the events marked internal exist *because* a
 * module waits on its own work over the bus (`lsp.client.diagnostics`,
 * `mcp.browser.open.failed`), so a filter that suppressed publication would
 * break them; and the reason to filter at all is that a remote client can
 * otherwise watch process-local activity it has no use for.
 *
 * See `specs/v2/public-event-filter.md`.
 */

const PublicEvent = BusEvent.schema("test.visibility.public", Schema.Struct({ value: Schema.String }))

const InternalEvent = BusEvent.schema("test.visibility.internal", Schema.Struct({ value: Schema.String }), {
  visibility: "internal",
})

/** The `/event` shape: the bus event, unwrapped. */
const instanceEnvelope: EventFeed.Envelope = (event) => event

/** The `/global/event` shape: everything under `payload`. */
const globalEnvelope: EventFeed.Envelope = (event) => ({ payload: event })

const globalTypeOf: EventFeed.TypeOf = (event) => (event as { payload?: { type?: string } } | undefined)?.payload?.type

function fakeConnection() {
  const frames: string[] = []
  const decoder = new TextDecoder()
  const controller = {
    desiredSize: EventFeed.LAG_BUDGET,
    enqueue(chunk: Uint8Array) {
      frames.push(decoder.decode(chunk))
    },
    close() {},
    error() {},
  } as unknown as ReadableStreamDefaultController<Uint8Array>

  return {
    controller,
    get data() {
      return frames.map((frame) => JSON.parse(frame.replace(/^data: /, "").replace(/\n\n$/, "")))
    },
  }
}

describe("event visibility", () => {
  it("declares visibility on the event, defaulting to public", () => {
    expect(BusEvent.isInternal(PublicEvent.type)).toBe(false)
    expect(BusEvent.isInternal(InternalEvent.type)).toBe(true)
    // An event nobody registered is public: the filter withholds only what was
    // deliberately marked, it does not default to hiding the unknown.
    expect(BusEvent.isInternal("some.unregistered.event")).toBe(false)
    expect(BusEvent.isInternal(undefined)).toBe(false)
  })

  it("withholds an internal event from the instance stream, with no placeholder frame", () => {
    const feed = new EventFeed.Feed(instanceEnvelope)
    const connection = fakeConnection()
    feed.attach(connection.controller)

    feed.broadcast({ type: InternalEvent.type, properties: { value: "hidden" } })
    expect(connection.data).toEqual([])

    feed.broadcast({ type: PublicEvent.type, properties: { value: "shown" } })
    expect(connection.data).toEqual([{ type: PublicEvent.type, properties: { value: "shown" } }])
  })

  it("withholds it from the global stream too, reading the type through the envelope", () => {
    const feed = new EventFeed.Feed(globalEnvelope, globalTypeOf)
    const connection = fakeConnection()
    feed.attach(connection.controller)

    // `GlobalBus` emits an already-wrapped `{ directory, payload }`, so a filter
    // that looked for a top-level `type` would let every internal event through
    // on this route while correctly withholding it on the other.
    feed.broadcast({ directory: "/tmp/x", payload: { type: InternalEvent.type, properties: { value: "hidden" } } })
    expect(connection.data).toEqual([])

    feed.broadcast({ directory: "/tmp/x", payload: { type: PublicEvent.type, properties: { value: "shown" } } })
    expect(connection.data).toEqual([
      { directory: "/tmp/x", payload: { type: PublicEvent.type, properties: { value: "shown" } } },
    ])
  })

  it("keeps internal events off the generated contract union", () => {
    const union = JSON.stringify(BusEvent.schemas().ast)
    expect(union).toContain(PublicEvent.type)
    expect(union).not.toContain(InternalEvent.type)
  })

  it("marks exactly the types the spec names", () => {
    const marked = BusEvent.internalTypes().filter((type) => !type.startsWith("test."))
    expect(marked.sort()).toEqual(
      [
        "command.executed",
        "instance.reload.started",
        "instance.reloaded",
        "loop.aborted",
        "lsp.client.diagnostics",
        "mcp.browser.open.failed",
      ].sort(),
    )
  })
})
