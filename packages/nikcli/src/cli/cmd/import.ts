import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { EOL } from "os"

const SHARE_ID = /^[a-zA-Z0-9_-]+$/

function resolveEnterpriseOrigin(hostname: string) {
  if (hostname === "nikcli.store") return "https://s.nikcli.store"
  if (hostname === "dev.nikcli.store") return "https://dev.s.nikcli.store"
  if (hostname.endsWith(".dev.nikcli.store")) {
    const stage = hostname.slice(0, -".dev.nikcli.store".length)
    if (stage) return `https://${stage}.dev.s.nikcli.store`
  }
}

function parseShareURL(input: string) {
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
      info: Session.Info
      messages: Array<{
        info: any
        parts: any[]
      }>
    }
  | undefined {
  if (Array.isArray(payload)) {
    let info: Session.Info | undefined
    const messages = new Map<string, { info?: any; parts: any[] }>()

    for (const item of payload) {
      if (!item || typeof item !== "object") continue
      if (item.type === "session") {
        info = item.data
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
    messages: Object.values(payload.messages).map((msg: any) => {
      const { parts, ...info } = msg
      return {
        info,
        parts,
      }
    }),
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: any
              parts: any[]
            }>
          }
        | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        const parsed = parseShareURL(args.file)
        if (!parsed) {
          process.stdout.write(
            `Invalid URL format. Expected: https://nikcli.store/s/<slug> or https://s.nikcli.store/share/<slug>`,
          )
          process.stdout.write(EOL)
          return
        }

        const payload = await fetchSharePayload(parsed.origins, parsed.shareID)
        const normalized = normalizeSharePayload(payload)

        if (!normalized) {
          process.stdout.write(`Share not found: ${parsed.shareID}`)
          process.stdout.write(EOL)
          return
        }

        exportData = normalized
      } else {
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)

      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
