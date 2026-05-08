import { Instance } from "@/project/instance"
import { Monitor } from "@/monitor/manager"
import { authorizeBashCommand } from "./bash"
import DESCRIPTION from "./monitor.txt"
import { Tool } from "./tool"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

const ParametersSchema = Schema.Struct({
  command: Schema.String.annotations({ description: "The shell command to run in the background" }),
  title: Schema.optional(Schema.String.annotations({ description: "Short title for the monitored job" })),
  workdir: Schema.optional(
    Schema.String.annotations({
      description: "Working directory for the command. Defaults to the current project directory.",
    }),
  ),
  timeout: Schema.optional(Schema.Number.annotations({ description: "Optional timeout in milliseconds" })),
  wake: Schema.optional(Schema.Boolean.annotations({ description: "Wake the parent session when the command finishes" })),
})
const parameters = zodObject(ParametersSchema)

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
    const cwd = params.workdir || Instance.directory
    if (params.timeout !== undefined && params.timeout <= 0) {
      throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be greater than 0.`)
    }

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
        `Started monitor \"${title}\" in the background.`,
        `Command: ${params.command}`,
        `Working directory: ${cwd}`,
        `Log file: ${record.logPath}`,
        record.wake ? "Nikcli will wake the session when the command finishes." : "Wake on completion is disabled.",
      ].join("\n"),
    }
  },
})
