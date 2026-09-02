import { Monitor } from "@/monitor/manager"
import { authorizeBashCommand } from "./bash"
import DESCRIPTION from "./monitor.txt"
import { Tool } from "./tool"
import z from "zod"

const parameters = z.object({
  command: z.string().describe("The shell command to run in the background"),
  title: z.string().describe("Short title for the monitored job").optional(),
  workdir: z
    .string()
    .describe("Working directory for the command. Defaults to the current project directory.")
    .optional(),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  wake: z.boolean().describe("Wake the parent session when the command finishes").optional(),
})

type MonitorMetadata = {
  monitorId: string
  sessionId: string
  title: string
  command: string
  cwd: string
  logPath: string
  status: Monitor.Status
  wake: boolean
  startedAt: number
  completedAt?: number
  exitCode?: number
  recentOutput?: string
  bytes?: number
}

function monitorMetadata(record: Monitor.Record): MonitorMetadata {
  return {
    monitorId: record.id,
    sessionId: record.sessionID,
    title: record.title,
    command: record.command,
    cwd: record.cwd,
    logPath: record.logPath,
    status: record.status,
    wake: record.wake,
    startedAt: record.time.created,
    completedAt: record.time.completed,
    exitCode: record.exitCode,
    recentOutput: record.preview,
    bytes: record.bytes,
  }
}

export const MonitorTool = Tool.define<typeof parameters, MonitorMetadata>("monitor", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const cwd = params.workdir || ctx.instance.directory
    if (params.timeout !== undefined && params.timeout <= 0) {
      throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be greater than 0.`)
    }

    // Invariant: monitor runs a shell command asynchronously, but the
    // permission check is delegated to `bash` (see
    // `PermissionRuleset.TOOL_PERMISSION` in `src/permission/ruleset.ts`).
    // This means:
    //   - A rule on `permission: "bash"` covers `monitor` too.
    //   - A rule on `permission: "monitor"` alone is **not** checked
    //     here — only `bash` rules are. If you want finer control over
    //     monitor, also add a `bash` rule (or update `TOOL_PERMISSION`).
    // The ask event below publishes the *monitor* id so the user can
    // see which tool triggered the request, but the underlying
    // evaluation is on `bash`.
    await authorizeBashCommand(params.command, cwd, ctx)

    const title = params.title?.trim() || params.command.trim().slice(0, 80)
    const record = await Monitor.start({
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID ?? `monitor_${Date.now()}`,
      title,
      command: params.command,
      cwd,
      agent: ctx.agent,
      wake: params.wake,
      timeoutMs: params.timeout,
    })

    const metadata = monitorMetadata(record)
    ctx.metadata({ title, metadata })

    return {
      title,
      metadata,
      output: [
        `Started monitor "${title}" in the background.`,
        `Command: ${params.command}`,
        `Working directory: ${cwd}`,
        `Log file: ${record.logPath}`,
        record.wake ? "Nikcli will wake the session when the command finishes." : "Wake on completion is disabled.",
      ].join("\n"),
    }
  },
})
