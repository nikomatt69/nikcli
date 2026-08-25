import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { PermissionNext } from "../permission/next"
import { Truncate } from "./truncation"
import { AppRuntime, runPromiseWithLayer, type InstanceContext } from "@/effect"
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

  export type ProgressContent =
    | { readonly type: "text"; readonly text: string }
    | {
        readonly type: "file"
        readonly data: string
        readonly mime: string
        readonly name?: string
      }

  export type Progress = {
    readonly structured: Readonly<Record<string, unknown>>
    readonly content?: ReadonlyArray<ProgressContent>
  }

  export interface StrictMetadata extends z.ZodType<Record<string, unknown>> {}

  export interface InitContext {
    agent?: Agent.Info
    /**
     * The instance the tool is being initialised for. A tool whose *definition*
     * depends on the project — `bash` names the default working directory in
     * its description — reads it from here instead of the ambient scope.
     *
     * Optional because `init()` is called with no argument in tests and on the
     * three prompt-side paths that build a tool ad hoc; those either do not
     * have an instance-dependent definition or resolve one at the boundary.
     */
    instance?: InstanceContext
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    /**
     * The instance this call belongs to.
     *
     * A tool used to reach its directory, worktree and project through the
     * ambient AsyncLocalStorage scope, which meant every tool depended on
     * being invoked from a frame that happened to be inside one — invisible
     * in the type system, and wrong the moment a tool resumed on a fiber that
     * had resumed somewhere else. It is a field on the call now, resolved
     * once where the call is built.
     */
    instance: InstanceContext
    abort: AbortSignal
    callID: string
    extra?: Record<string, unknown>
    messages?: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    progress(input: Progress): Promise<void>
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }

  export interface Result<M extends Metadata = Metadata> {
    title: string
    metadata: M
    output: string
    /**
     * Schema-validated machine success. Present when the tool declared `output`.
     * Truncation never rewrites this field; Code Mode consumes it instead of `output`.
     */
    value?: unknown
    attachments?: MessageV2.FilePart[]
  }

  /**
   * The value Code Mode (and any other typed host) should see for one success.
   * A declared output codec means `result.value`; otherwise the model-facing string.
   */
  export function encoded(result: Result, output?: z.ZodType): unknown {
    return output !== undefined ? result.value : result.output
  }

  /**
   * The shape a tool author writes — `execute` may return a Promise or an Effect.
   * The wrapper in `Tool.define` normalizes both into `Tool.Def`.
   */
  export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    description: string
    parameters: Parameters
    /**
     * Optional success codec. When set, the wrapper parses `result.value` after
     * `execute` and rejects a malformed success before truncation runs.
     */
    output?: z.ZodType
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
     * call sites. Thin wrapper around `AppRuntime.runPromise(execute(args, ctx))`.
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
    output?: z.ZodType
    execute(args: z.infer<Parameters>, ctx: Context): Promise<Result<M>> | Effect.Effect<Result<M>, Error>
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
      catch: (cause) => {
        return cause instanceof Error ? cause : new Error(String(cause))
      },
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

            // Copy descriptors rather than spread. A spread reads every field
            // eagerly, so a caller that supplies `instance` lazily — the tool
            // test helper does, because tests build the context before
            // entering the instance scope — would have it resolved here, one
            // frame too early. Copying descriptors keeps the fields *own* and
            // enumerable, so anything downstream that spreads this context
            // still works.
            const wrappedCtx: Context = Object.defineProperties({} as Context, {
              ...Object.getOwnPropertyDescriptors(ctx),
              metadata: {
                enumerable: true,
                writable: true,
                configurable: true,
                value(input: { title?: string; metadata?: M }) {
                  const metadata = {
                    ...input.metadata,
                    truncated: input.metadata?.truncated === undefined ? false : input.metadata.truncated,
                  }
                  ctx.metadata({
                    ...input,
                    metadata,
                  })
                },
              },
            })

            const result = yield* asEffect(authoredExecute(args, wrappedCtx))
            const codec = authored.output
            let success = result
            if (codec) {
              try {
                success = { ...result, value: codec.parse(result.value) }
              } catch (error) {
                return yield* Effect.fail(
                  new Error(
                    `The ${id} tool returned invalid output: ${error}.\nThe success value must satisfy the tool's output schema.`,
                    { cause: error as Error | undefined },
                  ),
                )
              }
            }
            if (success.metadata.truncated !== undefined) return success

            // Truncation is best-effort and applies only to the model-facing string.
            // The encoded `value` is left intact so Code Mode can keep a typed result.
            // (A try/catch around `yield*` would not see Effect failures, and a
            // rejected Effect.promise would kill the fiber as a defect.)
            const truncated = yield* Effect.promise(() =>
              truncateOutput(success.output, {}, initCtx?.agent).catch(
                () => ({ content: success.output, truncated: false }) satisfies Truncate.Result,
              ),
            )
            return {
              ...success,
              output: truncated.content,
              metadata: {
                ...success.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
            }
          })

        const def: Def<Parameters, M> = {
          description: authored.description,
          parameters: authored.parameters,
          output: authored.output,
          execute,
          executeAsync: (args, ctx) => AppRuntime.runPromise(execute(args, ctx)),
          formatValidationError: authored.formatValidationError,
        }
        return def
      },
    }
  }
}
