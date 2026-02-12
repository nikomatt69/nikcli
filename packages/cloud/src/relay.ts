import type { CloudBindings } from "./types"

type RelayAttachment = {
  userID: string
  deviceID?: string
  sessionID: string
  connectedAt: number
}

type RelayEnvelope = {
  type: string
  payload: unknown
  timestamp: number
}

type RelaySocket = WebSocket & {
  serializeAttachment?: (value: unknown) => void
  deserializeAttachment?: () => unknown
}

const MAX_RELAY_PAYLOAD_BYTES = 256_000

function getAttachment(socket: RelaySocket): RelayAttachment {
  const raw = socket.deserializeAttachment?.()
  if (!raw || typeof raw !== "object") {
    return {
      userID: "unknown",
      sessionID: "unknown",
      connectedAt: Date.now(),
    }
  }

  const data = raw as Partial<RelayAttachment>
  return {
    userID: typeof data.userID === "string" ? data.userID : "unknown",
    deviceID: typeof data.deviceID === "string" ? data.deviceID : undefined,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : "unknown",
    connectedAt: typeof data.connectedAt === "number" ? data.connectedAt : Date.now(),
  }
}

export class RelayRoom {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: CloudBindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("upgrade")
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 })
    }

    const userID = request.headers.get("x-nikcli-user-id") || "unknown"
    const sessionID = request.headers.get("x-nikcli-session-id") || "unknown"
    const deviceID = request.headers.get("x-nikcli-device-id") || undefined

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1] as RelaySocket

    this.state.acceptWebSocket(server)
    server.serializeAttachment?.({
      userID,
      deviceID,
      sessionID,
      connectedAt: Date.now(),
    } satisfies RelayAttachment)

    this.broadcast(
      {
        type: "relay.presence",
        payload: {
          kind: "join",
          userID,
          deviceID,
          sessionID,
          peers: this.state.getWebSockets().length,
        },
        timestamp: Date.now(),
      },
      server,
    )

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const sender = socket as RelaySocket

    if (typeof message !== "string") {
      if (message.byteLength > MAX_RELAY_PAYLOAD_BYTES) {
        sender.close(1009, "Message too large")
        return
      }
      const decoded = new TextDecoder().decode(message)
      this.handleTextMessage(sender, decoded)
      return
    }

    this.handleTextMessage(sender, message)
  }

  webSocketClose(socket: WebSocket): void {
    const sender = socket as RelaySocket
    const attachment = getAttachment(sender)

    this.broadcast(
      {
        type: "relay.presence",
        payload: {
          kind: "leave",
          userID: attachment.userID,
          deviceID: attachment.deviceID,
          sessionID: attachment.sessionID,
          peers: Math.max(0, this.state.getWebSockets().length - 1),
        },
        timestamp: Date.now(),
      },
      sender,
    )
  }

  webSocketError(socket: WebSocket): void {
    const sender = socket as RelaySocket
    try {
      sender.close(1011, "Relay socket error")
    } catch {
      // ignored: socket may already be closed
    }
  }

  private handleTextMessage(sender: RelaySocket, raw: string): void {
    if (raw === "ping") {
      sender.send(
        JSON.stringify({
          type: "relay.pong",
          timestamp: Date.now(),
        }),
      )
      return
    }

    if (raw.length > MAX_RELAY_PAYLOAD_BYTES) {
      sender.close(1009, "Message too large")
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      sender.send(
        JSON.stringify({
          type: "relay.error",
          payload: { message: "Invalid JSON payload" },
          timestamp: Date.now(),
        }),
      )
      return
    }

    const attachment = getAttachment(sender)
    this.broadcast(
      {
        type: "relay.message",
        payload: {
          from: {
            userID: attachment.userID,
            deviceID: attachment.deviceID,
          },
          sessionID: attachment.sessionID,
          body: payload,
        },
        timestamp: Date.now(),
      },
      sender,
    )
  }

  private broadcast(envelope: RelayEnvelope, exclude?: WebSocket): void {
    const message = JSON.stringify(envelope)
    for (const socket of this.state.getWebSockets()) {
      if (exclude && socket === exclude) continue
      try {
        socket.send(message)
      } catch {
        try {
          socket.close(1011, "Relay send failure")
        } catch {
          // ignored: socket may already be closed
        }
      }
    }
  }
}
