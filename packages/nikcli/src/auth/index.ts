import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"

export const OAUTH_DUMMY_KEY = "nikcli-oauth-dummy-key"

export namespace Auth {
  const SAFE_CURL_FLAGS = new Set([
    "-f",
    "-s",
    "-S",
    "-L",
    "-fsS",
    "-fsSL",
    "-sS",
    "-sSL",
    "-SL",
    "--fail",
    "--silent",
    "--show-error",
    "--location",
  ])
  const SAFE_WGET_FLAGS = new Set(["-q", "--quiet", "-O-", "-qO-"])
  const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  export const WellKnownAuthResponse = z.object({
    auth: z.object({
      command: z.array(z.string().min(1)).min(1),
      env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
    }),
  })

  const filepath = path.join(Global.Path.data, "auth.json")

  function sameOriginURL(baseURL: string, value: string) {
    const base = new URL(baseURL)
    const resolved = new URL(value, baseURL)
    if (resolved.origin !== base.origin) return
    return resolved.toString()
  }

  function extractCurlURL(baseURL: string, command: string[]) {
    let url: string | undefined
    for (const arg of command.slice(1)) {
      if (arg.startsWith("-")) {
        if (!SAFE_CURL_FLAGS.has(arg)) return
        continue
      }
      if (url) return
      url = arg
    }
    if (!url) return
    return sameOriginURL(baseURL, url)
  }

  function extractWgetURL(baseURL: string, command: string[]) {
    let url: string | undefined
    for (let i = 1; i < command.length; i++) {
      const arg = command[i]
      if (SAFE_WGET_FLAGS.has(arg)) continue
      if (arg === "-O") {
        if (command[i + 1] !== "-") return
        i++
        continue
      }
      if (arg.startsWith("-")) return
      if (url) return
      url = arg
    }
    if (!url) return
    return sameOriginURL(baseURL, url)
  }

  async function fetchSameOrigin(url: string, maxRedirects = 5): Promise<Response> {
    const origin = new URL(url).origin
    let current = url

    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const response = await fetch(current, { redirect: "manual" })
      if (!REDIRECT_STATUS.has(response.status)) {
        return response
      }

      const location = response.headers.get("location")
      if (!location) {
        throw new Error("Well-known endpoint returned a redirect without a location")
      }

      if (redirects === maxRedirects) {
        throw new Error("Too many well-known redirects")
      }

      const next = new URL(location, current)
      if (next.origin !== origin) {
        throw new Error("Cross-origin well-known redirects are not allowed")
      }

      current = next.toString()
    }

    throw new Error("Too many well-known redirects")
  }

  export async function fetchWellKnown(baseURL: string) {
    return fetchSameOrigin(new URL("/.well-known/nikcli", baseURL).toString())
  }

  export async function fetchWellKnownToken(baseURL: string, command: string[]) {
    const url =
      command[0] === "curl"
        ? extractCurlURL(baseURL, command)
        : command[0] === "wget"
          ? extractWgetURL(baseURL, command)
          : undefined

    if (!url) {
      throw new Error("Unsupported or unsafe well-known auth command")
    }

    const response = await fetchSameOrigin(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch well-known auth token (${response.status})`)
    }

    return (await response.text()).trim()
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    // On Windows, Bun.file might have issues with certain paths
    // Use fs.readFile as fallback for better Windows compatibility
    let data: Record<string, unknown> = {}
    try {
      data = await file.json()
    } catch {
      // Fallback: try reading with fs for better Windows compatibility
      try {
        const text = await fs.readFile(filepath, "utf-8")
        data = JSON.parse(text)
      } catch {
        // File doesn't exist or is corrupted, return empty
        return {}
      }
    }
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const tmp = filepath + ".tmp"
    try {
      const data = await all()
      await Bun.write(tmp, JSON.stringify({ ...data, [key]: info }, null, 2))
      // chmod is Unix-only, skip on Windows
      if (process.platform !== "win32") {
        await fs.chmod(tmp, 0o600)
      }
      await fs.rename(tmp, filepath)
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  }

  export async function remove(key: string) {
    const tmp = filepath + ".tmp"
    try {
      const data = await all()
      delete data[key]
      await Bun.write(tmp, JSON.stringify(data, null, 2))
      // chmod is Unix-only, skip on Windows
      if (process.platform !== "win32") {
        await fs.chmod(tmp, 0o600)
      }
      await fs.rename(tmp, filepath)
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  }
}
