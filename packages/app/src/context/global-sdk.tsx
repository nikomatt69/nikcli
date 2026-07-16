import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2/client"
import { createSimpleContext } from "@nikcli-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup } from "solid-js"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { useAccount } from "./account"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const server = useServer()
    const account = useAccount()
    const platform = usePlatform()
    const abort = new AbortController()
    const baseFetch = platform.fetch ?? globalThis.fetch
    const authenticatedFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const retryInput = input instanceof Request ? input.clone() : input
        const headers = new Headers(input instanceof Request ? input.headers : undefined)
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
        const ownsAuthorization = !headers.has("Authorization")
        let attachedAccess: string | undefined
        if (ownsAuthorization) {
          const access = await account.getValidAccessToken().catch(() => account.token)
          if (access) {
            attachedAccess = access
            headers.set("Authorization", `Bearer ${access}`)
          }
        }
        const response = await baseFetch(input, { ...init, headers })
        if (response.status !== 401 || !ownsAuthorization || !account.hasRefreshToken) return response
        const access = await account.refreshAccessToken(attachedAccess)
        const retryHeaders = new Headers(headers)
        retryHeaders.set("Authorization", `Bearer ${access}`)
        return baseFetch(retryInput, { ...init, headers: retryHeaders })
      },
      {
        preconnect: (...args: Parameters<typeof globalThis.fetch.preconnect>) => globalThis.fetch.preconnect?.(...args),
      },
    )

    const eventSdk = createNikcliClient({
      baseUrl: server.url,
      signal: abort.signal,
      fetch: authenticatedFetch,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }

    let queue: Array<Queued | undefined> = []
    let buffer: Array<Queued | undefined> = []
    const coalesced = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const key = (directory: string, payload: Event) => {
      if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
      if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
      if (payload.type === "message.part.updated") {
        const part = payload.properties.part
        return `message.part.updated:${directory}:${part.messageID}:${part.id}`
      }
    }

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined

      if (queue.length === 0) return

      const events = queue
      queue = buffer
      buffer = events
      queue.length = 0
      coalesced.clear()

      last = Date.now()
      batch(() => {
        for (const event of events) {
          if (!event) continue
          emitter.emit(event.directory, event.payload)
        }
      })

      buffer.length = 0
    }

    const schedule = () => {
      if (timer) return
      const elapsed = Date.now() - last
      timer = setTimeout(flush, Math.max(0, 16 - elapsed))
    }

    void (async () => {
      const events = await eventSdk.global.event()
      let yielded = Date.now()
      for await (const event of events.stream) {
        const directory = event.directory ?? "global"
        const payload = event.payload
        const k = key(directory, payload)
        if (k) {
          const i = coalesced.get(k)
          if (i !== undefined) {
            queue[i] = undefined
          }
          coalesced.set(k, queue.length)
        }
        queue.push({ directory, payload })
        schedule()

        if (Date.now() - yielded < 8) continue
        yielded = Date.now()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    })()
      .finally(flush)
      .catch(() => undefined)

    onCleanup(() => {
      abort.abort()
      flush()
    })

    const sdk = createNikcliClient({
      baseUrl: server.url,
      fetch: authenticatedFetch,
      throwOnError: true,
    })

    return {
      url: server.url,
      client: sdk,
      event: emitter,
      fetch: authenticatedFetch,
    }
  },
})
