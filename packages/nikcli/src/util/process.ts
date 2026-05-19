import { randomUUID } from "crypto"

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

  export class RunFailedError extends Error {
    readonly code: number
    readonly stdout: Buffer
    readonly stderr: Buffer

    constructor(message: string, opts: { code: number; stdout: Buffer; stderr: Buffer }) {
      super(message)
      this.name = "RunFailedError"
      this.code = opts.code
      this.stdout = opts.stdout
      this.stderr = opts.stderr
    }
  }
}
