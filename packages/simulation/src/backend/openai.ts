import { Effect, Schema, Stream } from "effect"
import { OpenAIChatEvent } from "@nikcli-ai/llm/protocols/openai-chat"
import { SimulationLLMExchange } from "./llm-exchange"

const encodeChunk = Schema.encodeUnknownSync(OpenAIChatEvent)
const encoder = new TextEncoder()

function chunkOf(item: SimulationLLMExchange.Item): OpenAIChatEvent | unknown {
  if (item.type === "textDelta") return { choices: [{ delta: { content: item.text } }] }
  if (item.type === "reasoningDelta") return { choices: [{ delta: { reasoning_content: item.text } }] }
  if (item.type === "toolCall") {
    return {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: item.index,
                id: item.id,
                function: { name: item.name, arguments: JSON.stringify(item.input) },
              },
            ],
          },
        },
      ],
    }
  }
  return item.chunk
}

const finishReasonWire: Record<SimulationLLMExchange.FinishReason, string> = {
  stop: "stop",
  "tool-calls": "tool_calls",
  length: "length",
  "content-filter": "content_filter",
}

function frame(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function sseBody(exchange: SimulationLLMExchange.Exchange): Stream.Stream<Uint8Array> {
  const chunks = Stream.fromQueue(exchange.queue).pipe(
    Stream.takeUntil((chunk) => chunk.type === "finish"),
    Stream.map((chunk) => {
      if (chunk.type === "finish") {
        return frame(encodeChunk({ choices: [{ delta: {}, finish_reason: finishReasonWire[chunk.reason] }] }))
      }
      if (chunk.item.type === "raw") return frame(chunk.item.chunk)
      return frame(encodeChunk(chunkOf(chunk.item)))
    }),
  )
  return chunks.pipe(
    Stream.concat(Stream.make(encoder.encode("data: [DONE]\n\n"))),
    Stream.ensuring(SimulationLLMExchange.close(exchange.id)),
  )
}

export async function respond(request: Request): Promise<Response> {
  const raw = await request.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ error: { message: "OpenAI simulation expected a JSON request body" } }, { status: 400 })
  }
  const exchange = await Effect.runPromise(SimulationLLMExchange.open({ url: request.url, body }))
  return new Response(Stream.toReadableStream(sseBody(exchange)), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

export * as SimulationOpenAI from "./openai"
