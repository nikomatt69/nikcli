import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { PermissionNext } from "../permission/next"
import { Truncate } from "./truncation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

export namespace Tool {
  function truncateOutput(text: string, options: Truncate.Options = {}, agent?: Agent.Info) {
    return runPromiseWithLayer(
      Truncate.defaultLayer,
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        return yield* truncate.output(text, options, agent)
      }),
    )
  }

  export type Metadata = Record<string, unknown>

  export interface StrictMetadata extends z.ZodType<Record<string, unknown>> {}

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: Record<string, unknown>
    messages?: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }

  export interface Result<M extends Metadata = Metadata> {
    title: string
    metadata: M
    output: string
    attachments?: MessageV2.FilePart[]
  }

  /**
   * The shape a tool author writes — `execute` may return a Promise or an Effect.
   * The wrapper in `Tool.define` normalizes both into `Tool.Def`.
   */
  export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    description: string
    parameters: Parameters
    /**
     * The Effect-shaped tool body. Always available on a wrapped `Tool.Def`. New tools
     * should target this shape directly (`(args, ctx) => Effect.gen(function* () { ... })`).
     * Existing tools that still return a `Promise` keep their bodies — `Tool.define` wraps
     * them in `Effect.tryPromise(...)` automatically.
     */
    execute(args: z.infer<Parameters>, ctx: Context): Effect.Effect<Result<M>, Error>
    /**
     * Compatibility Promise wrapper. Always present so legacy callers can keep using
     * `await tool.executeAsync(args, ctx)` while the codebase migrates to Effect-native
     * call sites. Thin wrapper around `Effect.runPromise(execute(args, ctx))`.
     */
    executeAsync(args: z.infer<Parameters>, ctx: Context): Promise<Result<M>>
    formatValidationError?(error: z.ZodError): string
  }

  /**
   * The shape a tool author authors. `execute` here may be either Promise- or
   * Effect-returning; `Tool.define` normalizes to the unified `Def`.
   */
  export interface AuthoredDef<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    description: string
    parameters: Parameters
    execute(
      args: z.infer<Parameters>,
      ctx: Context,
    ): Promise<Result<M>> | Effect.Effect<Result<M>, Error>
    formatValidationError?(error: z.ZodError): string
  }

  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: (ctx?: InitContext) => Promise<Def<Parameters, M>>
  }

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  type AuthoredInit<Parameters extends z.ZodType, M extends Metadata> = (
    ctx?: InitContext,
  ) => Promise<AuthoredDef<Parameters, M>>

  function isEffect<A, E>(value: unknown): value is Effect.Effect<A, E> {
    return typeof value === "object" && value !== null && Effect.isEffect(value as any)
  }

  function asEffect<R>(value: Promise<R> | Effect.Effect<R, Error>): Effect.Effect<R, Error> {
    if (isEffect<R, Error>(value)) return value
    return Effect.tryPromise({
      try: () => value,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
  }

  export function define<Parameters extends z.ZodType, M extends Metadata>(
    id: string,
    init: AuthoredInit<Parameters, M> | AuthoredDef<Parameters, M>,
  ): Info<Parameters, M> {
    return {
      id,
      init: async (initCtx) => {
        const authored = init instanceof Function ? await init(initCtx) : init
        const authoredExecute = authored.execute

        const execute = (args: z.infer<Parameters>, ctx: Context): Effect.Effect<Result<M>, Error> =>
          Effect.gen(function* () {
            try {
              authored.parameters.parse(args)
            } catch (error) {
              if (error instanceof z.ZodError && authored.formatValidationError) {
                return yield* Effect.fail(new Error(authored.formatValidationError(error), { cause: error }))
              }
              return yield* Effect.fail(
                new Error(
                  `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                  { cause: error as Error | undefined },
                ),
              )
            }

            const wrappedCtx: Context = {
              ...ctx,
              metadata(input) {
                const metadata =
                  input.metadata && input.metadata.truncated !== undefined
                    ? input.metadata
                    : {
                        ...(input.metadata ?? {}),
                        truncated: false,
                      }
                ctx.metadata({
                  ...input,
                  metadata,
                })
              },
            }

            const result = yield* asEffect(authoredExecute(args, wrappedCtx)) as Effect.Effect<Result<M>, Error>
            if (result.metadata.truncated !== undefined) return result

            const truncated = yield* Effect.promise(() => truncateOutput(result.output, {}, initCtx?.agent))
            return {
              ...result,
              output: truncated.content,
              metadata: {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
            }
          })

        const def: Def<Parameters, M> = {
          description: authored.description,
          parameters: authored.parameters,
          execute,
          executeAsync: (args, ctx) => Effect.runPromise(execute(args, ctx)),
          formatValidationError: authored.formatValidationError,
        }
        return def
      },
    }
  }
}
