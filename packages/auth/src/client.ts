import z from "zod"

export const StoredTokens = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().int().positive(),
})

export type StoredTokens = z.infer<typeof StoredTokens>

export type TokenStore = {
  get(): StoredTokens | undefined | Promise<StoredTokens | undefined>
  set(tokens: StoredTokens): void | Promise<void>
  clear?(): void | Promise<void>
}

export type TokenClientOptions = {
  issuer: string
  clientID: string
  store: TokenStore
  // Parameters<typeof fetch>[0] instead of RequestInfo: lib.dom-free consumers
  // (bun/workers tsconfigs) don't have the RequestInfo global.
  fetch?: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>
  refreshThresholdMs?: number
}

export function createTokenClient(options: TokenClientOptions) {
  const fetchImpl = options.fetch ?? fetch
  const threshold = options.refreshThresholdMs ?? 60_000
  let refreshFlight: Promise<StoredTokens> | undefined

  async function refresh(current: StoredTokens): Promise<StoredTokens> {
    const endpoint = new URL("/oauth/token", options.issuer)
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refresh,
        client_id: options.clientID,
      }),
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) await options.store.clear?.()
      throw new Error(`Token refresh failed (${response.status})`)
    }
    const body = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1).optional(),
        expires_in: z.number().int().positive(),
      })
      .parse(await response.json())
    const updated = {
      access: body.access_token,
      refresh: body.refresh_token ?? current.refresh,
      expires: Date.now() + body.expires_in * 1000,
    }
    await options.store.set(updated)
    return updated
  }

  async function getValidTokens(): Promise<StoredTokens> {
    const current = await options.store.get()
    if (!current) throw new Error("No stored authentication tokens")
    if (current.expires > Date.now() + threshold) return current
    if (!refreshFlight) {
      refreshFlight = refresh(current).finally(() => {
        refreshFlight = undefined
      })
    }
    return refreshFlight
  }

  async function getValidAccessToken(): Promise<string> {
    return (await getValidTokens()).access
  }

  return {
    getValidTokens,
    getValidAccessToken,
    async authenticatedFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> {
      const access = await getValidAccessToken()
      const headers = new Headers(init.headers)
      headers.set("authorization", `Bearer ${access}`)
      return fetchImpl(input, { ...init, headers })
    },
  }
}
