import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"

type ProcessEntry = {
  proc: ReturnType<typeof Bun.spawn>
  logs: string[]
  name: string
  command: string
  cwd: string
  startedAt: number
}

const processes = new Map<string, ProcessEntry>()

async function streamOutput(reader: ReadableStreamDefaultReader<any>, logs: string[], prefix: string) {
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value).split("\n").filter(Boolean)
      for (const line of lines) {
        logs.push(`[${prefix}] ${line}`)
        if (logs.length > 1000) logs.shift()
      }
    }
  } catch {}
}

export const BackgroundPlugin: Plugin = async (_input) => {
  return {
    tool: {
      bg_start: tool({
        description: "Start a named background process. Returns immediately while the process runs in the background.",
        args: {
          name: tool.schema.string().describe("Unique identifier for this background process"),
          command: tool.schema.string().describe("Shell command to execute"),
          cwd: tool.schema.string().optional().describe("Working directory (defaults to current project dir)"),
        },
        async execute(args) {
          if (processes.has(args.name)) {
            const existing = processes.get(args.name)!
            if (existing.proc.exitCode === null) {
              return `Process "${args.name}" is already running (PID ${existing.proc.pid}). Stop it first with bg_stop.`
            }
            processes.delete(args.name)
          }

          const logs: string[] = []
          const proc = Bun.spawn(["sh", "-c", args.command], {
            cwd: args.cwd,
            stdout: "pipe",
            stderr: "pipe",
          })

          processes.set(args.name, {
            proc,
            logs,
            name: args.name,
            command: args.command,
            cwd: args.cwd ?? process.cwd(),
            startedAt: Date.now(),
          })

          streamOutput(proc.stdout.getReader(), logs, "out")
          streamOutput(proc.stderr.getReader(), logs, "err")

          return `Started "${args.name}" (PID ${proc.pid})\nCommand: ${args.command}`
        },
      }),

      bg_stop: tool({
        description: "Stop a running background process by name.",
        args: {
          name: tool.schema.string().describe("Name of the process to stop"),
          signal: tool.schema.string().optional().describe("Signal to send: SIGTERM (default) or SIGKILL"),
        },
        async execute(args) {
          const entry = processes.get(args.name)
          if (!entry) return `No background process named "${args.name}"`
          if (entry.proc.exitCode !== null) {
            processes.delete(args.name)
            return `Process "${args.name}" had already exited with code ${entry.proc.exitCode}`
          }
          entry.proc.kill(args.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM")
          processes.delete(args.name)
          return `Sent ${args.signal ?? "SIGTERM"} to "${args.name}" (PID ${entry.proc.pid})`
        },
      }),

      bg_status: tool({
        description: "Get the current status of a background process.",
        args: {
          name: tool.schema.string().describe("Name of the background process"),
        },
        async execute(args) {
          const entry = processes.get(args.name)
          if (!entry) return `No background process named "${args.name}"`

          const uptimeSec = Math.floor((Date.now() - entry.startedAt) / 1000)
          const exitCode = entry.proc.exitCode

          if (exitCode === null) {
            return [
              `Process "${args.name}": running`,
              `  PID:     ${entry.proc.pid}`,
              `  Uptime:  ${uptimeSec}s`,
              `  Command: ${entry.command}`,
              `  CWD:     ${entry.cwd}`,
              `  Logs:    ${entry.logs.length} lines buffered`,
            ].join("\n")
          }

          return [
            `Process "${args.name}": exited (code ${exitCode})`,
            `  Ran for: ${uptimeSec}s`,
            `  Command: ${entry.command}`,
          ].join("\n")
        },
      }),

      bg_list: tool({
        description: "List all background processes and their statuses.",
        args: {},
        async execute() {
          if (processes.size === 0) return "No background processes"

          const header = `${"NAME".padEnd(22)}${"STATUS".padEnd(18)}COMMAND`
          const rows = [...processes.values()].map((e) => {
            const uptimeSec = Math.floor((Date.now() - e.startedAt) / 1000)
            const status = e.proc.exitCode === null ? `running ${uptimeSec}s` : `exited(${e.proc.exitCode})`
            return `${e.name.padEnd(22)}${status.padEnd(18)}${e.command}`
          })

          return [header, ...rows].join("\n")
        },
      }),

      bg_logs: tool({
        description: "Retrieve buffered output from a background process.",
        args: {
          name: tool.schema.string().describe("Name of the background process"),
          lines: tool.schema.number().optional().describe("Number of most-recent lines to return (default: 50)"),
        },
        async execute(args) {
          const entry = processes.get(args.name)
          if (!entry) return `No background process named "${args.name}"`

          const n = args.lines ?? 50
          const tail = entry.logs.slice(-n)
          if (tail.length === 0) return `No output yet from "${args.name}"`

          const header = `Last ${tail.length} lines from "${args.name}":`
          return [header, ...tail].join("\n")
        },
      }),
    },
  }
}

export default { server: BackgroundPlugin }
