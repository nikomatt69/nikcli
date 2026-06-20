import { HttpRouter } from "effect/unstable/http"
import { BunFileSystem, BunHttpServer, BunPath } from "@effect/platform-bun"
import { Context, Layer } from "effect"
import { InstanceRef, sharedMemoMap } from "@/effect"
import { Instance } from "@/project/instance"
import { HttpApiEvent } from "./event"
import { HttpApiPrompt } from "./prompt"
import { PublicHttpApi } from "./public"

export namespace HttpApiBridge {
  const implementedRoutes = [
    ["DELETE", /^\/provider\/[^/]+\/auth$/],
    ["DELETE", /^\/config\/mcp\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+\/message\/[^/]+$/],
    ["DELETE", /^\/session\/[^/]+\/message\/[^/]+\/part\/[^/]+$/],
    ["DELETE", /^\/experimental\/workspace\/[^/]+$/],
    ["GET", /^\/agent$/],
    ["GET", /^\/command$/],
    ["GET", /^\/config$/],
    ["GET", /^\/config\/providers$/],
    ["GET", /^\/profiles$/],
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
    ["GET", /^\/path$/],
    ["GET", /^\/permission$/],
    ["GET", /^\/project$/],
    ["GET", /^\/project\/current$/],
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
    ["GET", /^\/session\/[^/]+\/v2\/entries$/],
    ["GET", /^\/session\/[^/]+\/v2\/state$/],
    ["GET", /^\/session\/[^/]+\/v2\/events$/],
    ["GET", /^\/skill$/],
    ["GET", /^\/vcs$/],
    ["PATCH", /^\/config$/],
    ["PATCH", /^\/config\/mcp\/[^/]+$/],
    ["PATCH", /^\/project\/[^/]+$/],
    ["PATCH", /^\/session\/[^/]+$/],
    ["PATCH", /^\/session\/[^/]+\/message\/[^/]+\/part\/[^/]+$/],
    ["POST", /^\/mcp$/],
    ["POST", /^\/config\/mcp$/],
    ["POST", /^\/profiles$/],
    ["POST", /^\/profiles\/activate\/[^/]+$/],
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
    ["POST", /^\/experimental\/workspace\/[^/]+$/],
    ["POST", /^\/experimental\/workspace\/sync-list$/],
    ["POST", /^\/experimental\/workspace\/[^/]+\/restore$/],
    ["POST", /^\/experimental\/workspace\/[^/]+\/session\/[^/]+\/restore$/],
    ["POST", /^\/experimental\/workspace\/warp$/],
    ["POST", /^\/permission\/[^/]+\/reply$/],
    ["POST", /^\/provider\/[^/]+\/api$/],
    ["POST", /^\/provider\/[^/]+\/oauth\/authorize$/],
    ["POST", /^\/provider\/[^/]+\/oauth\/callback$/],
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
  ] as const

  const handler = HttpRouter.toWebHandler(
    PublicHttpApi.layer.pipe(
      Layer.provide(Layer.mergeAll(BunHttpServer.layerHttpServices, BunFileSystem.layer, BunPath.layer)),
    ),
    { memoMap: sharedMemoMap },
  ).handler

  export function supports(pathname: string, method = "GET") {
    const normalizedMethod = method.toUpperCase()
    return implementedRoutes.some(
      ([routeMethod, pattern]) => routeMethod === normalizedMethod && pattern.test(pathname),
    )
  }

  export function handle(request: Request) {
    // Raw streaming responses (SSE, chunked prompt bodies) are served ahead
    // of the router — they are not schema-encoded HttpApi bodies.
    const pathname = new URL(request.url).pathname
    if (request.method === "GET" && pathname === "/event") {
      return Promise.resolve(HttpApiEvent.handle())
    }
    if (request.method === "POST") {
      const prompt = pathname.match(/^\/session\/([^/]+)\/message$/)
      if (prompt) return HttpApiPrompt.prompt(request, decodeURIComponent(prompt[1]))
      const promptAsync = pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
      if (promptAsync) return HttpApiPrompt.promptAsync(request, decodeURIComponent(promptAsync[1]))
    }
    return handler(
      request,
      Context.make(InstanceRef, {
        directory: Instance.directory,
        worktree: Instance.worktree,
        project: Instance.project,
      }) as Context.Context<any>,
    )
  }
}
