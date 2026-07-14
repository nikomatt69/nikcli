import { Effect } from "effect"
import { SimulationProtocol } from "../protocol"
import { SimulationLLMExchange } from "./llm-exchange"
import type { Server as NetworkServer } from "./network"

type ControlSocket = Bun.ServerWebSocket<{ unsubscribe?: () => void }>

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.Backend.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

async function handle(
  socket: ControlSocket,
  request: SimulationProtocol.Backend.Request,
  network: Pick<NetworkServer, "log">,
): Promise<unknown> {
  switch (request.method) {
    case "llm.attach":
      socket.data.unsubscribe?.()
      socket.data.unsubscribe = SimulationLLMExchange.subscribe((exchange) => {
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "llm.request", params: exchange }))
      })
      return { attached: true }
    case "llm.chunk":
      await Effect.runPromise(
        SimulationLLMExchange.push(
          request.params.id,
          request.params.items.map((item) => ({ type: "item", item }) as const),
        ),
      )
      return { ok: true }
    case "llm.finish":
      await Effect.runPromise(
        SimulationLLMExchange.push(request.params.id, [{ type: "finish", reason: request.params.reason }]),
      )
      return { ok: true }
    case "llm.disconnect":
      await Effect.runPromise(SimulationLLMExchange.disconnect(request.params.id))
      return { ok: true }
    case "llm.pending":
      return { exchanges: SimulationLLMExchange.pending() }
    case "network.log":
      return { entries: network.log() }
  }
}

export function start(endpoint: string, network: Pick<NetworkServer, "log">) {
  const url = new URL(endpoint)
  const server = Bun.serve<{ unsubscribe?: () => void }>({
    hostname: url.hostname,
    port: Number(url.port),
    fetch(request, server) {
      if (server.upgrade(request, { data: {} })) return undefined
      return new Response("nikcli drive backend websocket", { status: 426 })
    },
    websocket: {
      close(socket) {
        socket.data.unsubscribe?.()
      },
      async message(socket, message) {
        let request: SimulationProtocol.Backend.Request | undefined
        try {
          request = parseRequest(message)
          const result = await handle(socket, request, network)
          const response = SimulationProtocol.JsonRpc.success(request.id, result)
          if (response) socket.send(JSON.stringify(response))
        } catch (error) {
          socket.send(JSON.stringify(SimulationProtocol.JsonRpc.failure(request?.id, error)))
        }
      },
    },
  })
  return { url: endpoint, stop: () => server.stop(true) }
}

export * as SimulationControl from "./control"
