import type { ConnectionStatus } from "@tui/context/sdk"

/**
 * Decides when a connection transition means the client has to refetch.
 *
 * The event stream is a live fan-out with a per-connection lag budget, not a
 * journal: there is no cursor to resume from, so anything published while the
 * stream was down is simply gone. Resuming it without refetching leaves the
 * stores with a hole while the UI says "connected".
 *
 * The rule is narrow on purpose. Only a transition that passed through
 * `reconnecting` counts; the first `connecting` → `connected` is the initial
 * connection, whose state the caller loads on mount. Refetching there too would
 * double every startup.
 */
export function createReconnectGate() {
  let sawDisconnect = false
  return {
    /** True when this transition means the caller must refetch its state. */
    observe(status: ConnectionStatus): boolean {
      if (status === "reconnecting") {
        sawDisconnect = true
        return false
      }
      if (status !== "connected" || !sawDisconnect) return false
      sawDisconnect = false
      return true
    },
    /** Whether a disconnect is still waiting to be recovered from. */
    get pending() {
      return sawDisconnect
    },
  }
}

export type ReconnectGate = ReturnType<typeof createReconnectGate>
