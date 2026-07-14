import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { workerEnv } from "../src/backend"
import { SimulationLLMExchange } from "../src/backend/llm-exchange"
import { SimulationNetwork, type Server } from "../src/backend/network"

const servers: Server[] = []

const freeEndpoint = () =>
  new Promise<string>((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close()
        reject(new Error("Unable to allocate test port"))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(`http://127.0.0.1:${address.port}`)))
    })
  })

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop()
  await SimulationLLMExchange.reset()
})

const prompt = (url: string, body: unknown = { model: "sim-model", messages: [], stream: true }) =>
  fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fixture" },
    body: JSON.stringify(body),
  })

describe("driver-backed OpenAI mock", () => {
  test("injects an isolated deterministic provider into the nikcli worker", () => {
    const env = workerEnv("http://127.0.0.1:40960", JSON.stringify({ theme: "system" }))
    const config = JSON.parse(env.NIKCLI_CONFIG_CONTENT!)

    expect(config.theme).toBe("system")
    expect(config.model).toBe("simulation/deterministic")
    expect(config.provider.simulation.options.baseURL).toBe("http://127.0.0.1:40960/v1")
    expect(config.provider.simulation.models.deterministic).toMatchObject({ cost: { input: 0, output: 0 } })
    expect(env.NIKCLI_DISABLE_MODELS_FETCH).toBe("1")
  })

  test("streams driver chunks through real OpenAI SSE framing", async () => {
    const server = await SimulationNetwork.start({ endpoint: "http://127.0.0.1:0", mode: "driver" })
    servers.push(server)
    const opened = new Promise<SimulationLLMExchange.OpenedExchange>((resolve) => {
      const unsubscribe = SimulationLLMExchange.subscribe((exchange) => {
        unsubscribe()
        resolve(exchange)
      })
    })

    const responsePromise = prompt(server.url)
    const exchange = await opened
    expect(exchange.body).toMatchObject({ model: "sim-model", stream: true })
    await Effect.runPromise(
      SimulationLLMExchange.push(exchange.id, [
        { type: "item", item: { type: "textDelta", text: "deterministic " } },
        { type: "item", item: { type: "textDelta", text: "reply" } },
        { type: "finish", reason: "stop" },
      ]),
    )

    const response = await responsePromise
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('"content":"deterministic "')
    expect(body).toContain('"content":"reply"')
    expect(body).toContain('"finish_reason":"stop"')
    expect(body).toEndWith("data: [DONE]\n\n")
    expect(server.log()).toHaveLength(1)
  })
})

describe("network cassette record/replay", () => {
  test("records once and replays without touching the upstream network", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nikcli-simulation-cassettes-"))
    let upstreamCalls = 0
    const upstreamEndpoint = new URL(await freeEndpoint())
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: Number(upstreamEndpoint.port),
      fetch: async (request) => {
        upstreamCalls++
        const requestBody = await request.json()
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: `recorded:${requestBody.model}` } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })

    try {
      const record = await SimulationNetwork.start({
        endpoint: "http://127.0.0.1:0",
        mode: "record",
        cassette: "tui/basic",
        directory,
        upstream: upstream.url.origin,
      })
      servers.push(record)
      const recorded = await prompt(record.url)
      const recordedBody = await recorded.text()
      expect(recordedBody).toContain("recorded:sim-model")
      expect(upstreamCalls).toBe(1)
      record.stop()
      servers.splice(servers.indexOf(record), 1)
      upstream.stop(true)

      const replay = await SimulationNetwork.start({
        endpoint: "http://127.0.0.1:0",
        mode: "replay",
        cassette: "tui/basic",
        directory,
        upstream: upstream.url.origin,
        fetch: (() => Promise.reject(new Error("replay attempted network access"))) as unknown as typeof fetch,
      })
      servers.push(replay)

      const mismatch = await prompt(replay.url, { model: "different", messages: [], stream: true })
      expect(mismatch.status).toBe(409)
      expect(await mismatch.text()).toContain("request mismatch")

      const replayed = await prompt(replay.url)
      expect(replayed.status).toBe(200)
      expect(await replayed.text()).toBe(recordedBody)
      expect(upstreamCalls).toBe(1)
    } finally {
      upstream.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
