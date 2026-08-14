import { Effect } from "effect"
import { Pty } from "@/pty"
import { PluginPtyEnvironment } from "@/plugin/pty-environment"
import { InstanceBootstrap } from "@/project/bootstrap"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { Log } from "@nikcli-ai/util/log"
import { ServerProxy } from "./proxy"

const log = Log.create({ service: "server.websocket" })

export type WebSocketData =
  | {
      readonly type: "pty"
      readonly ptyID: string
      readonly directory: string
      readonly workspaceID?: string
      handler?: Pty.Connection
    }
  | ServerProxy.WebSocketData

function runPty<A, E>(effect: Effect.Effect<A, E, Pty.Service>) {
  return runPromiseWithLayer(PluginPtyEnvironment.ptyLayer, withCurrentInstance(effect))
}

function withPtyInstance<T>(data: Extract<WebSocketData, { type: "pty" }>, fn: () => Promise<T>) {
  return withInstanceAsync({ directory: data.directory, workspaceID: data.workspaceID, init: InstanceBootstrap }, () =>
    WorkspaceContext.provide({ workspaceID: data.workspaceID, fn }),
  )
}

function textFromMessage(message: string | ArrayBuffer | Uint8Array) {
  if (typeof message === "string") return message
  if (message instanceof ArrayBuffer) return new TextDecoder().decode(message)
  return new TextDecoder().decode(message)
}

async function handlePtyMessage(
  data: Extract<WebSocketData, { type: "pty" }>,
  handler: Pty.Connection | undefined,
  text: string,
) {
  if (text.charCodeAt(0) === 123 /* { */) {
    try {
      const msg = JSON.parse(text) as Record<string, unknown>
      if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        await withPtyInstance(data, () =>
          runPty(
            Effect.gen(function* () {
              const pty = yield* Pty.Service
              yield* pty.resize(data.ptyID, msg.cols as number, msg.rows as number)
            }),
          ),
        ).catch((error) => {
          log.warn("pty resize failed", { id: data.ptyID, error })
        })
        return
      }
    } catch {
      // Not a JSON control message — fall through and treat it as PTY input.
    }
  }
  handler?.onMessage(text)
}

export const ServerWebSocket = {
  handlers: {
    open(ws: Bun.ServerWebSocket<WebSocketData>) {
      if (ws.data.type === "proxy") {
        ServerProxy.open(ws as Bun.ServerWebSocket<ServerProxy.WebSocketData>)
        return
      }
      const data = ws.data
      void withPtyInstance(data, async () => {
        const handler = await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.connect(data.ptyID, ws)
          }),
        )
        data.handler = handler
      }).catch((error) => {
        log.warn("pty connect failed", { id: data.ptyID, error })
        ws.close(1011, "pty connect failed")
      })
    },
    message(ws: Bun.ServerWebSocket<WebSocketData>, message: string | ArrayBuffer | Uint8Array) {
      if (ws.data.type === "proxy") {
        ServerProxy.message(ws as Bun.ServerWebSocket<ServerProxy.WebSocketData>, message)
        return
      }
      void handlePtyMessage(ws.data, ws.data.handler, textFromMessage(message))
    },
    close(ws: Bun.ServerWebSocket<WebSocketData>, code: number, reason: string) {
      if (ws.data.type === "proxy") {
        ServerProxy.close(ws as Bun.ServerWebSocket<ServerProxy.WebSocketData>, code, reason)
        return
      }
      ws.data.handler?.onClose()
    },
  },

  match(pathname: string) {
    const desktop = pathname.match(/^\/pty\/([^/]+)\/connect\/?$/)
    if (desktop) return { kind: "pty" as const, ptyID: decodeURIComponent(desktop[1]) }
    const mobile = pathname.match(/^\/mobile\/pty\/([^/]+)\/connect\/?$/)
    if (mobile) return { kind: "pty" as const, ptyID: decodeURIComponent(mobile[1]) }
  },

  upgrade(server: Bun.Server<WebSocketData>, request: Request, data: WebSocketData) {
    if (server.upgrade(request, { data })) return undefined
    return new Response("WebSocket upgrade failed", { status: 400 })
  },
}
