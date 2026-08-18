import { HttpRouter } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { BunFileSystem, BunHttpServer, BunPath } from "@effect/platform-bun"
import { Context, Layer } from "effect"
import { InstanceRef, LogRedirect, sharedMemoMap } from "@/effect"
import { Instance } from "@/project/instance"
import { ChatbotHttp } from "./chatbot"
import { HttpApiEvent } from "./event"
import { HttpApiPrompt } from "./prompt"
import { PublicApi, PublicHttpApi } from "./public"
import { rawGlobalHandlers } from "./global-handlers"
import { instanceLessRoot } from "./instance-less"
import { Auth } from "./auth"

export namespace HttpApiBridge {
  /**
   * Test-only seam for the auth check in `handle()`. The production
   * credentials are computed each request via `Auth.currentCredentials()`,
   * which reads `Flag.NIKCLI_SERVER_PASSWORD` — but `Flag` is captured at
   * module-load time, so the test runner cannot flip the env var to
   * simulate a configured server. `overrideAuth(null|credentials)` lets a
   * test temporarily substitute the credentials without spawning a child
   * process. Reset in `finally` blocks so requests don't bleed across
   * tests; production behavior is unchanged unless this is non-null.
   */
  let testAuthOverride: Auth.Credentials | null = null
  export function overrideAuth(creds: Auth.Credentials | null) {
    testAuthOverride = creds
  }

  /**
   * Machine-readable route table for coverage checks.
   * `pattern` is the RegExp source (no flags). Prefer updating this list
   * whenever a new HttpApi surface lands; `script/check-route-coverage.ts`
   * and `test/server/routes-coverage.test.ts` assert every entry still
   * matches via `supports` / `supportsGlobal`.
   */
  export type RoutePattern = {
    readonly method: string
    readonly pattern: string
    readonly scope: "main" | "global"
  }

  /**
   * Convert an OpenAPI path template (`/session/{sessionID}/message`) into a
   * matchable RegExp (`/^\/session\/[^/]+\/message$/`). The template uses
   * `{name}` for path params; everything else is literal. `/` is matched
   * literally — name segments are `[^/]+` so a deep path stays that way.
   *
   * Special cases: a trailing `/?` mirrors the Hono-era routes that accept
   * the path with or without a trailing slash (still rare in the served
   * surface, kept only where the contract already allowed it).
   */
  function pathToRegex(template: string): RegExp {
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const substituted = escaped.replace(/\\\{[^/]+?\\\}/g, "[^/]+")
    return new RegExp(`^${substituted}$`)
  }

  /**
   * Walks the OpenAPI spec produced by `OpenApi.fromApi(PublicApi)` once at
   * module load. The pre-router allowlist cannot drift from the contract: a
   * new endpoint without a regex here fails at module load (because the
   * returned `Map` covers it), and the spec covers every route the bridge
   * serves. The traversal mirrors `inventory.ts:routes` so the two stay
   * aligned. Manual entries for non-OpenAPI surface (SSE / mobile prefix
   * match / `/sync/stream`) are appended afterwards.
   */
  function routesFromPublicApi(api: typeof PublicApi): ReadonlyArray<readonly [string, RegExp]> {
    const spec = OpenApi.fromApi(api) as Record<string, any>
    const verbMethods = ["get", "post", "put", "delete", "patch"] as const
    const result: Array<readonly [string, RegExp]> = []
    const paths = (spec.paths ?? {}) as Record<string, any>
    for (const [path, item] of Object.entries(paths)) {
      const re = pathToRegex(path)
      for (const method of verbMethods) {
        if (item?.[method]) result.push([method.toUpperCase(), re])
      }
    }
    return result
  }

  /**
   * Routes served by the bridge that are not in `PublicApi`:
   *
   * - `/event` and `/global/event` — SSE streams, kept as raw handlers
   *   because the contract declares them as `StreamSse` (a different
   *   response shape from a normal handler).
   * - `/sync/stream` — single SSE, served by `PublicRoutes.globalRequest`.
   * - `/sync/stats` and `/sync/{connect,disconnect,drain}` — served raw,
   *   declared in `ContractExtra`. Covered by the OpenAPI walk, but the
   *   generator catches them too.
   * - `/mobile/*` — a 404 under `/mobile/*` must not fall through to the
   *   website proxy (that was returning 200 HTML for deleted loops). The
   *   OpenAPI generator emits per-method regexes; the prefix match catches
   *   the methods it does not. Kept as a manual entry.
   * - `/sync/stats` — covered above; the regex + verb walk produces it.
   */
  const extraImplementedRoutes: ReadonlyArray<readonly [string, RegExp]> = [
    // Prefix match for any `/mobile/*` path that the OpenAPI walk missed.
    ["GET", /^\/mobile\//],
    ["POST", /^\/mobile\//],
    ["PUT", /^\/mobile\//],
    ["PATCH", /^\/mobile\//],
    ["DELETE", /^\/mobile\//],
  ]

  const generatedRoutes = routesFromPublicApi(PublicApi)
  const implementedRoutes = [...generatedRoutes, ...extraImplementedRoutes] as const

  /**
   * Instance-less routes served before instance context is bound. These must
   * never require `InstanceRef` — they run outside the instance/workspace
   * middleware, so `handleGlobal` provides no instance context.
   *
   * `/account` is not on `PublicApi` yet (it lives on the raw
   * `AccountHttp.handle` dispatcher ahead of the router), so it is the only
   * hand-rolled entry here. After H4 lands, this becomes a second call to
   * `routesFromPublicApi` against the account group.
   */
  const globalRoutes = [
    ...routesFromPublicApi(PublicApi).filter(([_, pattern]) => /^\/(global|user)\//.test(pattern.source)),
    ["GET", /^\/account$/],
    ["POST", /^\/account\/login$/],
    ["POST", /^\/account\/login\/complete$/],
  ] as const

  /**
   * Method-grouped lookup derived from the flat route lists above, built once
   * at module load. `supports` runs on every request before the fallback
   * decision (see `ServerRouter.dispatch`), so the flat `.some()` over ~215
   * entries is avoided: only the bucket for the request method is scanned.
   */
  function groupByMethod(routes: ReadonlyArray<readonly [string, RegExp]>) {
    const byMethod = new Map<string, RegExp[]>()
    for (const [method, pattern] of routes) {
      const list = byMethod.get(method)
      if (list) list.push(pattern)
      else byMethod.set(method, [pattern])
    }
    return byMethod
  }

  const implementedByMethod = groupByMethod(implementedRoutes)
  const globalByMethod = groupByMethod(globalRoutes)

  /** Snapshot of bridge route patterns for coverage scripts/tests. */
  export function listImplemented(): RoutePattern[] {
    return [
      ...implementedRoutes.map(([method, pattern]) => ({
        method,
        pattern: pattern.source,
        scope: "main" as const,
      })),
      ...globalRoutes.map(([method, pattern]) => ({
        method,
        pattern: pattern.source,
        scope: "global" as const,
      })),
    ]
  }

  /**
   * Build a concrete sample path that matches `pattern` so `supports`
   * can be exercised without hand-writing fixtures for every route.
   * Replaces `[^/]+` / `.+` style segments with `x`, and `(a|b)` with `a`.
   */
  export function samplePathFor(patternSource: string): string {
    const filled = patternSource
      .replace(/^\^/, "")
      .replace(/\$$/, "")
      .replace(/\\\//g, "/")
      .replace(/\(\?:/g, "(")
      .replace(/\([^)]+\)/g, (group) => {
        const inner = group.slice(1, -1)
        const alt = inner.split("|")[0] ?? "x"
        return alt.replace(/[^a-zA-Z0-9_-]/g, "") || "x"
      })
      .replace(/\[\^\/\]\+/g, "x")
      .replace(/\.\+/g, "x")
      .replace(/\?/g, "")
      .replace(/\^/g, "")
      .replace(/\$/g, "")
    return filled.startsWith("/") ? filled : `/${filled}`
  }

  /**
   * Shared Effect HttpApi layer used by `Server.fetch`. `LogRedirect` replaces
   * Effect's console default logger so router-internal logs (HttpApi spans,
   * encode errors) land in nikcli's `Log` sink instead of corrupting the TUI's
   * stdout.
   */
  export const layer = Layer.mergeAll(
    PublicHttpApi.layer.pipe(
      Layer.provide(Layer.mergeAll(BunHttpServer.layerHttpServices, BunFileSystem.layer, BunPath.layer)),
    ),
    LogRedirect,
  )

  /**
   * Web-standard request handler for the schema-encoded HttpApi routes.
   *
   * `disableLogger: true` skips Effect's built-in `HttpMiddleware.logger`:
   * `ServerRouter.dispatch` already logs start + duration for every request
   * except `POST /log`, so adding Effect's logger logs each encoded request
   * twice with the same span. Disable here and keep nikcli's own log.
   */
  export const webHandler = HttpRouter.toWebHandler(layer, {
    memoMap: sharedMemoMap,
    disableLogger: true,
  }).handler

  export function supports(pathname: string, method = "GET") {
    const bucket = implementedByMethod.get(method.toUpperCase())
    if (!bucket) return false
    return bucket.some((pattern) => pattern.test(pathname))
  }

  export function supportsGlobal(pathname: string, method = "GET") {
    const bucket = globalByMethod.get(method.toUpperCase())
    if (!bucket) return false
    return bucket.some((pattern) => pattern.test(pathname))
  }

  /** Serve an instance-less `/global/*` or `/user/*` request. Reads no Instance ALS. */
  export async function handleGlobal(
    request: Request,
    options?: { upstreamAuthVerified?: boolean; pathname?: string },
  ) {
    const pathname = options?.pathname ?? new URL(request.url).pathname
    if (!options?.upstreamAuthVerified && !Auth.isPublicPath(request.method, pathname)) {
      const result = await Auth.authenticate(request, { credentials: testAuthOverride ?? undefined })
      if (!result.ok) return result.response
    }
    if (request.method === "GET" && pathname === "/global/event") {
      return HttpApiEvent.handle()
    }
    const root = instanceLessRoot(pathname)
    if (root) {
      const response = await rawGlobalHandlers[root]?.(request)
      if (response) return response
    }
    return webHandler(request, Context.empty() as Context.Context<any>)
  }

  export async function handle(request: Request, options?: { upstreamAuthVerified?: boolean; pathname?: string }) {
    // Raw streaming responses (SSE, chunked prompt bodies) are served ahead
    // of the router — they are not schema-encoded HttpApi bodies.
    const pathname = options?.pathname ?? new URL(request.url).pathname
    if (request.method === "GET" && pathname === "/event") {
      // Instance-scoped SSE — plain {type, properties} from the instance Bus.
      // handle() (the /global/event shape) wraps events in {payload}, which
      // the TUI cannot parse; see HttpApiEvent.handleInstance.
      return Promise.resolve(HttpApiEvent.handleInstance())
    }
    if (request.method === "POST") {
      const prompt = pathname.match(/^\/session\/([^/]+)\/message$/)
      if (prompt) return HttpApiPrompt.prompt(request, decodeURIComponent(prompt[1]))
      const promptAsync = pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
      if (promptAsync) return HttpApiPrompt.promptAsync(request, decodeURIComponent(promptAsync[1]))
      if (pathname.startsWith("/chatbot/")) {
        // Webhook receivers need the raw Request (signature verification), so
        // they bypass the schema-encoding router like the other specials. An
        // unmatched path falls through — `/chatbot/bots*` is a declared group.
        const webhook = await ChatbotHttp.handle(request)
        if (webhook) return webhook
      }
    }
    // Requests normally arrive through Server.fetch(), whose router already
    // ran `Auth.authenticate`; direct bridge consumers and request-level tests
    // get the same canonical check here.
    if (!options?.upstreamAuthVerified) {
      const result = await Auth.authenticate(request, { credentials: testAuthOverride ?? undefined })
      if (!result.ok) return result.response
    }
    return webHandler(
      request,
      Context.make(InstanceRef, {
        directory: Instance.directory,
        worktree: Instance.worktree,
        project: Instance.project,
      }) as Context.Context<any>,
    )
  }
}
