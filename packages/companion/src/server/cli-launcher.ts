import { spawn, type ChildProcess } from "child_process"
import type { Session } from "./session-types.js"
import { saveSession } from "./session-store.js"

interface CliProcess {
  process: ChildProcess
  sessionId: string
  wsUrl: string
}

const runningProcesses = new Map<string, CliProcess>()

export function getClaudeBinary(): string {
  return process.env.CLAUDE_BINARY || "claude"
}

export function buildCliArgs(
  wsUrl: string,
  sessionId: string,
  options: {
    cwd?: string
    resume?: boolean
    model?: string
    verbose?: boolean
    maxTurns?: number
  } = {},
): string[] {
  const args = ["--sdk-url", wsUrl, "--print", "--output-format", "stream-json", "--input-format", "stream-json"]

  if (options.verbose) {
    args.push("--verbose")
  }

  if (options.model) {
    args.push("--model", options.model)
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns))
  }

  if (options.resume) {
    args.push("--resume", sessionId)
  }

  args.push("-p", "")

  return args
}

export async function launchClaude(
  sessionId: string,
  wsUrl: string,
  options: {
    cwd?: string
    resume?: boolean
    model?: string
    verbose?: boolean
    maxTurns?: number
  } = {},
): Promise<{ pid: number; cliSessionId: string }> {
  const binary = getClaudeBinary()
  const args = buildCliArgs(wsUrl, sessionId, options)

  console.log(`[launcher] Spawning: ${binary} ${args.join(" ")}`)

  const child = spawn(binary, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ACCESS_TOKEN: process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN || "",
    },
  })

  const cliProcess: CliProcess = {
    process: child,
    sessionId,
    wsUrl,
  }

  runningProcesses.set(sessionId, cliProcess)

  child.stdout?.on("data", (data) => {
    console.log(`[${sessionId}] stdout: ${data.toString().slice(0, 200)}`)
  })

  child.stderr?.on("data", (data) => {
    console.error(`[${sessionId}] stderr: ${data.toString().slice(0, 200)}`)
  })

  child.on("exit", (code, signal) => {
    console.log(`[${sessionId}] Process exited: code=${code}, signal=${signal}`)
    runningProcesses.delete(sessionId)
  })

  child.on("error", (err) => {
    console.error(`[${sessionId}] Process error: ${err.message}`)
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for Claude Code to start"))
    }, 30000)

    child.once("spawn", () => {
      clearTimeout(timeout)
      resolve({ pid: child.pid!, cliSessionId: sessionId })
    })

    child.once("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export function killSession(sessionId: string): boolean {
  const cliProcess = runningProcesses.get(sessionId)
  if (!cliProcess) {
    return false
  }

  cliProcess.process.kill("SIGTERM")
  runningProcesses.delete(sessionId)
  return true
}

export function killAllSessions(): void {
  for (const [sessionId, cliProcess] of runningProcesses) {
    console.log(`[launcher] Killing session: ${sessionId}`)
    cliProcess.process.kill("SIGTERM")
  }
  runningProcesses.clear()
}

export function isSessionRunning(sessionId: string): boolean {
  return runningProcesses.has(sessionId)
}

export function getRunningSessions(): string[] {
  return Array.from(runningProcesses.keys())
}
