import type { ServerConfig } from "@/lib/types"

/**
 * Decode a pairing payload from a QR, a pasted `nikcli://` link, or a raw
 * http(s) server URL. The CLI / TUI encode the same shape:
 * `nikcli://connect?server=...&token=...&directory=...`
 */
export function parsePairingPayload(input: string): ServerConfig | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const embedded = trimmed.match(/nikcli:\/\/[^\s]+/)
  if (embedded) {
    const fromLink = parseDeepLink(embedded[0])
    if (fromLink) return fromLink
  }

  return parseHttpServer(trimmed)
}

function parseDeepLink(value: string): ServerConfig | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "nikcli:") return null

    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.replace(/\/+$/, "")
    const isConnectHost = host === "connect"
    const isRoot = !host && (path === "" || path === "/")
    if (!isConnectHost && !isRoot) return null

    const server = parsed.searchParams.get("server")?.trim()
    if (!server) return null

    return {
      url: stripTrailingSlash(server),
      token: parsed.searchParams.get("token")?.trim() || undefined,
      directory: parsed.searchParams.get("directory")?.trim() || undefined,
    }
  } catch {
    return null
  }
}

function parseHttpServer(value: string): ServerConfig | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return { url: stripTrailingSlash(value) }
  } catch {
    return null
  }
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}
