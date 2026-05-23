import { spawn } from "child_process"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

/**
 * Sandbox — isolated command execution layer.
 *
 * The default LocalSandbox implementation runs commands via `Bun.spawn` with:
 *   - scrubbed environment (only an allowlist of vars passes through)
 *   - mandatory cwd containment check (no escaping the project directory)
 *   - hard timeout with SIGTERM → SIGKILL escalation
 *   - signal-based abort
 *
 * Higher-isolation layers (Docker, Vercel Sandbox, Firecracker) can be plugged
 * in by providing an alternate Layer that satisfies the same Service interface.
 */
export namespace Sandbox {
  const log = Log.create({ service: "sandbox" })

  export class EscapeError extends Schema.TaggedErrorClass<EscapeError>()("SandboxEscapeError", {
    cwd: Schema.String,
    project: Schema.String,
  }) {
    override get message() {
      return `Sandbox cwd "${this.cwd}" escapes the project directory "${this.project}"`
    }
  }

  export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("SandboxTimeoutError", {
    timeoutMs: Schema.Number,
    command: Schema.String,
  }) {
    override get message() {
      return `Sandbox command "${this.command}" exceeded the ${this.timeoutMs}ms timeout`
    }
  }

  export class FailedError extends Schema.TaggedErrorClass<FailedError>()("SandboxFailedError", {
    exitCode: Schema.Number,
    command: Schema.String,
    stderr: Schema.String,
  }) {
    override get message() {
      return `Sandbox command "${this.command}" exited with code ${this.exitCode}`
    }
  }

  export type Error = EscapeError | TimeoutError | FailedError

  export interface RunInput {
    readonly command: ReadonlyArray<string>
    readonly cwd: string
    readonly timeoutMs?: number
    readonly env?: Readonly<Record<string, string>>
    readonly stdin?: string
    readonly signal?: AbortSignal
  }

  export interface RunResult {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number
    readonly durationMs: number
  }

  export interface Interface {
    readonly run: (input: RunInput) => Effect.Effect<RunResult, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("Sandbox.Service") {}

  /**
   * The minimal set of env vars we pass through to sandboxed processes.
   * Anything else (TOKENS, KEYS, etc.) is stripped to prevent credential leaks
   * into untrusted command invocations.
   */
  export const SAFE_ENV_PASSTHROUGH = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "TMPDIR", "SHELL"] as const

  /**
   * Public env scrubber — usable from non-Effect code (Bus.subscribe handlers,
   * raw async functions). Only allowlisted vars + caller-provided extras pass.
   */
  export function scrubEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of SAFE_ENV_PASSTHROUGH) {
      const value = process.env[key]
      if (value !== undefined) out[key] = value
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        out[key] = value
      }
    }
    return out
  }

  async function assertContained(cwd: string): Promise<void> {
    const projectDir = Instance.directory
    let projectReal: string
    let cwdReal: string
    try {
      projectReal = await fs.realpath(projectDir)
    } catch {
      projectReal = path.resolve(projectDir)
    }
    try {
      cwdReal = await fs.realpath(cwd)
    } catch {
      cwdReal = path.resolve(cwd)
    }
    const relative = path.relative(projectReal, cwdReal)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new EscapeError({ cwd: cwdReal, project: projectReal })
    }
  }

  /**
   * LocalSandbox — Bun.spawn with env scrubbing + cwd containment.
   *
   * NOT a full security boundary (commands still run as the current user with
   * filesystem access). Use Docker/Firecracker layers for hostile inputs.
   */
  export const localLayer = Layer.succeed(
    Service,
    Service.of({
      run: (input) =>
        Effect.tryPromise({
          try: async () => {
            await assertContained(input.cwd).catch((e) => {
              if (e instanceof EscapeError) throw e
              throw e
            })

            const start = performance.now()
            const env = scrubEnv(input.env)
            const proc = Bun.spawn(input.command as string[], {
              cwd: input.cwd,
              env,
              stdin: input.stdin ? "pipe" : "ignore",
              stdout: "pipe",
              stderr: "pipe",
            })

            if (input.stdin && proc.stdin) {
              const writer = proc.stdin as unknown as { write: (chunk: string) => void; end: () => void }
              writer.write(input.stdin)
              writer.end()
            }

            const killProc = () => {
              if (process.platform === "win32") {
                spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" })
              } else {
                try { proc.kill("SIGTERM") } catch {}
              }
            }
            const hardKillProc = () => {
              if (process.platform === "win32") {
                spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" })
              } else {
                try { proc.kill("SIGKILL") } catch {}
              }
            }

            const timeoutMs = input.timeoutMs ?? 60_000
            let timedOut = false
            const timer = setTimeout(() => {
              timedOut = true
              killProc()
              setTimeout(hardKillProc, 2_000)
            }, timeoutMs)

            const onAbort = () => { killProc() }
            input.signal?.addEventListener("abort", onAbort, { once: true })

            try {
              const [stdoutText, stderrText] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
              ])
              await proc.exited
              const exitCode = proc.exitCode ?? 0
              const durationMs = performance.now() - start

              if (timedOut) {
                throw new TimeoutError({ timeoutMs, command: input.command.join(" ") })
              }
              if (exitCode !== 0) {
                throw new FailedError({ exitCode, command: input.command.join(" "), stderr: stderrText.slice(0, 500) })
              }
              return { stdout: stdoutText, stderr: stderrText, exitCode, durationMs }
            } finally {
              clearTimeout(timer)
              input.signal?.removeEventListener("abort", onAbort)
            }
          },
          catch: (cause) => {
            if (cause instanceof EscapeError || cause instanceof TimeoutError || cause instanceof FailedError) {
              return cause
            }
            log.warn("local sandbox unexpected error", { error: cause })
            return new FailedError({
              exitCode: -1,
              command: input.command.join(" "),
              stderr: cause instanceof Error ? cause.message : String(cause),
            })
          },
        }),
    }),
  )

  export const defaultLayer = localLayer
}
