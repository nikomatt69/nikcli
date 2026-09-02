import { BusEvent } from "@/bus/bus-event"
import { Log } from "@nikcli-ai/util/log"

/**
 * One encoded frame per event, one bounded queue per connection.
 *
 * Before this module, `GET /event` and `GET /global/event` each built a
 * private `send` inside their `ReadableStream`, so `JSON.stringify` plus
 * UTF-8 encoding ran once per attached client per event, and
 * `controller.enqueue` — which never refuses — gave a stalled reader an
 * unbounded internal queue.
 *
 * A `Feed` owns the fan-out instead: it encodes an event once into an
 * immutable frame and offers that same frame to every connection. Each
 * connection carries its own lag budget, so a stalled reader is evicted with
 * a stated reason while publication and healthy readers continue in order.
 *
 * See `specs/v2/event-stream-architecture.md`.
 */
export namespace EventFeed {
  const log = Log.create({ service: "event.feed" })

  const encoder = new TextEncoder()

  /**
   * Frames a connection may fall behind by before it is evicted.
   *
   * This is an event count, not a memory bound: frame sizes vary and the
   * kernel and client buffers are outside server accounting. Tune it from
   * observed burst sizes and overflow frequency. A larger budget retains
   * stale clients longer.
   */
  export const LAG_BUDGET = 4096

  /** A connection-local frame: the greeting, a heartbeat, or a failure reason. */
  export type LocalEvent = {
    type: string
    properties: Record<string, unknown>
  }

  /**
   * Wraps a connection-local event in the route's wire shape.
   *
   * The two streams are deliberately different and both are load-bearing:
   * `/event` sends unwrapped `{type, properties}` while `/global/event` sends
   * `{payload: {...}}`. The TUI reads `data.type` on one and
   * `envelope.payload.type` on the other, so serving the wrong shape silently
   * drops every event client-side.
   */
  export type Envelope = (event: LocalEvent) => unknown

  /**
   * Reads the event type out of whatever shape this feed broadcasts.
   *
   * `broadcast` does **not** apply `Envelope` — that wraps connection-local
   * frames only. Each feed is handed values already in its own wire shape: the
   * instance feed receives the `Bus` event unwrapped (`{type, properties}`),
   * the global feed receives the `GlobalBus` payload (`{directory, payload}`).
   * So the visibility filter needs the same per-feed knowledge the envelope
   * carries, rather than assuming a `type` at the top level.
   */
  export type TypeOf = (event: unknown) => string | undefined

  export function frame(value: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
  }

  export type CloseReason = { name: string; message: string }

  /** A single SSE connection and its lag budget. */
  export class Connection {
    private closed = false

    constructor(
      private readonly controller: ReadableStreamDefaultController<Uint8Array>,
      private readonly envelope: Envelope,
      private readonly onClosed: () => void,
    ) {}

    /**
     * Send a connection-local frame. These bypass the lag budget: the
     * greeting and the heartbeat exist to establish and hold the connection,
     * so they must not be the thing that evicts it.
     */
    local(event: LocalEvent) {
      this.write(frame(this.envelope(event)))
    }

    /**
     * Offer a broadcast frame. Returns false when the connection was evicted
     * rather than written to.
     */
    offer(encoded: Uint8Array): boolean {
      if (this.closed) return false
      // `desiredSize` is the queuing strategy's high-water mark minus what
      // the reader has not consumed, so it reaches zero exactly when the
      // connection is LAG_BUDGET frames behind. It is null once the stream
      // has closed or errored, which `write` handles.
      const desired = this.controller.desiredSize
      if (desired !== null && desired <= 0) {
        // The budget belongs to the stream's queuing strategy, not to this
        // object, so the message states the condition rather than a number
        // it cannot actually read back.
        this.fail({
          name: "SubscriberOverflowError",
          message: "subscriber exceeded its lag budget",
        })
        return false
      }
      return this.write(encoded)
    }

    /**
     * Close with a stated reason, delivered on the wire first.
     *
     * The reason frame is written past the budget on purpose — a client that
     * is being dropped should learn why, and the previous behaviour was a
     * silent close that looked identical to a network failure.
     */
    fail(reason: CloseReason) {
      if (this.closed) return
      log.info("connection failed", reason)
      this.write(frame(this.envelope({ type: "server.error", properties: { ...reason } })))
      this.close()
    }

    close() {
      if (this.closed) return
      this.closed = true
      this.onClosed()
      try {
        this.controller.close()
      } catch {
        // Already closed by the client.
      }
    }

    /** Mark closed without touching the controller (the client hung up). */
    abandon() {
      if (this.closed) return
      this.closed = true
      this.onClosed()
    }

    private write(encoded: Uint8Array): boolean {
      if (this.closed) return false
      try {
        this.controller.enqueue(encoded)
        return true
      } catch (error) {
        log.debug("sse write failed", { error })
        this.abandon()
        return false
      }
    }
  }

  /** A fan-out group: one encode per event, shared by every connection in it. */
  export class Feed {
    private readonly connections = new Set<Connection>()

    constructor(
      private readonly envelope: Envelope,
      private readonly typeOf: TypeOf = (event) => (event as { type?: string } | undefined)?.type,
    ) {}

    get size() {
      return this.connections.size
    }

    /**
     * Attach a connection. The caller owns the `ReadableStream`; the feed only
     * needs its controller and a way to learn that it is gone.
     */
    attach(controller: ReadableStreamDefaultController<Uint8Array>, onClosed?: () => void): Connection {
      const connection: Connection = new Connection(controller, this.envelope, () => {
        this.connections.delete(connection)
        onClosed?.()
      })
      this.connections.add(connection)
      return connection
    }

    /**
     * Encode once, offer to everyone.
     *
     * With no connections attached the event is not encoded at all, so a
     * headless server pays nothing for the subscription it keeps.
     *
     * Internal events return here too, ahead of the encode, for the same
     * reason: withholding one must cost less than sending it, not more. A
     * withheld event produces no frame at all — there is no typed placeholder,
     * because a placeholder would republish the existence and the exact timing
     * of the process-local activity the filter exists to keep inside. See
     * `specs/v2/public-event-filter.md`.
     */
    broadcast(event: unknown) {
      if (this.connections.size === 0) return
      if (BusEvent.isInternal(this.typeOf(event))) return
      let encoded: Uint8Array
      try {
        encoded = frame(event)
      } catch (error) {
        // Skip the malformed event and drop the clients that would otherwise
        // see a silent gap, but keep the feed usable for later connections.
        const type = (event as { type?: unknown } | undefined)?.type
        log.error("event encoding failed", { type, error })
        this.failAll({
          name: "EncodingError",
          message: "an event could not be encoded",
        })
        return
      }
      for (const connection of this.connections) connection.offer(encoded)
    }

    closeAll() {
      for (const connection of this.connections) connection.close()
    }

    failAll(reason: CloseReason) {
      for (const connection of this.connections) connection.fail(reason)
    }
  }

  /**
   * Build the `ReadableStream` for one connection with the lag budget as its
   * queuing strategy, so `desiredSize` measures exactly the budget.
   */
  export function stream(source: UnderlyingDefaultSource<Uint8Array>): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>(source, new CountQueuingStrategy({ highWaterMark: LAG_BUDGET }))
  }

  export const HEADERS = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  } as const
}
