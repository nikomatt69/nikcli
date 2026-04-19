import type { Event } from "@nikcli-ai/sdk/v2"
import { useSDK } from "./sdk"

export function useEvent() {
  const sdk = useSDK()

  /**
   * Subscribe to all events. Returns an unsubscribe function.
   * Events are pre-filtered server-side by directory; no additional
   * scoping is performed here (matches our SDK contract).
   */
  function subscribe(handler: (event: Event) => void) {
    return sdk.event.listen((e) => {
      handler(e.details as Event)
    })
  }

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  function on<T extends Event["type"]>(type: T, handler: (event: Extract<Event, { type: T }>) => void) {
    return sdk.event.on(type, handler as (e: Event) => void)
  }

  return {
    subscribe,
    on,
  }
}
