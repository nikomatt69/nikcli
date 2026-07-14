import { NikCli as Client } from "@nikcli-ai/sdk/httpapi"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "nikcli-ai/effect/index"
import { InstanceBootstrap } from "nikcli-ai/project/bootstrap"
import { Server } from "nikcli-ai/server/server"
import { ToolRegistry } from "nikcli-ai/tool/registry"
import type { Tool } from "nikcli-ai/tool/tool"
import { Context, Effect, Layer } from "effect"

export interface Options {
  /**
   * Project directory the embedded host binds requests to when a call does
   * not carry its own `directory` query or `x-nikcli-directory` header.
   * Defaults to `process.cwd()`.
   */
  readonly directory?: string
}

export const create = Effect.fn("NikCli.create")(function* (options?: Options) {
  const directory = options?.directory ?? process.cwd()
  const app = Server.App()
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const bound = new URL(request.url).searchParams.has("directory") || request.headers.has("x-nikcli-directory")
      if (!bound) request.headers.set("x-nikcli-directory", directory)
      return Promise.resolve(app.fetch(request))
    },
    { preconnect: () => undefined },
  ) satisfies typeof globalThis.fetch
  const client = Client.make({ baseUrl: "http://nikcli.local", fetch })
  const register = Effect.fn("NikCli.tools.register")(function* (...tools: Tool.Info[]) {
    yield* Effect.tryPromise({
      try: () =>
        withInstanceAsync({ directory, init: InstanceBootstrap }, () =>
          runPromiseWithLayer(
            ToolRegistry.defaultLayer,
            withCurrentInstance(
              Effect.gen(function* () {
                const registry = yield* ToolRegistry.Service
                for (const tool of tools) yield* registry.register(tool)
              }),
            ),
          ),
        ),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  })
  return {
    ...client,
    tools: { register },
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@nikcli-ai/sdk-next/NikCli") {}

export const layer = Layer.effect(Service, create())
