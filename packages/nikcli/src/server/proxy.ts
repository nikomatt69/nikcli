import type { Target } from "../workspace/adaptors/types"

const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

export type Message = string | ArrayBuffer | Uint8Array

function headers(req: Request, extra?: HeadersInit) {
  const out = new Headers(req.headers)
  for (const key of hop) out.delete(key)
  out.delete("x-nikcli-directory")
  out.delete("x-nikcli-workspace")
  for (const [key, value] of new Headers(extra).entries()) out.set(key, value)
  return out
}

function protocols(req: Request) {
  return (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function socketUrl(target: Extract<Target, { type: "remote" }>, req: Request) {
  const base = new URL(String(target.url))
  const source = new URL(req.url)
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:"
  base.pathname = source.pathname
  base.search = source.search
  return base.toString()
}

export namespace ServerProxy {
  export interface WebSocketData {
    readonly type: "proxy"
    readonly url: string
    readonly protocols: string[]
    remote?: WebSocket
    queue: Message[]
  }

  export function http(target: Extract<Target, { type: "remote" }>, req: Request) {
    const baseURL = String(target.url).replace(/\/?$/, "")
    const url = new URL(req.url)
    return fetch(new URL(baseURL + url.pathname + url.search), {
      method: req.method,
      headers: headers(req, target.headers),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
      signal: req.signal,
    })
  }

  export function data(target: Extract<Target, { type: "remote" }>, req: Request): WebSocketData {
    return { type: "proxy", url: socketUrl(target, req), protocols: protocols(req), queue: [] }
  }

  export function open(ws: Bun.ServerWebSocket<WebSocketData>) {
    const data = ws.data
    const remote = new WebSocket(data.url, data.protocols)
    data.remote = remote
    remote.binaryType = "arraybuffer"
    remote.onopen = () => {
      for (const item of data.queue) remote.send(item as Parameters<WebSocket["send"]>[0])
      data.queue.length = 0
    }
    remote.onmessage = (event) => {
      if (event.data instanceof Blob) void event.data.arrayBuffer().then((value) => ws.send(value))
      else ws.send(event.data as Message)
    }
    remote.onerror = () => ws.close(1011, "proxy error")
    remote.onclose = (event) => ws.close(event.code, event.reason)
  }

  export function message(ws: Bun.ServerWebSocket<WebSocketData>, message: Message) {
    const remote = ws.data.remote
    if (remote?.readyState === WebSocket.OPEN) {
      remote.send(message as Parameters<WebSocket["send"]>[0])
      return
    }
    ws.data.queue.push(message)
  }

  export function close(ws: Bun.ServerWebSocket<WebSocketData>, code: number, reason: string) {
    ws.data.remote?.close(code, reason)
  }
}
