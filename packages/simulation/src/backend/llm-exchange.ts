import { Effect, Queue } from "effect"

export type Item =
  | { readonly type: "textDelta"; readonly text: string }
  | { readonly type: "reasoningDelta"; readonly text: string }
  | {
      readonly type: "toolCall"
      readonly index: number
      readonly id: string
      readonly name: string
      readonly input: unknown
    }
  | { readonly type: "raw"; readonly chunk: unknown }

export type FinishReason = "stop" | "tool-calls" | "length" | "content-filter"

export type Chunk =
  | { readonly type: "item"; readonly item: Item }
  | { readonly type: "finish"; readonly reason: FinishReason }

export interface Exchange {
  readonly id: string
  readonly url: string
  readonly body: unknown
  readonly queue: Queue.Queue<Chunk>
}

export interface OpenedExchange {
  readonly id: string
  readonly url: string
  readonly body: unknown
}

const state = {
  counter: 0,
  exchanges: new Map<string, Exchange>(),
  listeners: new Set<(exchange: OpenedExchange) => void>(),
}

export class ExchangeNotFoundError extends Error {
  constructor(id: string) {
    super(`Simulation LLM exchange not found or already finished: ${id}`)
  }
}

export const open = (input: { readonly url: string; readonly body: unknown }) =>
  Effect.gen(function* () {
    const id = `ex_${++state.counter}`
    const queue = yield* Queue.unbounded<Chunk>()
    const exchange: Exchange = { id, url: input.url, body: input.body, queue }
    state.exchanges.set(id, exchange)
    for (const listener of state.listeners) listener({ id, url: input.url, body: input.body })
    return exchange
  })

export const close = (id: string) =>
  Effect.suspend(() => {
    const exchange = state.exchanges.get(id)
    state.exchanges.delete(id)
    if (!exchange) return Effect.void
    return Queue.shutdown(exchange.queue).pipe(Effect.asVoid)
  })

export const push = (id: string, chunks: readonly Chunk[]) =>
  Effect.gen(function* () {
    const exchange = state.exchanges.get(id)
    if (!exchange) return yield* Effect.fail(new ExchangeNotFoundError(id))
    yield* Queue.offerAll(exchange.queue, chunks)
  })

export const disconnect = (id: string) =>
  Effect.gen(function* () {
    const exchange = state.exchanges.get(id)
    if (!exchange) return yield* Effect.fail(new ExchangeNotFoundError(id))
    yield* Queue.shutdown(exchange.queue)
  })

export function subscribe(listener: (exchange: OpenedExchange) => void) {
  state.listeners.add(listener)
  for (const exchange of pending()) listener(exchange)
  return () => state.listeners.delete(listener)
}

export function pending(): OpenedExchange[] {
  return [...state.exchanges.values()].map((exchange) => ({
    id: exchange.id,
    url: exchange.url,
    body: exchange.body,
  }))
}

export async function reset() {
  const exchanges = [...state.exchanges.values()]
  state.exchanges.clear()
  state.listeners.clear()
  state.counter = 0
  await Promise.all(
    exchanges.map((exchange) => Effect.runPromise(Queue.shutdown(exchange.queue)).catch(() => undefined)),
  )
}

export * as SimulationLLMExchange from "./llm-exchange"
