export type OAuthTokenTriple = {
  access: string
  refresh: string
  expires: number
}

const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    if (typeof atob === "function") return atob(padded)
    return Buffer.from(padded, "base64").toString("utf8")
  } catch {
    return null
  }
}

export function accessTokenExpiry(accessToken: string): number | null {
  const payload = accessToken.split(".")[1]
  if (!payload) return null
  const decoded = decodeBase64Url(payload)
  if (!decoded) return null
  try {
    const value = JSON.parse(decoded) as { exp?: unknown }
    return typeof value.exp === "number" && Number.isFinite(value.exp) ? value.exp * 1000 : null
  } catch {
    return null
  }
}

export function createTokenTriple(input: {
  accessToken: string
  refreshToken?: string
  previousRefreshToken?: string
  expiresIn?: number
  issuedAt?: number
  now?: number
}): OAuthTokenTriple {
  const refresh = input.refreshToken || input.previousRefreshToken
  if (!input.accessToken) throw new Error("The authorization server did not return an access token")
  if (!refresh) throw new Error("The authorization server did not return a refresh token")

  const issuedAtMs = (input.issuedAt ?? Math.floor((input.now ?? Date.now()) / 1000)) * 1000
  const expires =
    accessTokenExpiry(input.accessToken) ?? issuedAtMs + (input.expiresIn ?? DEFAULT_ACCESS_TTL_SECONDS) * 1000
  return { access: input.accessToken, refresh, expires }
}

export function shouldRefreshToken(tokens: OAuthTokenTriple, now = Date.now(), marginMs = 60_000): boolean {
  return tokens.expires <= now + marginMs
}

export function validateOAuthState(expected: string, returned: string | undefined): void {
  if (!returned || returned !== expected) throw new Error("OAuth state validation failed")
}

export function parseStoredTokenTriple(raw: string | null): OAuthTokenTriple | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<OAuthTokenTriple>
    if (
      typeof value.access === "string" &&
      value.access.length > 0 &&
      typeof value.refresh === "string" &&
      value.refresh.length > 0 &&
      typeof value.expires === "number" &&
      Number.isFinite(value.expires)
    ) {
      return {
        access: value.access,
        refresh: value.refresh,
        expires: value.expires,
      }
    }
  } catch {
    return null
  }
  return null
}
