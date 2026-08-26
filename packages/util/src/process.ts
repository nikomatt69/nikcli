import { randomUUID } from "crypto"
import { Schema } from "effect"

export namespace Process {
  export const RUN_ID_ENV = "NIKCLI_RUN_ID"
  export const ROLE_ENV = "NIKCLI_PROCESS_ROLE"
  export type Role = "main" | "worker"

  export function ensureRunID(env: NodeJS.ProcessEnv = process.env) {
    return (env[RUN_ID_ENV] ??= randomUUID())
  }

  export function ensureRole(fallback: Role, env: NodeJS.ProcessEnv = process.env) {
    return (env[ROLE_ENV] ??= fallback)
  }

  export function ensureMetadata(fallback: Role, env: NodeJS.ProcessEnv = process.env) {
    return {
      runID: ensureRunID(env),
      processRole: ensureRole(fallback, env),
    }
  }

  export function sanitizedEnv(overrides?: Record<string, string>) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    return overrides ? Object.assign(env, overrides) : env
  }

  /**
   * Thrown when a spawned process exits with a non-zero code. Tagged so it can
   * be caught via `Effect.catchTag("ProcessRunFailed", ...)` while keeping
   * `instanceof Process.RunFailedError` working for plain `try/catch` paths.
   */
  export class RunFailedError extends Schema.TaggedError<RunFailedError>()("ProcessRunFailed", {
    message: Schema.String,
    code: Schema.Number,
    stdout: Schema.instanceOf(Buffer),
    stderr: Schema.instanceOf(Buffer),
  }) {}
}
