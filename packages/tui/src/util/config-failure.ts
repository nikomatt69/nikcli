import { ClientError } from "@nikcli-ai/sdk/httpapi"

/** Why the server could not supply a usable TUI config. */
export type TuiConfigFailure = "unauthorized" | "unavailable" | "malformed"

/**
 * A remote TUI config that could not be read.
 *
 * A 401, an unreachable server and a body this client cannot decode are three
 * different problems, and none of them means "the user has an empty config".
 * Returning `{}` for all three started the renderer on defaults that silently
 * disagreed with the server.
 */
export class TuiConfigError extends Error {
  override readonly name = "TuiConfigError"
  constructor(
    readonly reason: TuiConfigFailure,
    readonly url: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(describe(reason, url, status), options)
  }
}

function describe(reason: TuiConfigFailure, url: string, status?: number): string {
  const code = status === undefined ? "" : ` (HTTP ${status})`
  if (reason === "unauthorized") return `the nikcli server at ${url} rejected this client${code}`
  if (reason === "unavailable") return `could not reach a nikcli server at ${url}`
  return `the nikcli server at ${url} returned a TUI config this client cannot read${code}`
}

export function classifyConfigFailure(error: unknown, status?: number): TuiConfigFailure {
  if (status === 401 || status === 403) return "unauthorized"
  if (error instanceof ClientError) {
    if (error.reason === "Transport") return "unavailable"
    return "malformed"
  }
  return status === undefined ? "unavailable" : "malformed"
}
