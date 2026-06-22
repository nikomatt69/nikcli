import { createNikcliClient } from "@nikcli-ai/sdk/v2/client"

export type ServerHealth = { healthy: boolean; version?: string }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url
  if (input instanceof URL) return input.href
  return input
}

export function serverUrlMatchesRequest(serverUrl: string, input: RequestInfo | URL) {
  try {
    const server = new URL(serverUrl)
    const request = new URL(requestUrl(input))
    if (server.origin !== request.origin) return false

    const basePath = server.pathname.replace(/\/+$/, "")
    if (!basePath) return true
    return request.pathname === basePath || request.pathname.startsWith(`${basePath}/`)
  } catch {
    return false
  }
}

export function withServerBearerToken(fetcher: typeof globalThis.fetch, serverUrl: string, token: string) {
  const value = token.trim()
  if (!value) return fetcher

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!serverUrlMatchesRequest(serverUrl, input)) return fetcher(input, init)

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((headerValue, name) => headers.set(name, headerValue))
    headers.set("Authorization", `Bearer ${value}`)

    if (input instanceof Request) {
      return fetcher(new Request(input, { ...init, headers }))
    }
    return fetcher(input, { ...init, headers })
  }) as typeof globalThis.fetch
}

function timeoutSignal(timeoutMs: number) {
  return (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout?.(timeoutMs)
}

export async function checkServerHealth(
  url: string,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  const signal = opts?.signal ?? timeoutSignal(opts?.timeoutMs ?? 3000)
  const sdk = createNikcliClient({
    baseUrl: url,
    fetch,
    signal,
  })
  return sdk.global
    .health()
    .then((x) => ({ healthy: x.data?.healthy === true, version: x.data?.version }))
    .catch(() => ({ healthy: false }))
}
