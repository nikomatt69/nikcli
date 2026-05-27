import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { ulid } from "ulid"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import type * as SDK from "@nikcli-ai/sdk/v2"
import { Context, Effect, Layer, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export namespace ShareNext {
  const log = Log.create({ service: "share-next" })

  export class ShareError extends Schema.TaggedErrorClass<ShareError>()("ShareError", {
    cause: Schema.Unknown,
  }) {}

  type Data =
    | {
        type: "session"
        data: SDK.Session
      }
    | {
        type: "message"
        data: SDK.Message
      }
    | {
        type: "part"
        data: SDK.Part
      }
    | {
        type: "session_diff"
        data: SDK.FileDiff[]
      }
    | {
        type: "model"
        data: SDK.Model[]
      }

  type StoredShare = Session.ShareInfo

  type LocalShare = {
    id: string
    sessionID: string
    url: string
    time: {
      created: number
      updated: number
    }
    items: Record<string, Data>
  }

  const LOCAL_SHARE_PREFIX = ["local_share"]

  export interface Interface {
    url(): Effect.Effect<string, ShareError>
    init(): Effect.Effect<void, ShareError>
    create(sessionID: string, input?: { baseUrl?: string }): Effect.Effect<StoredShare, ShareError>
    remove(sessionID: string): Effect.Effect<void, ShareError>
    publicData(shareID: string): Effect.Effect<Data[] | undefined, ShareError>
  }

  export class Service extends Context.Service<Service, Interface>()("ShareNext.Service") {}

  function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
    return runPromiseWithLayer(Storage.defaultLayer, effect)
  }

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }

  function storageWrite<T>(key: string[], content: T) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(key, content)
      }),
    )
  }

  function storageRead<T>(key: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<T>(key)
      }),
    )
  }

  function storageRemove(key: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.remove(key)
      }),
    )
  }

  function configGet() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  function providerGetModel(providerID: string, modelID: string) {
    return runPromiseWithLayer(
      Provider.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          return yield* provider.getModel(providerID, modelID)
        }),
      ),
    )
  }

  async function urlImpl() {
    return configGet().then((x) => x.enterprise?.url ?? "https://s.nikcli.store")
  }

  function isDisabled() {
    const value = process.env["NIKCLI_DISABLE_SHARE"]
    return value === "true" || value === "1"
  }

  async function initImpl() {
    if (isDisabled()) return
    Bus.subscribe(Session.Event.Updated, async (evt) => {
      await sync(evt.properties.info.id, [
        {
          type: "session",
          data: evt.properties.info,
        },
      ])
    })
    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      await sync(evt.properties.info.sessionID, [
        {
          type: "message",
          data: evt.properties.info,
        },
      ])
      if (evt.properties.info.role === "user") {
        await sync(evt.properties.info.sessionID, [
          {
            type: "model",
            data: [await providerGetModel(evt.properties.info.model.providerID, evt.properties.info.model.modelID)],
          },
        ])
      }
    })
    Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await sync(evt.properties.part.sessionID, [
        {
          type: "part",
          data: evt.properties.part,
        },
      ])
    })
    Bus.subscribe(Session.Event.Diff, async (evt) => {
      await sync(evt.properties.sessionID, [
        {
          type: "session_diff",
          data: evt.properties.diff,
        },
      ])
    })
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return String(error)
  }

  function normalizeBaseURL(input: string) {
    const url = new URL(input)
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  }

  function responseDetail(body: string) {
    const trimmed = body.trim()
    if (!trimmed) return ""

    try {
      const parsed = JSON.parse(trimmed) as any
      const detail =
        parsed?.message ?? parsed?.error?.message ?? parsed?.error ?? parsed?.data?.message ?? parsed?.title
      if (typeof detail === "string" && detail.trim()) return detail.trim()
    } catch {
      // fall back to plain text / html parsing
    }

    const title = trimmed.match(/<title>(.*?)<\/title>/i)?.[1]?.trim()
    if (title) return title

    return trimmed.replace(/\s+/g, " ").slice(0, 200)
  }

  async function requestText(input: string, init: RequestInit) {
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (error) {
      throw new Error(`Share service unreachable: ${errorMessage(error)}`)
    }

    const body = await response.text().catch(() => "")
    if (!response.ok) {
      const detail = responseDetail(body)
      throw new Error(
        detail ? `Share service error (${response.status}): ${detail}` : `Share service error (${response.status})`,
      )
    }

    return body
  }

  async function requestJSON<T>(input: string, init: RequestInit) {
    const body = await requestText(input, init)
    if (!body.trim()) {
      throw new Error("Share service returned an empty response")
    }

    try {
      return JSON.parse(body) as T
    } catch {
      throw new Error("Share service returned invalid JSON")
    }
  }

  function key(item: Data) {
    switch (item.type) {
      case "session":
        return "session"
      case "message":
        return `message:${item.data.id}`
      case "part":
        return `part:${item.data.id}`
      case "session_diff":
        return "session_diff"
      case "model":
        return item.data.length
          ? item.data.map((model) => `model:${model.providerID}:${model.id}`).join(",")
          : `model:${ulid()}`
    }
  }

  function toItemMap(data: Data[]) {
    return Object.fromEntries(data.map((item) => [key(item), item]))
  }

  async function get(sessionID: string) {
    return storageRead<StoredShare>(["session_share", sessionID])
  }

  async function getLocal(shareID: string) {
    return storageRead<LocalShare>([...LOCAL_SHARE_PREFIX, shareID])
  }

  async function payload(sessionID: string): Promise<Data[]> {
    const { session, diffs } = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        const session = yield* sessionService.get(sessionID)
        const diffs = yield* sessionService.diff(sessionID).pipe(Effect.catch(() => Effect.succeed([])))
        return { session, diffs }
      }),
    )
    const messages = await Array.fromAsync(MessageV2.stream(sessionID))
    const modelMap = new Map<string, SDK.Model>()

    for (const message of messages) {
      if (message.info.role !== "user") continue
      const model = (message.info as SDK.UserMessage).model
      const id = `${model.providerID}:${model.modelID}`
      if (modelMap.has(id)) continue
      const resolved = await providerGetModel(model.providerID, model.modelID).catch(() => undefined)
      if (!resolved) continue
      modelMap.set(id, resolved)
    }

    return [
      {
        type: "session",
        data: session,
      },
      ...messages.map((x) => ({
        type: "message" as const,
        data: x.info,
      })),
      ...messages.flatMap((x) => x.parts.map((y) => ({ type: "part" as const, data: y }))),
      {
        type: "session_diff",
        data: diffs,
      },
      {
        type: "model",
        data: Array.from(modelMap.values()),
      },
    ]
  }

  async function updateLocal(sessionID: string, share: StoredShare, data: Data[]) {
    const shareID = share.id
    if (!shareID) throw new Error("Local share is missing an id")

    const existing = await getLocal(shareID).catch(() => undefined)

    await storageWrite([...LOCAL_SHARE_PREFIX, shareID], {
      id: shareID,
      sessionID: existing?.sessionID ?? sessionID,
      url: share.url,
      time: {
        created: existing?.time.created ?? Date.now(),
        updated: Date.now(),
      },
      items: {
        ...existing?.items,
        ...toItemMap(data),
      },
    })
  }

  async function syncRemote(share: StoredShare, data: Data[]) {
    if (!share.id || !share.secret) {
      throw new Error("Stored share is missing id or secret")
    }

    await requestText(`${await urlImpl()}/api/share/${share.id}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: share.secret,
        data,
      }),
    })
  }

  async function syncNow(sessionID: string, data: Data[]) {
    const share = await get(sessionID).catch(() => undefined)
    if (!share) return

    if (share.mode === "local") {
      await updateLocal(sessionID, share, data)
      return
    }

    await syncRemote(share, data)
  }

  async function createLocal(sessionID: string, baseUrl: string) {
    const id = ulid().toLowerCase()
    const share: StoredShare = {
      id,
      mode: "local",
      url: `${normalizeBaseURL(baseUrl)}/share/${encodeURIComponent(id)}`,
    }
    const data = await payload(sessionID)
    await storageWrite(["session_share", sessionID], share)
    await storageWrite([...LOCAL_SHARE_PREFIX, id], {
      id,
      sessionID,
      url: share.url,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      items: toItemMap(data),
    })
    return share
  }

  async function createImpl(sessionID: string, input?: { baseUrl?: string }) {
    if (isDisabled()) {
      throw new Error("Sharing is disabled by NIKCLI_DISABLE_SHARE")
    }

    log.info("creating share", { sessionID })

    try {
      const result = await requestJSON<{ id: string; url: string; secret: string }>(`${await urlImpl()}/api/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionID }),
      })

      const share: StoredShare = {
        id: result.id,
        mode: "remote",
        secret: result.secret,
        url: result.url,
      }

      await storageWrite(["session_share", sessionID], share)
      await fullSync(sessionID)
      return share
    } catch (error) {
      if (!input?.baseUrl) throw error

      log.warn("remote share failed, using local fallback", {
        sessionID,
        error: errorMessage(error),
      })
      return createLocal(sessionID, input.baseUrl)
    }
  }

  const queue = new Map<string, { timeout: NodeJS.Timeout; data: Map<string, Data> }>()
  async function sync(sessionID: string, data: Data[]) {
    if (isDisabled()) return

    const existing = queue.get(sessionID)
    if (existing) {
      for (const item of data) {
        existing.data.set(key(item), item)
      }
      return
    }

    const dataMap = new Map<string, Data>()
    for (const item of data) {
      dataMap.set(key(item), item)
    }

    const timeout = setTimeout(async () => {
      const queued = queue.get(sessionID)
      if (!queued) return
      queue.delete(sessionID)
      await syncNow(sessionID, Array.from(queued.data.values())).catch((error) => {
        log.warn("share sync failed", {
          sessionID,
          error: errorMessage(error),
        })
      })
    }, 1000)

    queue.set(sessionID, { timeout, data: dataMap })
  }

  async function removeImpl(sessionID: string) {
    if (isDisabled()) return

    log.info("removing share", { sessionID })

    const queued = queue.get(sessionID)
    if (queued) {
      clearTimeout(queued.timeout)
      queue.delete(sessionID)
    }

    const share = await get(sessionID).catch(() => undefined)
    if (!share) return

    if (share.mode === "local") {
      if (share.id) {
        await storageRemove([...LOCAL_SHARE_PREFIX, share.id]).catch(() => undefined)
      }
      await storageRemove(["session_share", sessionID]).catch(() => undefined)
      return
    }

    if (share.id && share.secret) {
      await requestText(`${await urlImpl()}/api/share/${share.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: share.secret,
        }),
      }).catch((error) => {
        const message = errorMessage(error)
        if (message.includes("(404)")) return
        throw error
      })
    }

    await storageRemove(["session_share", sessionID]).catch(() => undefined)
  }

  async function fullSync(sessionID: string) {
    log.info("full sync", { sessionID })
    await syncNow(sessionID, await payload(sessionID))
  }

  async function publicDataImpl(shareID: string) {
    const share = await getLocal(shareID).catch(() => undefined)
    if (!share) return
    return Object.values(share.items)
  }

  const layer = Layer.succeed(
    Service,
    Service.of({
      url: () => Effect.tryPromise({ try: () => urlImpl(), catch: (e) => new ShareError({ cause: e }) }),
      init: () => Effect.tryPromise({ try: () => initImpl(), catch: (e) => new ShareError({ cause: e }) }),
      create: (sessionID, input) => Effect.tryPromise({ try: () => createImpl(sessionID, input), catch: (e) => new ShareError({ cause: e }) }),
      remove: (sessionID) => Effect.tryPromise({ try: () => removeImpl(sessionID), catch: (e) => new ShareError({ cause: e }) }),
      publicData: (shareID) => Effect.tryPromise({ try: () => publicDataImpl(shareID), catch: (e) => new ShareError({ cause: e }) }),
    }),
  )

  export const defaultLayer = layer
}
