import { RemoteServer } from "./server"
import type { RemoteSession, ServerConfig, TunnelProvider } from "./types"
import WebSocket, { type RawData } from "ws"

export { RemoteServer } from "./server"
export type { RemoteServerEvents } from "./server"
export { CloudAgent } from "./cloud-agent"
export type { CloudAgentConfig, CloudDeviceRegistration, CloudSyncOperation } from "./cloud-agent"
export {
  TunnelManager,
  createTunnel,
  checkTunnelAvailability,
  findAvailableTunnel,
  probeTunnel,
  type TunnelResult,
} from "./tunnel"
export { generateQR, generateQRDataURL, renderSessionCard, type QROptions } from "./qrcode"
export type { RemoteSession, TunnelProvider } from "./types"

export interface TerminalConnection {
  url: string
  output: AsyncIterable<string>
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  close: () => void
}

export async function connectToTerminal(url: string, token?: string): Promise<TerminalConnection> {
  const ws = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve())
    ws.on("error", reject)
  })

  let resolveOutput: ((value: IteratorResult<string>) => void) | null = null
  let outputQueue: string[] = []
  let outputDone = false

  return new Promise((resolve, reject) => {
    ws.on("message", (data: RawData) => {
      try {
        const text = data instanceof Buffer ? data.toString() : data.toString()
        const parsed = JSON.parse(text)

        if (parsed.type === "auth:required" && token) {
          ws.send(JSON.stringify({ type: "auth", token }))
        } else if (parsed.type === "auth:success") {
          resolve({
            url,
            output: {
              [Symbol.asyncIterator]() {
                return {
                  next: () => {
                    if (outputQueue.length > 0) {
                      return Promise.resolve({ done: false, value: outputQueue.shift()! })
                    }
                    if (outputDone) {
                      return Promise.resolve({ done: true, value: "" })
                    }
                    return new Promise((res) => {
                      resolveOutput = res
                    })
                  },
                }
              },
            },
            resize: (cols: number, rows: number) => {
              ws.send(JSON.stringify({ type: "terminal:resize", payload: { cols, rows } }))
            },
            write: (data: string) => {
              ws.send(JSON.stringify({ type: "terminal:input", payload: { data } }))
            },
            close: () => {
              outputDone = true
              ws.close()
            },
          })
        } else if (parsed.type === "auth:failed") {
          reject(new Error("Authentication failed"))
        } else if (parsed.type === "terminal:output" && parsed.payload?.data) {
          outputQueue.push(parsed.payload.data)
          if (resolveOutput) {
            resolveOutput({ done: false, value: outputQueue.shift()! })
            resolveOutput = null
          }
        }
      } catch {}
    })

    ws.on("error", reject)

    if (!token) {
      resolve({
        url,
        output: {
          [Symbol.asyncIterator]() {
            return {
              next: () => {
                if (outputQueue.length > 0) {
                  return Promise.resolve({ done: false, value: outputQueue.shift()! })
                }
                if (outputDone) {
                  return Promise.resolve({ done: true, value: "" })
                }
                return new Promise((res) => {
                  resolveOutput = res
                })
              },
            }
          },
        },
        resize: (cols: number, rows: number) => {
          ws.send(JSON.stringify({ type: "terminal:resize", payload: { cols, rows } }))
        },
        write: (data: string) => {
          ws.send(JSON.stringify({ type: "terminal:input", payload: { data } }))
        },
        close: () => {
          outputDone = true
          ws.close()
        },
      })
    }
  })
}

export async function createRemoteServer(
  config: Partial<ServerConfig> = {},
): Promise<{ server: RemoteServer; session: RemoteSession }> {
  const { RemoteServer: RemoteServerCls } = await import("./server")
  const server = new RemoteServerCls(config)
  const session = await server.start()
  return { server, session }
}
