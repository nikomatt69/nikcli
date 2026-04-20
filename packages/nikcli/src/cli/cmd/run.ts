import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createNikcliClient, type NikcliClient } from "@nikcli-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { Config } from "../../config/config"
import { ShareNext } from "../../share/share-next"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

const SHARE_ID = /^[0-9a-z]{26}$/i
type RunPermissionMode = "prompt" | "reject" | "allow-once"

function shareErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object") {
    const value = error as any
    const message = value?.error?.message ?? value?.data?.message ?? value?.message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return "Failed to share session"
}

function invalidSessionReference() {
  UI.error("Invalid --session value. Use a `ses_...` session ID or a share URL/ID.")
  process.exit(1)
}

function defaultPermissionMode(): RunPermissionMode {
  return process.stdin.isTTY && process.stdout.isTTY ? "prompt" : "reject"
}

function sessionTitle(raw: unknown, message: string) {
  if (raw === undefined) return undefined
  if (raw === "") return message.slice(0, 50) + (message.length > 50 ? "..." : "")
  return String(raw)
}

function attachHeaders(password?: string) {
  const value = password ?? Flag.NIKCLI_SERVER_PASSWORD
  if (!value) return undefined
  const username = Flag.NIKCLI_SERVER_USERNAME ?? "nikcli"
  const auth = `Basic ${Buffer.from(`${username}:${value}`).toString("base64")}`
  return { Authorization: auth }
}

function resolveEnterpriseOrigin(hostname: string) {
  if (hostname === "nikcli.store") return "https://s.nikcli.store"
  if (hostname === "dev.nikcli.store") return "https://dev.s.nikcli.store"
  if (hostname.endsWith(".dev.nikcli.store")) {
    const stage = hostname.slice(0, -".dev.nikcli.store".length)
    if (stage) return `https://${stage}.dev.s.nikcli.store`
  }
}

function parseShareReference(input: string) {
  if (SHARE_ID.test(input)) {
    return {
      shareID: input,
      origins: [] as string[],
    }
  }

  if (!input.startsWith("http://") && !input.startsWith("https://")) return

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return
  }

  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length !== 2) return

  const [prefix, shareID] = parts
  if (prefix !== "share" && prefix !== "s") return
  if (!SHARE_ID.test(shareID)) return

  const origins = new Set<string>()
  const enterpriseOrigin = resolveEnterpriseOrigin(parsed.hostname)
  if (enterpriseOrigin) origins.add(enterpriseOrigin)
  origins.add(parsed.origin)

  return {
    shareID,
    origins: Array.from(origins),
  }
}

async function fetchSharePayload(origins: string[], shareID: string) {
  const urls = origins.flatMap((origin) => [`${origin}/api/share/${shareID}/data`, `${origin}/api/share/${shareID}`])

  for (const url of urls) {
    const response = await fetch(url).catch(() => undefined)
    if (!response?.ok) continue
    return response.json().catch(() => undefined)
  }
}

function normalizeSharePayload(payload: any):
  | {
      info: any
      messages: Array<{
        info: any
        parts: any[]
      }>
      diff?: any[]
    }
  | undefined {
  if (Array.isArray(payload)) {
    let info: any
    let diff: any[] | undefined
    const messages = new Map<string, { info?: any; parts: any[] }>()

    for (const item of payload) {
      if (!item || typeof item !== "object") continue
      if (item.type === "session") {
        info = item.data
        continue
      }
      if (item.type === "session_diff" && Array.isArray(item.data)) {
        diff = item.data
        continue
      }
      if (item.type === "message") {
        const messageID = item.data?.id
        if (!messageID) continue
        const existing = messages.get(messageID)
        messages.set(messageID, {
          info: item.data,
          parts: existing?.parts ?? [],
        })
        continue
      }
      if (item.type === "part") {
        const messageID = item.data?.messageID
        if (!messageID) continue
        const existing = messages.get(messageID)
        if (existing) {
          existing.parts.push(item.data)
        } else {
          messages.set(messageID, {
            parts: [item.data],
          })
        }
      }
    }

    if (!info) return

    return {
      info,
      diff,
      messages: Array.from(messages.values())
        .filter((item): item is { info: any; parts: any[] } => Boolean(item.info))
        .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))
        .map((item) => ({
          info: item.info,
          parts: item.parts,
        })),
    }
  }

  if (!payload?.info || !payload?.messages) return

  return {
    info: payload.info,
    diff: Array.isArray(payload.diff) ? payload.diff : undefined,
    messages: Object.values(payload.messages).map((msg: any) => {
      const { parts, ...info } = msg
      return {
        info,
        parts,
      }
    }),
  }
}

async function importShareReference(input: string) {
  const parsed = parseShareReference(input)
  if (!parsed) return

  let payload = await ShareNext.publicData(parsed.shareID).catch(() => undefined)
  if (!payload) {
    const configOrigin = await Config.get()
      .then((config) => config.enterprise?.url ?? "https://s.nikcli.store")
      .catch(() => "https://s.nikcli.store")
    payload = await fetchSharePayload(parsed.origins.length ? parsed.origins : [configOrigin], parsed.shareID)
  }

  const normalized = normalizeSharePayload(payload)
  if (!normalized) {
    throw new Error(`Share not found: ${parsed.shareID}`)
  }

  await Storage.write(["session", Instance.project.id, normalized.info.id], normalized.info)
  if (normalized.diff) {
    await Storage.write(["session_diff", normalized.info.id], normalized.diff)
  }

  for (const msg of normalized.messages) {
    await Storage.write(["message", normalized.info.id, msg.info.id], msg.info)
    for (const part of msg.parts) {
      await Storage.write(["part", msg.info.id, part.id], part)
    }
  }

  return normalized.info.id as string
}

async function resolveRunSessionID(input: {
  sdk: NikcliClient
  attach?: boolean
  continue?: boolean
  session?: string
  fork?: boolean
  title?: unknown
  message: string
  workspace?: string
}) {
  let baseID: string | undefined

  if (input.continue) {
    const result = await input.sdk.session.list()
    baseID = result.data?.find((session) => !session.parentID)?.id
  } else if (input.session) {
    if (input.attach) {
      const share = parseShareReference(input.session)
      if (share) {
        UI.error("Share IDs/URLs are not supported with --attach yet. Import the share locally first.")
        process.exit(1)
      }
      if (!input.session.startsWith("ses_")) invalidSessionReference()
      baseID = input.session
    } else if (input.session.startsWith("ses_")) {
      baseID = input.session
    } else {
      const imported = await importShareReference(input.session)
      if (!imported) invalidSessionReference()
      baseID = imported
    }
  }

  if (baseID && input.fork) {
    const forked = await input.sdk.session.fork({ sessionID: baseID })
    return forked.data?.id
  }

  if (baseID) return baseID

  const createInput = {} as {
    title?: string
    workspaceID?: string
    permission?: Array<{
      permission: string
      action: "deny"
      pattern: string
    }>
  }
  const title = sessionTitle(input.title, input.message)
  if (title) createInput.title = title
  if (input.workspace) createInput.workspaceID = input.workspace
  if (input.attach) {
    createInput.permission = [
      {
        permission: "question",
        action: "deny",
        pattern: "*",
      },
    ]
  }

  const result = await input.sdk.session.create(createInput)
  return result.data?.id
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run nikcli with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running nikcli server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password for --attach (defaults to NIKCLI_SERVER_PASSWORD)",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, or remote directory when using --attach",
      })
      .option("workspace", {
        type: "string",
        describe: "workspace id to target when attaching or creating a session",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show reasoning blocks",
        default: false,
      })
      .option("permissions", {
        type: "string",
        choices: ["prompt", "reject", "allow-once"],
        describe: "permission handling mode (defaults to prompt on TTY, reject otherwise)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
  },
  handler: async (args) => {
    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exit(1)
    }

    const localDirectory = !args.attach && args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd()
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(localDirectory, filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => {})
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    const execute = async (sdk: NikcliClient, sessionID: string) => {
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined
      const permissionMode = (args.permissions ?? defaultPermissionMode()) as RunPermissionMode

      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              printEvent(color, tool, title)
              if (part.tool === "bash" && part.state.output?.trim()) {
                UI.println()
                UI.println(part.state.output)
              }
            }

            if (part.type === "step-start") {
              if (outputJsonEvent("step_start", { part })) continue
            }

            if (part.type === "step-finish") {
              if (outputJsonEvent("step_finish", { part })) continue
            }

            if (part.type === "text" && part.time?.end) {
              if (outputJsonEvent("text", { part })) continue
              const isPiped = !process.stdout.isTTY
              if (!isPiped) UI.println()
              process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
              if (!isPiped) UI.println()
            }

            if (part.type === "reasoning" && part.time?.end && args.thinking) {
              if (outputJsonEvent("reasoning", { part })) continue
              const text = part.text.trim()
              if (!text) continue
              const line = `Thinking: ${text}`
              if (process.stdout.isTTY) {
                UI.println(UI.Style.TEXT_DIM + line)
                UI.println()
                continue
              }
              process.stdout.write(line + EOL)
            }
          }

          if (event.type === "session.error") {
            const props = event.properties
            if (props.sessionID !== sessionID || !props.error) continue
            let err = String(props.error.name)
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              err = String(props.error.data.message)
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err
            if (outputJsonEvent("error", { error: props.error })) continue
            UI.error(err)
          }

          if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
            break
          }

          if (event.type === "permission.asked") {
            const permission = event.properties
            if (permission.sessionID !== sessionID) continue
            const interactive = permissionMode === "prompt" && process.stdin.isTTY && process.stdout.isTTY
            const response = await (async () => {
              if (interactive) {
                const result = await select({
                  message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
                  options: [
                    { value: "once", label: "Allow once" },
                    { value: "always", label: "Always allow: " + permission.always.join(", ") },
                    { value: "reject", label: "Reject" },
                  ],
                  initialValue: "once",
                }).catch(() => "reject")
                return (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
              }

              if (permissionMode === "allow-once") {
                UI.println(
                  UI.Style.TEXT_WARNING_BOLD + "!",
                  UI.Style.TEXT_NORMAL,
                  `auto-approving permission once: ${permission.permission}`,
                )
                return "once" as const
              }

              UI.println(
                UI.Style.TEXT_WARNING_BOLD + "!",
                UI.Style.TEXT_NORMAL,
                `auto-rejecting permission request: ${permission.permission}`,
              )
              return "reject" as const
            })()

            await sdk.permission.reply({
              requestID: permission.id,
              reply: response,
            })
          }
        }
      })()

      const resolvedAgent = await (async () => {
        if (!args.agent) return undefined
        const agent = await Agent.get(args.agent)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return args.agent
      })()

      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent: resolvedAgent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
      } else {
        const modelParam = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent: resolvedAgent,
          model: modelParam,
          variant: args.variant,
          parts: [...fileParts, { type: "text", text: message }],
        })
      }

      await eventProcessor
      if (errorMsg) process.exit(1)
    }

    if (args.attach) {
      const sdk = createNikcliClient({
        baseUrl: args.attach,
        directory: args.dir,
        workspace: args.workspace,
        headers: attachHeaders(args.password),
      })

      const sessionID = await resolveRunSessionID({
        sdk,
        attach: true,
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        title: args.title,
        message,
        workspace: args.workspace,
      })

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NIKCLI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }, { throwOnError: true }).catch((error) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + shareErrorMessage(error))
          return { error }
        })
        if (!("error" in shareResult) && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      return await execute(sdk, sessionID)
    }

    await bootstrap(localDirectory, async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createNikcliClient({ baseUrl: "http://nikcli.local", fetch: fetchFn, workspace: args.workspace })

      if (args.command) {
        const exists = await Command.get(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      const sessionID = await resolveRunSessionID({
        sdk,
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        title: args.title,
        message,
        workspace: args.workspace,
      })

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NIKCLI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }, { throwOnError: true }).catch((error) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + shareErrorMessage(error))
          return { error }
        })
        if (!("error" in shareResult) && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await execute(sdk, sessionID)
    })
  },
})
