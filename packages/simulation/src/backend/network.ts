import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { HttpRecorder, type HttpInteraction, type RequestSnapshot } from "@nikcli-ai/http-recorder"
import type { SimulationProtocol } from "../protocol"
import { SimulationOpenAI } from "./openai"

export type Mode = "driver" | "record" | "replay"

export interface Options {
  readonly endpoint: string
  readonly mode?: Mode
  readonly cassette?: string
  readonly directory?: string
  /** Origin of the real OpenAI-compatible endpoint, used only while recording. */
  readonly upstream?: string
  readonly apiKey?: string
  readonly fetch?: typeof fetch
}

export interface Server {
  readonly url: string
  readonly mode: Mode
  readonly log: () => readonly SimulationProtocol.Backend.NetworkLogEntry[]
  readonly stop: () => void
}

interface ReplayState {
  cassette: ReturnType<typeof HttpRecorder.parseCassette>
  cursor: number
}

const REQUEST_HEADERS = ["accept", "content-type", "authorization", "user-agent"]
const RESPONSE_HEADERS = ["content-type", "openai-processing-ms", "x-request-id"]
const LOG_LIMIT = 1000

function targetUrl(incoming: URL, upstream: string) {
  const origin = new URL(upstream)
  return new URL(incoming.pathname + incoming.search, origin).toString()
}

function requestHeaders(request: Request, apiKey?: string) {
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  headers.delete("host")
  headers.delete("connection")
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)
  return headers
}

function snapshotRequest(method: string, url: string, headers: Headers, body: string): RequestSnapshot {
  return {
    method,
    url: HttpRecorder.redactUrl(url),
    headers: HttpRecorder.redactHeaders(Object.fromEntries(headers.entries()), REQUEST_HEADERS),
    body,
  }
}

function responseHeaders(response: Response) {
  return HttpRecorder.redactHeaders(Object.fromEntries(response.headers.entries()), RESPONSE_HEADERS)
}

function fixtureResponse(interaction: HttpInteraction) {
  return new Response(interaction.response.body, {
    status: interaction.response.status,
    headers: interaction.response.headers,
  })
}

function cassetteRequired(mode: Mode, cassette?: string): asserts cassette is string {
  if (mode !== "driver" && !cassette) throw new Error(`NIKCLI simulation ${mode} mode requires a cassette name`)
}

export function optionsFromEnv(endpoint: string): Options {
  const raw = process.env.NIKCLI_SIMULATION_MODE ?? "driver"
  if (raw !== "driver" && raw !== "record" && raw !== "replay") {
    throw new Error(`Invalid NIKCLI_SIMULATION_MODE: ${raw}`)
  }
  return {
    endpoint,
    mode: raw,
    cassette: process.env.NIKCLI_SIMULATION_CASSETTE,
    directory: process.env.NIKCLI_SIMULATION_CASSETTES_DIR,
    upstream: process.env.NIKCLI_SIMULATION_UPSTREAM,
    apiKey: process.env.NIKCLI_SIMULATION_API_KEY,
  }
}

async function concreteEndpoint(input: string) {
  const endpoint = new URL(input)
  if (endpoint.port !== "0") return endpoint
  const port = await new Promise<number>((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, endpoint.hostname, () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close()
        reject(new Error(`Unable to allocate a simulation port for ${input}`))
        return
      }
      probe.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
  endpoint.port = String(port)
  return endpoint
}

export async function start(options: Options): Promise<Server> {
  const mode = options.mode ?? "driver"
  const cassetteName = options.cassette
  cassetteRequired(mode, cassetteName)
  const directory = resolve(options.directory ?? ".simulation/recordings")
  const upstream = options.upstream ?? "https://api.openai.com"
  const liveFetch = options.fetch ?? fetch
  const log: SimulationProtocol.Backend.NetworkLogEntry[] = []
  let replay: ReplayState | undefined
  let recorded: ReturnType<typeof HttpRecorder.parseCassette> | undefined

  const recordLog = (entry: SimulationProtocol.Backend.NetworkLogEntry) => {
    log.push(entry)
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
  }

  const loadReplay = async () => {
    if (replay) return replay
    const file = HttpRecorder.cassettePath(cassetteName, directory)
    const cassette = HttpRecorder.parseCassette(await readFile(file, "utf8"))
    replay = { cassette, cursor: 0 }
    return replay
  }

  const replayRequest = async (request: Request, incoming: URL) => {
    const body = await request.text()
    const headers = requestHeaders(request, options.apiKey)
    const snapshot = snapshotRequest(request.method, targetUrl(incoming, upstream), headers, body)
    const state = await loadReplay()
    const interactions = HttpRecorder.httpInteractions(state.cassette)
    const interaction = interactions[state.cursor]
    if (!interaction) {
      throw new Error(
        `Simulation cassette "${cassetteName}" has no interaction ${state.cursor + 1} (recorded: ${interactions.length})`,
      )
    }
    if (!HttpRecorder.defaultMatcher(snapshot, interaction.request)) {
      const diff = HttpRecorder.requestDiff(interaction.request, snapshot).join("\n")
      throw new Error(
        `Simulation cassette "${cassetteName}" request mismatch at interaction ${state.cursor + 1}:\n${diff}`,
      )
    }
    state.cursor++
    return fixtureResponse(interaction)
  }

  const recordRequest = async (request: Request, incoming: URL) => {
    const body = await request.text()
    const headers = requestHeaders(request, options.apiKey)
    const url = targetUrl(incoming, upstream)
    const response = await liveFetch(url, { method: request.method, headers, body })
    const responseBody = await response.text()
    const interaction: HttpInteraction = {
      transport: "http",
      request: snapshotRequest(request.method, url, headers, body),
      response: {
        status: response.status,
        headers: responseHeaders(response),
        body: responseBody,
        bodyEncoding: "text",
      },
    }
    recorded = HttpRecorder.cassetteFor(cassetteName, [...(recorded?.interactions ?? []), interaction], {
      source: "nikcli-simulation",
      upstream: new URL(upstream).origin,
    })
    const findings = HttpRecorder.cassetteSecretFindings(recorded)
    if (findings.length > 0) {
      throw new Error(
        `Refusing to write simulation cassette "${cassetteName}" because it contains possible secrets: ${findings
          .map((item) => `${item.path} (${item.reason})`)
          .join(", ")}`,
      )
    }
    const file = HttpRecorder.cassettePath(cassetteName, directory)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, HttpRecorder.formatCassette(recorded), "utf8")
    return new Response(responseBody, { status: response.status, headers: responseHeaders(response) })
  }

  const endpoint = await concreteEndpoint(options.endpoint)
  const bun = Bun.serve({
    hostname: endpoint.hostname,
    port: Number(endpoint.port),
    // Driver-mode SSE streams stay open until the driver pushes chunks; a
    // slow driver must not trip Bun's default 10s idle timeout mid-exchange.
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true, mode })
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        recordLog({ time: Date.now(), method: request.method, url: url.toString(), mode, matched: false })
        return Response.json(
          { error: { message: `Simulation denied unregistered route: ${request.method} ${url.pathname}` } },
          { status: 404 },
        )
      }
      recordLog({
        time: Date.now(),
        method: request.method,
        url: url.toString(),
        mode,
        matched: true,
        cassette: mode === "driver" ? undefined : cassetteName,
      })
      try {
        if (mode === "driver") return await SimulationOpenAI.respond(request)
        if (mode === "record") return await recordRequest(request, url)
        return await replayRequest(request, url)
      } catch (error) {
        return Response.json(
          { error: { type: "simulation_error", message: error instanceof Error ? error.message : String(error) } },
          { status: mode === "replay" ? 409 : 502 },
        )
      }
    },
  })

  return {
    url: bun.url.origin,
    mode,
    log: () => log,
    stop: () => bun.stop(true),
  }
}

export * as SimulationNetwork from "./network"
