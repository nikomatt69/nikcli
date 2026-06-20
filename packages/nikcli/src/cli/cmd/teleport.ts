import type { Argv } from "yargs"
import { Effect } from "effect"
import os from "os"
import path from "path"
import * as prompts from "@clack/prompts"
import { Session } from "../../session"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import type { MessageV2 } from "@/session/message-v2"

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
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

/**
 * Normalize a user-entered server URL into a base origin we can append
 * `/mobile/teleport` to. Accepts values with or without a scheme/trailing slash.
 */
function normalizeBaseUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/mobile(\/teleport)?$/, "")
  } catch {
    return null
  }
}

async function saveTeleportDefaults(url: string, token: string) {
  const configPath = path.join(Global.Path.config, "nikcli.json")
  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")
  parsed.teleport = { url, token }
  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}

export const TeleportCommand = cmd({
  command: "teleport [sessionID]",
  describe: "teleport a session to a remote nikcli server to continue it from mobile",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session id to teleport (defaults to interactive selection)",
        type: "string",
      })
      .option("url", {
        alias: ["u"],
        describe: "remote server base URL (e.g. https://my-app.up.railway.app)",
        type: "string",
      })
      .option("token", {
        alias: ["t"],
        describe: "mobile Bearer token for the remote server",
        type: "string",
      })
      .option("save", {
        describe: "remember the server URL and token for next time",
        type: "boolean",
        default: true,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const config = await configGet().catch(() => undefined)
      const saved = (config as { teleport?: { url?: string; token?: string } } | undefined)?.teleport

      // Resolve target: flag → env → saved config → interactive prompt.
      let url = (args.url as string | undefined) ?? process.env.NIKCLI_TELEPORT_URL ?? saved?.url
      let token = (args.token as string | undefined) ?? process.env.NIKCLI_TELEPORT_TOKEN ?? saved?.token

      if (!url && process.stderr.isTTY) {
        const answer = await prompts.text({
          message: "Remote server URL",
          placeholder: "https://my-app.up.railway.app",
          output: process.stderr,
        })
        if (prompts.isCancel(answer)) throw new UI.CancelledError()
        url = answer as string
      }
      const base = url ? normalizeBaseUrl(url) : null
      if (!base) {
        UI.error("A valid --url (or NIKCLI_TELEPORT_URL) is required")
        process.exit(1)
      }

      if (!token && process.stderr.isTTY) {
        const answer = await prompts.password({
          message: "Mobile auth token",
          output: process.stderr,
        })
        if (prompts.isCancel(answer)) throw new UI.CancelledError()
        token = answer as string
      }
      token = token?.trim()
      if (!token) {
        UI.error("A --token (or NIKCLI_TELEPORT_TOKEN) is required")
        process.exit(1)
      }

      // Resolve which session to teleport.
      let sessionID = args.sessionID as string | undefined
      if (!sessionID) {
        const sessions = await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            const iterable = yield* session.list()
            return yield* Effect.promise(() => Array.fromAsync(iterable))
          }),
        )
        if (sessions.length === 0) {
          UI.error("No sessions found to teleport")
          process.exit(1)
        }
        sessions.sort((a: Session.Info, b: Session.Info) => b.time.updated - a.time.updated)

        if (!process.stderr.isTTY) {
          sessionID = sessions[0]!.id
        } else {
          const selected = await prompts.autocomplete({
            message: "Select session to teleport",
            maxItems: 10,
            options: sessions.map((session: Session.Info) => ({
              label: session.title,
              value: session.id,
              hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
            })),
            output: process.stderr,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          sessionID = selected as string
        }
      }

      let info: Session.Info
      let messages: MessageV2.WithParts[]
      try {
        const result = await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            const info = yield* session.get(sessionID!)
            const messages = yield* session.messages({ sessionID: sessionID! })
            return { info, messages }
          }),
        )
        info = result.info
        messages = result.messages
      } catch {
        UI.error(`Session not found: ${sessionID}`)
        process.exit(1)
      }

      process.stderr.write(`Teleporting "${info.title}" (${messages.length} messages) to ${new URL(base).host}...${os.EOL}`)

      const response = await fetch(`${base}/mobile/teleport`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: info.title,
          origin: `${os.hostname()}:${info.directory}`,
          permission: info.permission,
          messages,
        }),
      }).catch((error) => {
        UI.error(`Failed to reach ${base}: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        UI.error(
          response.status === 401
            ? "Unauthorized — check the auth token"
            : `Server error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        )
        process.exit(1)
      }

      const result = (await response.json().catch(() => null)) as
        | { sessionID?: string; messageCount?: number }
        | null

      if (args.save !== false) {
        await saveTeleportDefaults(base, token).catch(() => undefined)
      }

      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Session teleported" + UI.Style.TEXT_NORMAL)
      if (result?.sessionID) {
        UI.println(`  remote session: ${result.sessionID}`)
      }
      UI.println(`  messages:       ${result?.messageCount ?? messages.length}`)
      UI.println(`  server:         ${base}`)
      UI.println("")
      UI.println(UI.Style.TEXT_DIM + "  Open the nikcli mobile app to continue this session." + UI.Style.TEXT_NORMAL)
    })
  },
})
