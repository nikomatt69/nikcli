import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "@nikcli-ai/util/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { pathToFileURL } from "url"
import { select } from "@clack/prompts"
import { createNikcliClient, type Event as SdkEvent, type NikcliClient } from "@nikcli-ai/sdk/httpapi"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { SessionRepo } from "../../session/repo"
import type { Project } from "@/project/project"
import { SessionDiffRepo } from "../../session/diff-repo"
import { SessionV2Write } from "../../session/v2/write"
import type { Session } from "../../session"
import type { MessageV2 } from "../../session/message-v2"
import type { Snapshot } from "../../snapshot"
import { Config } from "../../config/config"
import { ShareNext } from "../../share/share-next"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"
import { Log } from "@nikcli-ai/util/log"
import z from "zod"

const log = Log.create({ service: "run-command" })

const TOOL = new Map<string, [string, string]>(
  Object.entries({
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
    webfetch: ["Fetch", UI.Style.TEXT_DIM_BOLD],
    codesearch: ["Code", UI.Style.TEXT_DIM_BOLD],
    task: ["Task", UI.Style.TEXT_INFO_BOLD],
    monitor: ["Monitor", UI.Style.TEXT_DANGER_BOLD],
    apply_patch: ["Patch", UI.Style.TEXT_SUCCESS_BOLD],
    multiedit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
    tree: ["Tree", UI.Style.TEXT_INFO_BOLD],
    browser_control: ["Browser", UI.Style.TEXT_INFO_BOLD],
    computer: ["Computer", UI.Style.TEXT_INFO_BOLD],
    skill: ["Skill", UI.Style.TEXT_HIGHLIGHT_BOLD],
    lsp: ["LSP", UI.Style.TEXT_INFO_BOLD],
    delegation: ["Delegate", UI.Style.TEXT_INFO_BOLD],
    delegator: ["Delegator", UI.Style.TEXT_INFO_BOLD],
    search_tools: ["Tools", UI.Style.TEXT_DIM_BOLD],
    memory_search: ["Memory", UI.Style.TEXT_DIM_BOLD],
    generate_image: ["Image", UI.Style.TEXT_HIGHLIGHT_BOLD],
    speak: ["Speak", UI.Style.TEXT_DIM_BOLD],
    question: ["Question", UI.Style.TEXT_WARNING_BOLD],
    repo_clone: ["Repo", UI.Style.TEXT_INFO_BOLD],
    repo_overview: ["Repo", UI.Style.TEXT_INFO_BOLD],
    exec_code: ["Exec", UI.Style.TEXT_DANGER_BOLD],
    code_mode: ["Exec", UI.Style.TEXT_WARNING_BOLD],
    plan_enter: ["Plan", UI.Style.TEXT_WARNING_BOLD],
    plan_exit: ["Plan", UI.Style.TEXT_WARNING_BOLD],
    advisor: ["Advisor", UI.Style.TEXT_HIGHLIGHT_BOLD],
    context_collect: ["Context", UI.Style.TEXT_DIM_BOLD],
    context_related: ["Context", UI.Style.TEXT_DIM_BOLD],
    context_diagnostics: ["Context", UI.Style.TEXT_DIM_BOLD],
  } satisfies Record<string, [string, string]>),
)

const SHARE_ID = /^[0-9a-z]{26}$/i

const ShareReferenceSchema = z.object({
  shareID: z.string().regex(SHARE_ID),
  origins: z.array(z.string().url()).default([]),
})

function commandGet(name: string) {
  return runPromiseWithLayer(
    Command.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const command = yield* Command.Service
        return yield* command.get(name)
      }),
    ),
  )
}

function runShareNext<A, E>(effect: Effect.Effect<A, E, ShareNext.Service>): Promise<A> {
  return runPromiseWithLayer(ShareNext.defaultLayer, effect)
}

function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

function agentGet(name: string) {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.get(name)
      }),
    ),
  )
}

const ShareErrorBody = z.object({
  error: z.object({ message: z.string().optional() }).catch({}).optional(),
  data: z.object({ message: z.string().optional() }).catch({}).optional(),
  message: z.string().optional().catch(undefined),
})
type ShareErrorBody = z.infer<typeof ShareErrorBody>

function shareErrorMessage(error: Error | ShareErrorBody): string {
  if (error instanceof Error && error.message) return error.message
  const parsed = ShareErrorBody.safeParse(error)
  if (parsed.success) {
    const message = parsed.data.error?.message ?? parsed.data.data?.message ?? parsed.data.message
    if (message && message.trim()) return message.trim()
  }
  return "Failed to share session"
}

function invalidSessionReference(): never {
  UI.error("Invalid --session value. Use a `ses_...` session ID or a share URL/ID.")
  process.exit(1)
}

function resolveEnterpriseOrigin(hostname: string): string | undefined {
  if (hostname === "nikcli.store") return "https://s.nikcli.store"
  if (hostname === "dev.nikcli.store") return "https://dev.s.nikcli.store"
  if (hostname.endsWith(".dev.nikcli.store")) {
    const stage = hostname.slice(0, -".dev.nikcli.store".length)
    if (stage) return `https://${stage}.dev.s.nikcli.store`
  }
  return undefined
}

function parseShareReference(input: string): z.infer<typeof ShareReferenceSchema> | undefined {
  if (SHARE_ID.test(input)) {
    return {
      shareID: input.toLowerCase(),
      origins: [],
    }
  }

  if (!input.startsWith("http://") && !input.startsWith("https://")) return undefined

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return undefined
  }

  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length !== 2) return undefined

  const [prefix, shareID] = parts
  if (prefix !== "share" && prefix !== "s") return undefined
  if (!SHARE_ID.test(shareID)) return undefined

  const origins = new Set<string>()
  const enterpriseOrigin = resolveEnterpriseOrigin(parsed.hostname)
  if (enterpriseOrigin) origins.add(enterpriseOrigin)
  origins.add(parsed.origin)

  return {
    shareID: shareID.toLowerCase(),
    origins: Array.from(origins),
  }
}

const ShareTime = z.looseObject({ created: z.number().optional() }).catch({})

const ShareSessionInfo = z.looseObject({ id: z.string() })
type ShareSessionInfo = z.infer<typeof ShareSessionInfo>

const ShareMessageInfo = z.looseObject({
  id: z.string().optional().catch(undefined),
  time: ShareTime.optional(),
})
type ShareMessageInfo = z.infer<typeof ShareMessageInfo>

const SharePartData = z.looseObject({ messageID: z.string().optional().catch(undefined) })

const ShareEntry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), data: ShareSessionInfo }),
  z.object({ type: z.literal("session_diff"), data: z.array(z.unknown()) }),
  z.object({ type: z.literal("message"), data: ShareMessageInfo }),
  z.object({ type: z.literal("part"), data: SharePartData }),
])

const ShareStreamPayload = z.array(ShareEntry.nullable().catch(null))

const ShareObjectPayload = z.looseObject({
  info: ShareSessionInfo,
  messages: z.record(z.string(), z.looseObject({ parts: z.array(z.unknown()).optional() })),
  diff: z.array(z.unknown()).optional().catch(undefined),
})

const SharePayload = z.union([ShareStreamPayload, ShareObjectPayload])
type SharePayload = z.infer<typeof SharePayload>

async function fetchSharePayload(origins: string[], shareID: string): Promise<SharePayload | undefined> {
  const urls = origins.flatMap((origin) => [`${origin}/api/share/${shareID}/data`, `${origin}/api/share/${shareID}`])

  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const json = await response.json().catch(() => undefined)
      if (!json) continue
      const parsed = SharePayload.safeParse(json)
      if (parsed.success) return parsed.data
    } catch (error) {
      log.debug("Failed to fetch share payload", { url, error })
    }
  }
  return undefined
}

interface SharePayloadMessage {
  info: ShareMessageInfo
  parts: unknown[]
}

interface NormalizedSharePayload {
  info: ShareSessionInfo
  messages: SharePayloadMessage[]
  diff?: unknown[]
}

function normalizeSharePayload(payload: SharePayload): NormalizedSharePayload | undefined {
  if (Array.isArray(payload)) {
    let info: ShareSessionInfo | undefined
    let diff: unknown[] | undefined
    const messages = new Map<string, { info?: ShareMessageInfo; parts: unknown[] }>()

    for (const item of payload) {
      if (!item) continue

      if (item.type === "session") {
        info = item.data
        continue
      }
      if (item.type === "session_diff") {
        diff = item.data
        continue
      }
      if (item.type === "message") {
        const messageID = item.data.id
        if (!messageID) continue
        const existing = messages.get(messageID)
        messages.set(messageID, {
          info: item.data,
          parts: existing?.parts ?? [],
        })
        continue
      }
      if (item.type === "part") {
        const messageID = item.data.messageID
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

    if (!info) return undefined

    return {
      info,
      diff,
      messages: Array.from(messages.values())
        .filter((item): item is { info: ShareMessageInfo; parts: unknown[] } => Boolean(item.info))
        .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))
        .map((item) => ({
          info: item.info,
          parts: item.parts,
        })),
    }
  }

  return {
    info: payload.info,
    diff: payload.diff,
    messages: Object.values(payload.messages).map((msg) => {
      const { parts, ...info } = msg
      return {
        info: ShareMessageInfo.parse(info),
        parts: parts ?? [],
      }
    }),
  }
}

async function importShareReference(project: Project.Info, input: string): Promise<string | undefined> {
  const parsed = parseShareReference(input)
  if (!parsed) return undefined

  log.debug("Importing share reference", { shareID: parsed.shareID })

  const local = await runShareNext(
    Effect.gen(function* () {
      const shareNext = yield* ShareNext.Service
      return yield* shareNext.publicData(parsed.shareID)
    }),
  ).catch(() => undefined)

  let payload: SharePayload | undefined
  if (local) {
    const parsedLocal = SharePayload.safeParse(local)
    if (parsedLocal.success) payload = parsedLocal.data
  } else {
    const configOrigin = await configGet()
      .then((config) => config.enterprise?.url ?? "https://s.nikcli.store")
      .catch(() => "https://s.nikcli.store")
    payload = await fetchSharePayload(parsed.origins.length ? parsed.origins : [configOrigin], parsed.shareID)
  }

  const normalized = payload ? normalizeSharePayload(payload) : undefined
  if (!normalized) {
    throw new Error(`Share not found: ${parsed.shareID}`)
  }

  const info = normalized.info
  SessionRepo.upsert({
    ...(info as Session.Info),
    projectID: project.id,
  })

  if (normalized.diff) {
    SessionDiffRepo.upsert(info.id, normalized.diff as Snapshot.FileDiff[])
  }

  const projectID = project.id
  for (const msg of normalized.messages) {
    const messageInfo = {
      ...(msg.info as MessageV2.Info),
      sessionID: info.id,
    }
    const parts = msg.parts.map(
      (part) =>
        ({
          ...(part as MessageV2.Part),
          sessionID: info.id,
          messageID: msg.info.id as string,
        }) as MessageV2.Part,
    )
    // Entry-first persist: a projection throw cannot commit v1 rows the
    // entry table cannot represent.
    SessionV2Write.persist({
      prepared: { info: messageInfo, parts },
      promptData: "",
      projectID,
    })
  }

  log.info("Share imported successfully", {
    shareID: parsed.shareID,
    sessionID: info.id,
  })
  return info.id
}

/**
 * The per-event fields `--format json` merges into a line, beside the common
 * `type` / `timestamp` / `sessionID`. Derived from the SDK event union so a
 * changed event body fails here instead of silently reshaping the output.
 */
type RunJsonFields =
  | {
      part: Extract<SdkEvent, { type: "message.part.updated" }>["properties"]["part"]
    }
  | {
      error: NonNullable<Extract<SdkEvent, { type: "session.error" }>["properties"]["error"]>
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
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
  },
  handler: async (args) => {
    log.debug("Run command started", {
      hasMessage: args.message.length > 0,
      hasCommand: Boolean(args.command),
      hasSession: Boolean(args.session),
      hasAttach: Boolean(args.attach),
    })

    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: Array<{
      type: "file"
      url: string
      filename: string
      mime: string
    }> = []

    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)

        try {
          const exists = await file.exists()
          if (!exists) {
            UI.error(`File not found: ${filePath}`)
            process.exit(1)
          }

          const stat = await file.stat()
          const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

          fileParts.push({
            type: "file",
            url: pathToFileURL(resolvedPath).href,
            filename: path.basename(resolvedPath),
            mime,
          })
        } catch (error) {
          log.error("Failed to process file", { filePath, error })
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
      }
    }

    if (!process.stdin.isTTY) {
      try {
        const stdinText = await Bun.stdin.text()
        message += "\n" + stdinText
      } catch (error) {
        log.debug("Failed to read stdin", { error })
      }
    }

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    const execute = async (sdk: NikcliClient, sessionID: string) => {
      log.debug("Executing session", { sessionID })

      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + "|",
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: RunJsonFields) => {
        if (args.format === "json") {
          process.stdout.write(
            JSON.stringify({
              type,
              timestamp: Date.now(),
              sessionID,
              ...data,
            }) + EOL,
          )
          return true
        }
        return false
      }

      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined

      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL.get(part.tool) ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
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
          }

          if (event.type === "session.error") {
            const props = event.properties
            if (props.sessionID !== sessionID || !props.error) continue
            const err = props.error.name === "MessageOutputLengthError" ? props.error.name : props.error.data.message
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
            const result = await select({
              message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
              options: [
                { value: "once", label: "Allow once" },
                {
                  value: "always",
                  label: "Always allow: " + permission.always.join(", "),
                },
                { value: "reject", label: "Reject" },
              ],
              initialValue: "once",
            }).catch(() => "reject")
            const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response,
            })
          }
        }
      })().catch((error) => {
        // Stream failures must surface through the normal error path: the
        // processor is only awaited later, after the prompt round-trips, and an
        // unhandled interim rejection would crash the run instead.
        errorMsg = errorMsg ? errorMsg + EOL + String(error) : String(error)
      })

      const resolvedAgent = await (async () => {
        if (!args.agent) return undefined
        const agent = await agentGet(args.agent)
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
      if (errorMsg) {
        log.error("Session completed with errors", {
          sessionID,
          error: errorMsg,
        })
        process.exit(1)
      }
    }

    if (args.attach) {
      log.debug("Attaching to remote server", { url: args.attach })
      const sdk = createNikcliClient({ baseUrl: args.attach })

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) {
          const share = parseShareReference(args.session)
          if (share) {
            UI.error("Share IDs/URLs are not supported with --attach yet. Import the share locally first.")
            process.exit(1)
          }
          if (!args.session.startsWith("ses_")) invalidSessionReference()
          return args.session
        }

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? {
                title,
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              }
            : {
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NIKCLI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }, { throwOnError: true }).catch((error) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + shareErrorMessage(error))
          return { data: undefined, error }
        })
        if (!shareResult.error && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      return await execute(sdk, sessionID)
    }

    await bootstrap(process.cwd(), async (instance) => {
      log.debug("Running local nikcli session")

      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.fetch(request)
      }) as typeof globalThis.fetch

      const sdk = createNikcliClient({
        baseUrl: "http://nikcli.local",
        fetch: fetchFn,
      })

      if (args.command) {
        const exists = await commandGet(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) {
          if (args.session.startsWith("ses_")) return args.session
          const imported = await importShareReference(instance.project, args.session)
          if (!imported) invalidSessionReference()
          return imported
        }

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(title ? { title } : {})
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NIKCLI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }, { throwOnError: true }).catch((error) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + shareErrorMessage(error))
          return { data: undefined, error }
        })
        if (!shareResult.error && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await execute(sdk, sessionID)
    })
  },
})
