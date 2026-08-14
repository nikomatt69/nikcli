import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()

/**
 * Node's default cap is 10, and several routes attach one listener per
 * connection (`/sync/stream`, the mobile session lifecycle stream, the
 * workspace server). The eleventh concurrent client would emit a
 * `MaxListenersExceededWarning` that reads like a leak and is not one.
 *
 * The cap is raised rather than removed: at 0 the warning is disabled and a
 * real leak becomes invisible. `/global/event` no longer contributes at all —
 * it multiplexes every client through a single listener, see `EventFeed`.
 */
GlobalBus.setMaxListeners(200)
