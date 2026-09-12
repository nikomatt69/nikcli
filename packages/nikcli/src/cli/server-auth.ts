import { Flag } from "@nikcli-ai/util/flag"

/**
 * Credentials a local client sends to its own server.
 *
 * A nikcli server started with `NIKCLI_SERVER_PASSWORD` authenticates every
 * route that is not explicitly public — `/config/providers` among them. The
 * background service is that same binary in that same environment, so it
 * inherits the password and expects callers to present it. A client that knows
 * the password because it reads the same env var has to actually send it, or it
 * gets a 401 from the service it just started itself.
 *
 * Shared rather than per-entry-point: the TUI reaches its server two ways (an
 * in-process worker and the background service over HTTP), and only one of them
 * used to carry the header.
 */
export function serverAuthorizationHeader(): string | undefined {
  const password = Flag.NIKCLI_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.NIKCLI_SERVER_USERNAME ?? "nikcli"
  return `Basic ${btoa(`${username}:${password}`)}`
}

/**
 * `fetch` that presents this machine's server credentials, leaving an
 * Authorization header the caller already set alone.
 *
 * Returns the base fetch unchanged when no password is configured, so the
 * common unsecured case adds no wrapper.
 */
export function authorizedFetch(base: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  if (!serverAuthorizationHeader()) return base
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    // Re-read per call: the header is derived from a Flag, and tests flip it.
    const auth = serverAuthorizationHeader()
    if (auth && !request.headers.has("Authorization")) request.headers.set("Authorization", auth)
    return base(request)
  }) as typeof globalThis.fetch
}
