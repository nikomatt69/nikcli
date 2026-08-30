import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { EventFeed } from "../httpapi/event-feed"

const HEARTBEAT_MS = 30_000

/** Instance-scoped live updates the mobile app actually renders. */
const ALLOWED_PREFIXES = ["mission.", "loop.", "todo.", "lsp.", "server."] as const

const instanceFeeds = new Map<string, { feed: EventFeed.Feed; unsubscribe: () => void }>()
const envelope: EventFeed.Envelope = (event) => event

function allowed(type: unknown) {
  if (typeof type !== "string") return false
  return ALLOWED_PREFIXES.some((prefix) => type.startsWith(prefix))
}

function instanceFeed(directory: string) {
  const existing = instanceFeeds.get(directory)
  if (existing) return existing.feed

  const feed = new EventFeed.Feed(envelope)
  const unsubscribe = Bus.subscribeAll((event: { type?: string }) => {
    if (!allowed(event.type)) return
    feed.broadcast(event)
    if (event.type === Bus.InstanceDisposed.type) {
      releaseInstanceFeed(directory)
      feed.closeAll()
    }
  })
  instanceFeeds.set(directory, { feed, unsubscribe })
  return feed
}

function releaseInstanceFeed(directory: string) {
  const entry = instanceFeeds.get(directory)
  if (!entry) return
  instanceFeeds.delete(directory)
  entry.unsubscribe()
}

export async function handleEventsRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path !== "/mobile/events" || request.method !== "GET") return

  // R2 boundary: raw mobile SSE — same constraint as httpapi/event.ts.
  const directory = Instance.directory
  const feed = instanceFeed(directory)

  let connection: EventFeed.Connection | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = EventFeed.stream({
    start(controller) {
      connection = feed.attach(controller, () => {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        if (feed.size === 0) releaseInstanceFeed(directory)
      })
      connection.local({ type: "server.connected", properties: {} })
      heartbeat = setInterval(() => {
        connection?.local({ type: "server.heartbeat", properties: {} })
      }, HEARTBEAT_MS)
    },
    cancel() {
      connection?.abandon()
    },
  })

  return new Response(stream, { headers: { ...EventFeed.HEADERS } })
}
