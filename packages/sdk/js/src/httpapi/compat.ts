// Namespaced view of the generated Promise client, keyed the way callers are.
//
// Generated from the exhaustive declaration beside PublicApi. Every leaf is a
// typed reference into `./generated/client.ts`, so contract drift fails client
// generation instead of disappearing from this view or becoming a runtime 404.
// See packages/nikcli/AGENTS.md, "HTTP integration workflow".

import { make, type RequestOptions } from "./generated/client.js"
import { ClientError } from "./generated/client-error.js"
import { makeCompat } from "./generated/compat.js"

export type Raw = ReturnType<typeof make>

/**
 * Result envelope. Transport failures and declared HTTP errors resolve as
 * `error` rather than rejecting, so a failed call in a UI event handler cannot
 * become an unhandled rejection. Pass `throwOnError` to opt back into
 * rejection — per call, or once via `createNikcliClient`.
 */
export type Result<A> =
  | { data: A; error: undefined; response?: undefined }
  | { data: undefined; error: unknown; response?: { status: number } }

/**
 * `directory` selects which instance serves the request (the server reads it
 * from `x-nikcli-directory`); it defaults to the client's own directory.
 */
export type CallOptions = RequestOptions & Selector & { readonly throwOnError?: boolean }

/**
 * Instance selection. `directory` picks the instance serving the request and
 * `workspace` the workspace within it; the server reads both from headers
 * (`x-nikcli-directory` / `x-nikcli-workspace`).
 */
type Selector = { readonly directory?: string; readonly workspace?: string }

/** Selection passed inline with the request body. */
type WithDirectory<I> = I & Selector

/** An input the caller may omit entirely: optional parameter, or no required field. */
type Omittable<I> = undefined extends I ? true : {} extends I ? true : false

// Callers of an input-less endpoint historically passed selection in the first
// argument and transport options in the second, so both are accepted and the
// second wins on conflict.
type Result0<F> = F extends (options?: RequestOptions) => Promise<infer R>
  ? (options?: CallOptions, overrides?: CallOptions) => Promise<Result<R>>
  : never
type ResultN<F> = F extends (input: infer I, options?: RequestOptions) => Promise<infer R>
  ? Omittable<I> extends true
    ? (input?: WithDirectory<NonNullable<I>>, options?: CallOptions) => Promise<Result<R>>
    : (input: WithDirectory<I>, options?: CallOptions) => Promise<Result<R>>
  : never
type ResultAt<F> = F extends (input: infer I, options?: RequestOptions) => Promise<infer R>
  ? Omittable<I> extends true
    ? (input?: NonNullable<I>, options?: CallOptions) => Promise<Result<R>>
    : (input: I, options?: CallOptions) => Promise<Result<R>>
  : never
type Stream0<F> = F extends (options?: RequestOptions) => AsyncIterable<infer R>
  ? (options?: CallOptions, overrides?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
  : never
type StreamN<F> = F extends (input: infer I, options?: RequestOptions) => AsyncIterable<infer R>
  ? Omittable<I> extends true
    ? (input?: WithDirectory<NonNullable<I>>, options?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
    : (input: WithDirectory<I>, options?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
  : never

type AnyFn = (...args: any[]) => any

export type CompatDefaults = { readonly throwOnError?: boolean }

function helpers(defaults: CompatDefaults) {
  /**
   * Splits the caller's options into the transport options the generated client
   * understands, folding `directory` into the instance-selection header.
   */
  const request = (options: CallOptions | undefined, inline: Selector | undefined): RequestOptions | undefined => {
    const directory = options?.directory ?? inline?.directory
    const workspace = options?.workspace ?? inline?.workspace
    if (directory === undefined && workspace === undefined) return options
    const headers = new Headers(options?.headers)
    // Header values are latin-1; percent-encode anything outside it.
    if (directory !== undefined) {
      headers.set("x-nikcli-directory", /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)
    }
    if (workspace !== undefined) headers.set("x-nikcli-workspace", workspace)
    return { ...options, headers }
  }

  /** 5xx and other undeclared statuses arrive as a ClientError carrying the status. */
  const statusOf = (error: unknown): { status: number } | undefined => {
    if (!(error instanceof ClientError)) return undefined
    const cause = error.cause
    if (typeof cause !== "object" || cause === null) return undefined
    const status = (cause as { status?: unknown }).status
    return typeof status === "number" ? { status } : undefined
  }

  const settle = async <A>(promise: Promise<A>, options: CallOptions | undefined): Promise<Result<A>> => {
    try {
      return { data: await promise, error: undefined }
    } catch (error) {
      if (options?.throwOnError ?? defaults.throwOnError) throw error
      return { data: undefined, error, response: statusOf(error) }
    }
  }

  const merge = (a: CallOptions | undefined, b: CallOptions | undefined) =>
    a === undefined ? b : b === undefined ? a : { ...a, ...b }

  const result0 = <F extends AnyFn>(fn: F): Result0<F> =>
    ((a?: CallOptions, b?: CallOptions) => {
      const options = merge(a, b)
      return settle((fn as (o?: RequestOptions) => Promise<unknown>)(request(options, undefined)), options)
    }) as Result0<F>

  /** The generated input has no `directory` of its own, so it selects the instance. */
  const result = <F extends AnyFn>(fn: F): ResultN<F> =>
    ((input: Selector, options?: CallOptions) => {
      const { directory, workspace, ...rest } = input ?? {}
      return settle(
        (fn as (i: unknown, o?: RequestOptions) => Promise<unknown>)(rest, request(options, { directory, workspace })),
        options,
      )
    }) as ResultN<F>

  /** The generated input owns `directory`; the instance comes from the options. */
  const resultAt = <F extends AnyFn>(fn: F): ResultAt<F> =>
    ((input: unknown, options?: CallOptions) =>
      settle(
        (fn as (i: unknown, o?: RequestOptions) => Promise<unknown>)(input, request(options, undefined)),
        options,
      )) as ResultAt<F>

  const stream0 = <F extends AnyFn>(fn: F): Stream0<F> =>
    (async (a?: CallOptions, b?: CallOptions) => ({
      stream: (fn as (o?: RequestOptions) => AsyncIterable<unknown>)(request(merge(a, b), undefined)),
    })) as Stream0<F>

  const stream = <F extends AnyFn>(fn: F): StreamN<F> =>
    (async (input: Selector, options?: CallOptions) => {
      const { directory, workspace, ...rest } = input ?? {}
      return {
        stream: (fn as (i: unknown, o?: RequestOptions) => AsyncIterable<unknown>)(
          rest,
          request(options, { directory, workspace }),
        ),
      }
    }) as StreamN<F>

  return { result0, result, resultAt, stream0, stream }
}

export type CompatHelpers = ReturnType<typeof helpers>

export function compat(raw: Raw, defaults: CompatDefaults = {}) {
  return makeCompat(raw, helpers(defaults))
}
