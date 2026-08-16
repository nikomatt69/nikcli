import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"
import { ShareNext } from "@/share/share-next"
import { ChatbotHttp } from "./httpapi/chatbot"
import { HttpApiEvent } from "./httpapi/event"
import { HttpApiPrompt } from "./httpapi/prompt"
import { UsersHttp } from "./httpapi/users"
import { AccountHttp } from "./httpapi/account"
import { isAccountPath } from "./httpapi/account-path"
import { extraRequest } from "./extra"
import { companionResponse } from "./companion"
import { SyncHttpApi } from "./httpapi/sync"

export namespace PublicRoutes {
  const csp =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws: wss: https: blob: data:"

  function share(shareID: string) {
    return runPromiseWithLayer(
      ShareNext.defaultLayer,
      Effect.gen(function* () {
        const service = yield* ShareNext.Service
        return yield* service.publicData(shareID)
      }),
    )
  }

  export async function publicRequest(request: Request): Promise<Response | undefined> {
    if (request.method !== "GET") return
    const pathname = new URL(request.url).pathname
    const short = pathname.match(/^\/s\/([^/]+)$/)
    if (short) {
      return new Response(null, {
        status: 308,
        headers: { location: `/share/${encodeURIComponent(decodeURIComponent(short[1]))}` },
      })
    }
    const match = pathname.match(/^\/(?:share\/([^/]+)|api\/share\/([^/]+)(?:\/data)?)$/)
    if (!match) return
    const data = await share(decodeURIComponent(match[1] ?? match[2]))
    if (!data) return new Response("Share not found", { status: 404 })
    return Response.json(data)
  }

  export async function globalRequest(request: Request): Promise<Response | undefined> {
    const pathname = new URL(request.url).pathname
    if (request.method === "GET" && pathname === "/global/event") return HttpApiEvent.handle()
    if (request.method === "GET" && pathname === "/sync/stream") return SyncHttpApi.handleSse(request)
    if (pathname.startsWith("/user/")) return (await UsersHttp.handle(request)) ?? undefined
    if (isAccountPath(pathname)) return (await AccountHttp.handle(request)) ?? undefined
  }

  export async function instanceRequest(request: Request): Promise<Response | undefined> {
    const extra = await extraRequest(request)
    if (extra) return extra
    const pathname = new URL(request.url).pathname
    if (request.method === "GET" && pathname === "/event") return HttpApiEvent.handleInstance()
    if (request.method === "GET" && pathname === "/companion") return companionResponse(request)
    if (request.method !== "POST") return
    const prompt = pathname.match(/^\/session\/([^/]+)\/message$/)
    if (prompt) return HttpApiPrompt.prompt(request, decodeURIComponent(prompt[1]))
    const promptAsync = pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
    if (promptAsync) return HttpApiPrompt.promptAsync(request, decodeURIComponent(promptAsync[1]))
    if (pathname.startsWith("/chatbot/")) {
      // Falls through when unmatched: `/chatbot/bots*` is a declared group, and
      // answering 404 here would shadow it.
      const webhook = await ChatbotHttp.handle(request)
      if (webhook) return webhook
    }
  }

  export async function proxy(request: Request): Promise<Response> {
    const source = new URL(request.url)
    const target = new URL(source.pathname + source.search, "https://app.nikcli.store")
    const headers = new Headers(request.headers)
    headers.set("host", "app.nikcli.store")
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      signal: request.signal,
    })
    response.headers.set("Content-Security-Policy", csp)
    return response
  }
}
