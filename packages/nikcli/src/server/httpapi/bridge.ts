import { HttpRouter } from "effect/unstable/http"
import { BunFileSystem, BunHttpServer, BunPath } from "@effect/platform-bun"
import { Context, Layer } from "effect"
import { InstanceRef, LogRedirect, sharedMemoMap } from "@/effect"
import { Instance } from "@/project/instance"
import { ChatbotHttp } from "./chatbot"
import { HttpApiEvent } from "./event"
import { HttpApiPrompt } from "./prompt"
import { PublicHttpApi } from "./public"
import { UsersHttp } from "./users"
import { AccountHttp } from "./account"
import { isAccountPath } from "./account-path"
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

  const implementedRoutes = [
    ["PUT", /^\/auth\/[^/]+$/],
    ["DELETE", /^\/auth\/[^/]+$/],
    ["DELETE", /^\/provider\/[^/]+\/auth$/],
    ["DELETE", /^\/config\/mcp\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+\/message\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+\/message\/[^/]+\/part\/[^/]+$/],
    ["DELETE", /^\/experimental\/workspace\/[^/]+$/],
    ["DELETE", /^\/project\/[^/]+\/copy$/],
    ["GET", /^\/agent$/],
    ["GET", /^\/brain\/?$/],
    ["POST", /^\/brain\/trigger$/],
    ["GET", /^\/connectors\/?$/],
    ["POST", /^\/connectors\/[^/]+\/auth$/],
    ["DELETE", /^\/connectors\/[^/]+\/auth$/],
    ["POST", /^\/connectors\/invalidate$/],
    ["POST", /^\/chatbot\/(discord|slack|teams|gchat|linear|github)\/[^/]+$/],
    ["GET", /^\/analytics\/global$/],
    ["GET", /^\/analytics\/daily$/],
    ["GET", /^\/analytics\/session\/[^/]+$/],
    ["GET", /^\/analytics\/sessions$/],
    ["GET", /^\/analytics\/leaderboard$/],
    ["GET", /^\/analytics\/data$/],
    ["GET", /^\/command$/],
    ["GET", /^\/config$/],
    ["GET", /^\/config\/providers$/],
    ["GET", /^\/doctor\/?$/],
    ["GET", /^\/config\/profiles$/],
    ["GET", /^\/experimental\/resource$/],
    ["GET", /^\/experimental\/tool$/],
    ["GET", /^\/experimental\/tool\/ids$/],
    ["GET", /^\/experimental\/worktree$/],
    ["GET", /^\/experimental\/workspace\/?$/],
    ["GET", /^\/experimental\/workspace\/adaptor$/],
    ["GET", /^\/experimental\/workspace\/status$/],
    ["GET", /^\/file$/],
    ["GET", /^\/file\/content$/],
    ["GET", /^\/file\/status$/],
    ["GET", /^\/event$/],
    ["GET", /^\/find$/],
    ["GET", /^\/find\/file$/],
    ["GET", /^\/find\/symbol$/],
    ["GET", /^\/formatter$/],
    ["GET", /^\/loop\/?$/],
    ["GET", /^\/loop\/templates$/],
    ["GET", /^\/loop\/runs\/recent$/],
    ["GET", /^\/loop\/[^/]+$/],
    ["GET", /^\/loop\/[^/]+\/runs$/],
    ["GET", /^\/lsp$/],
    ["GET", /^\/mcp$/],
    ["GET", /^\/mission\/?$/],
    ["GET", /^\/mission\/templates$/],
    ["GET", /^\/mission\/execs\/recent$/],
    ["GET", /^\/mission\/[^/]+$/],
    ["GET", /^\/mission\/[^/]+\/execs$/],
    ["POST", /^\/mission\/generate$/],
    ["POST", /^\/mission\/[^/]+$/],
    ["POST", /^\/mission\/[^/]+\/start$/],
    ["POST", /^\/mission\/[^/]+\/pause$/],
    ["POST", /^\/mission\/[^/]+\/cancel$/],
    ["POST", /^\/mission\/[^/]+\/feature\/[^/]+$/],
    ["PUT", /^\/mission\/?$/],
    ["DELETE", /^\/mission\/[^/]+$/],
    ["GET", /^\/path$/],
    ["GET", /^\/permission$/],
    ["GET", /^\/project$/],
    ["GET", /^\/project\/current$/],
    ["GET", /^\/project\/[^/]+\/directory$/],
    ["GET", /^\/provider$/],
    ["GET", /^\/provider\/auth$/],
    ["GET", /^\/question$/],
    ["GET", /^\/session\/?$/],
    ["GET", /^\/session\/status$/],
    ["GET", /^\/session\/[^/]+$/],
    ["GET", /^\/session\/[^/]+\/children$/],
    ["GET", /^\/session\/[^/]+\/diff$/],
    ["GET", /^\/session\/[^/]+\/message$/],
    ["GET", /^\/session\/[^/]+\/message\/[^/]+$/],
    ["GET", /^\/session\/[^/]+\/todo$/],
    ["GET", /^\/session\/[^/]+\/instructions$/],
    ["GET", /^\/session\/[^/]+\/context$/],
    ["POST", /^\/session\/[^/]+\/context\/toggle$/],
    ["GET", /^\/session\/[^/]+\/goal$/],
    ["GET", /^\/session\/[^/]+\/background$/],
    ["GET", /^\/session\/[^/]+\/background\/[^/]+$/],
    ["GET", /^\/session\/[^/]+\/background\/[^/]+\/read$/],
    ["POST", /^\/session\/[^/]+\/background\/[^/]+\/cancel$/],
    ["GET", /^\/session\/[^/]+\/monitor\/[^/]+$/],
    ["GET", /^\/session\/[^/]+\/monitor\/[^/]+\/log$/],
    ["POST", /^\/session\/[^/]+\/monitor\/[^/]+\/cancel$/],
    ["GET", /^\/session\/[^/]+\/v2\/entries$/],
    ["GET", /^\/session\/[^/]+\/v2\/state$/],
    ["GET", /^\/session\/[^/]+\/v2\/events$/],
    ["POST", /^\/log$/],
    ["GET", /^\/skill$/],
    ["POST", /^\/skill$/],
    ["DELETE", /^\/skill\/[^/]+$/],
    ["GET", /^\/vcs$/],
    ["GET", /^\/vcs\/status$/],
    ["GET", /^\/vcs\/diff\/raw$/],
    ["POST", /^\/vcs\/apply$/],
    ["PATCH", /^\/config$/],
    ["PATCH", /^\/config\/mcp\/[^/]+$/],
    ["PATCH", /^\/project\/[^/]+$/],
    ["PATCH", /^\/session\/[^/]+$/],
    ["PATCH", /^\/session\/[^/]+\/message\/[^/]+\/part\/[^/]+$/],
    ["POST", /^\/mcp$/],
    ["POST", /^\/config\/mcp$/],
    ["POST", /^\/config\/profiles$/],
    ["POST", /^\/config\/profiles\/activate\/[^/]+$/],
    ["POST", /^\/mcp\/[^/]+\/connect$/],
    ["POST", /^\/mcp\/[^/]+\/disconnect$/],
    ["POST", /^\/mcp\/[^/]+\/toggle$/],
    ["POST", /^\/loop\/generate$/],
    ["POST", /^\/loop\/[^/]+$/],
    ["POST", /^\/loop\/[^/]+\/toggle$/],
    ["POST", /^\/loop\/[^/]+\/run$/],
    ["POST", /^\/loop\/[^/]+\/abort$/],
    ["POST", /^\/loop\/[^/]+\/pause$/],
    ["POST", /^\/loop\/[^/]+\/resume$/],
    ["POST", /^\/instance\/dispose$/],
    ["POST", /^\/experimental\/worktree$/],
    ["POST", /^\/experimental\/worktree\/reset$/],
    ["POST", /^\/project\/[^/]+\/copy$/],
    ["POST", /^\/project\/[^/]+\/copy\/refresh$/],
    ["POST", /^\/experimental\/workspace\/[^/]+$/],
    ["POST", /^\/experimental\/workspace\/sync-list$/],
    ["POST", /^\/experimental\/workspace\/[^/]+\/restore$/],
    ["POST", /^\/experimental\/workspace\/[^/]+\/session\/[^/]+\/restore$/],
    ["POST", /^\/experimental\/workspace\/warp$/],
    ["POST", /^\/experimental\/workspace\/session\/[^/]+\/warp$/],
    ["POST", /^\/config\/reload$/],
    ["POST", /^\/permission\/[^/]+\/reply$/],
    ["POST", /^\/provider\/[^/]+\/api$/],
    ["POST", /^\/provider\/[^/]+\/oauth\/authorize$/],
    ["POST", /^\/provider\/[^/]+\/oauth\/callback$/],
    ["GET", /^\/pty\/?$/],
    ["POST", /^\/pty\/?$/],
    ["GET", /^\/pty\/[^/]+\/?$/],
    ["PUT", /^\/pty\/[^/]+\/?$/],
    ["DELETE", /^\/pty\/[^/]+\/?$/],
    ["POST", /^\/question\/[^/]+\/reject$/],
    ["POST", /^\/question\/[^/]+\/reply$/],
    ["POST", /^\/session\/?$/],
    ["POST", /^\/session\/[^/]+\/abort$/],
    ["POST", /^\/session\/[^/]+\/fork$/],
    ["POST", /^\/session\/[^/]+\/revert$/],
    ["POST", /^\/session\/[^/]+\/unrevert$/],
    ["POST", /^\/session\/[^/]+\/share$/],
    ["DELETE", /^\/session\/[^/]+\/share$/],
    ["POST", /^\/session\/[^/]+\/summarize$/],
    ["POST", /^\/session\/[^/]+\/command$/],
    ["POST", /^\/session\/[^/]+\/shell$/],
    ["POST", /^\/session\/[^/]+\/permissions\/[^/]+$/],
    ["POST", /^\/session\/[^/]+\/message$/],
    ["POST", /^\/session\/[^/]+\/prompt_async$/],
    ["PUT", /^\/file\/content$/],
    ["PUT", /^\/loop\/?$/],
    ["DELETE", /^\/loop\/[^/]+$/],
    ["DELETE", /^\/mcp\/[^/]+\/auth$/],
    ["POST", /^\/mcp\/[^/]+\/auth$/],
    ["POST", /^\/mcp\/[^/]+\/auth\/callback$/],
    ["POST", /^\/mcp\/[^/]+\/auth\/authenticate$/],
    ["DELETE", /^\/experimental\/worktree$/],
    ["POST", /^\/experimental\/managed-worktree$/],
    ["DELETE", /^\/experimental\/managed-worktree$/],
    ["POST", /^\/experimental\/managed-worktree\/link$/],
    ["GET", /^\/experimental\/managed-worktree\/children$/],
    ["GET", /^\/experimental\/managed-worktree\/ancestors$/],
    ["GET", /^\/experimental\/managed-worktree$/],
    ["GET", /^\/profile$/],
    ["PATCH", /^\/profile$/],
    ["DELETE", /^\/profile$/],
    ["GET", /^\/profile\/habits$/],
    ["GET", /^\/profile\/preview$/],
    ["DELETE", /^\/profile\/habits$/],
    ["GET", /^\/tui\/config$/],
    ["GET", /^\/tui\/control\/next$/],
    ["POST", /^\/tui\/append-prompt$/],
    ["POST", /^\/tui\/open-help$/],
    ["POST", /^\/tui\/open-sessions$/],
    ["POST", /^\/tui\/open-themes$/],
    ["POST", /^\/tui\/open-models$/],
    ["POST", /^\/tui\/submit-prompt$/],
    ["POST", /^\/tui\/clear-prompt$/],
    ["POST", /^\/tui\/execute-command$/],
    ["POST", /^\/tui\/show-toast$/],
    ["POST", /^\/tui\/publish$/],
    ["POST", /^\/tui\/select-session$/],
    ["POST", /^\/tui\/control\/response$/],
    ["POST", /^\/sync\/event$/],
    ["GET", /^\/sync\/outbox$/],
    ["GET", /^\/sync\/snapshot\/[^/]+$/],
    ["GET", /^\/sync\/stream$/],
    ["GET", /^\/sync\/stats$/],
    ["POST", /^\/sync\/config$/],
    ["POST", /^\/sync\/connect$/],
    ["POST", /^\/sync\/disconnect$/],
    ["POST", /^\/sync\/drain$/],
    // Prefix match: a handler 404 under `/mobile/*` must not fall through to
    // the website proxy (that was returning 200 HTML for deleted loops).
    ["GET", /^\/mobile\//],
    ["POST", /^\/mobile\//],
    ["PUT", /^\/mobile\//],
    ["PATCH", /^\/mobile\//],
    ["DELETE", /^\/mobile\//],
  ] as const

  /**
   * Instance-less routes served before instance context is bound. These must
   * never require `InstanceRef` — they run outside the instance/workspace
   * middleware, so `handleGlobal` provides no instance context.
   */
  const globalRoutes = [
    ["GET", /^\/global\/health$/],
    ["GET", /^\/global\/event$/],
    ["POST", /^\/global\/dispose$/],
    ["POST", /^\/user\/register$/],
    ["POST", /^\/user\/login$/],
    ["POST", /^\/user\/logout$/],
    ["GET", /^\/user\/me$/],
    ["GET", /^\/user\/status$/],
    ["GET", /^\/user\/list$/],
    ["PATCH", /^\/user\/[^/]+$/],
    ["DELETE", /^\/user\/[^/]+$/],
  ] as const

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

  /** Web-standard request handler for the schema-encoded HttpApi routes. */
  export const webHandler = HttpRouter.toWebHandler(layer, {
    memoMap: sharedMemoMap,
  }).handler

  export function supports(pathname: string, method = "GET") {
    const normalizedMethod = method.toUpperCase()
    return implementedRoutes.some(
      ([routeMethod, pattern]) => routeMethod === normalizedMethod && pattern.test(pathname),
    )
  }

  export function supportsGlobal(pathname: string, method = "GET") {
    const normalizedMethod = method.toUpperCase()
    return globalRoutes.some(([routeMethod, pattern]) => routeMethod === normalizedMethod && pattern.test(pathname))
  }

  /** Serve an instance-less `/global/*` or `/user/*` request. Reads no Instance ALS. */
  export async function handleGlobal(request: Request, options?: { upstreamAuthVerified?: boolean }) {
    const pathname = new URL(request.url).pathname
    if (!options?.upstreamAuthVerified && !Auth.isPublicPath(request.method, pathname)) {
      const result = await Auth.authenticate(request, { credentials: testAuthOverride ?? undefined })
      if (!result.ok) return result.response
    }
    if (request.method === "GET" && pathname === "/global/event") {
      return HttpApiEvent.handle()
    }
    if (pathname.startsWith("/user/")) {
      // Raw handlers: the legacy /user routes are outside the OpenAPI surface
      // and reuse one { error } body shape across statuses, which the HttpApi
      // error encoder cannot discriminate.
      const response = await UsersHttp.handle(request)
      if (response) return response
    }
    if (isAccountPath(pathname)) {
      // Same reason as /user/: eight tagged login errors, one { error } body.
      const response = await AccountHttp.handle(request)
      if (response) return response
    }
    return webHandler(request, Context.empty() as Context.Context<any>)
  }

  export async function handle(request: Request, options?: { upstreamAuthVerified?: boolean }) {
    // Raw streaming responses (SSE, chunked prompt bodies) are served ahead
    // of the router — they are not schema-encoded HttpApi bodies.
    const pathname = new URL(request.url).pathname
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
