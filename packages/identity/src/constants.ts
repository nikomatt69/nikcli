export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60
export const AUTH_CODE_TTL_SECONDS = 5 * 60
export const LOGIN_STATE_TTL_SECONDS = 10 * 60
export const EMAIL_CODE_TTL_SECONDS = 10 * 60
export const DEVICE_CODE_TTL_SECONDS = 10 * 60
export const DEVICE_POLL_INTERVAL_SECONDS = 5

/**
 * Email code delivery limits, as a burst window plus a sustained window.
 *
 * A single hourly quota punished the most common legitimate case — the first
 * mail is slow or lands in spam, so the user asks for another one or two —
 * by locking the address out for a full hour. Splitting the budget keeps
 * re-sends available while still bounding how much mail one address can pull.
 */
export const EMAIL_CODE_BURST_LIMIT = 3
export const EMAIL_CODE_BURST_WINDOW_SECONDS = 5 * 60
export const EMAIL_CODE_HOURLY_LIMIT = 10
export const EMAIL_CODE_HOURLY_WINDOW_SECONDS = 60 * 60

/** Wrong-code submissions allowed per emailed code before it is burned. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5

/** Device approvals attempted per IP per minute (8-digit code brute-force guard). */
export const DEVICE_APPROVAL_LIMIT = 12
export const DEVICE_APPROVAL_WINDOW_SECONDS = 60

/** WebAuthn challenge lifetime, and authentication attempts per IP per minute. */
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60
export const PASSKEY_AUTH_LIMIT = 20
export const PASSKEY_AUTH_WINDOW_SECONDS = 60
export const SIGNING_KEY_ROTATION_SECONDS = 30 * 24 * 60 * 60
export const RETIRED_KEY_PUBLICATION_SECONDS = 24 * 60 * 60
export const MAX_FORM_BYTES = 16 * 1024

export const CLIENTS = {
  nikcli: ["loopback"],
  "nikcli-desktop": ["nikcli://auth/callback"],
  "nikcli-mobile": ["nikcli://auth/callback"],
  "nikcli-studio": ["https://nikcli.store/dashboard/callback"],
  "nikcli-web": ["https://nikcli.store/dashboard/callback", "https://nikcli.store/user/callback"],
  "nikcli-inference-dashboard": [
    "https://dashboard.nikcli.store/api/auth/callback",
    "https://nikcli.store/api/auth/callback",
  ],
  "nikcli-console": ["https://console.nikcli.store/auth/callback"],
} as const

export type ClientID = keyof typeof CLIENTS

export function isClientID(value: string): value is ClientID {
  return Object.hasOwn(CLIENTS, value)
}

export function isAllowedRedirect(clientID: ClientID, value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (clientID === "nikcli") {
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port !== "" && url.pathname === "/callback"
  }

  if (
    (clientID === "nikcli-studio" ||
      clientID === "nikcli-web" ||
      clientID === "nikcli-inference-dashboard" ||
      clientID === "nikcli-console") &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port !== ""
  ) {
    const allowedPath =
      clientID === "nikcli-inference-dashboard"
        ? "/api/auth/callback"
        : clientID === "nikcli-console"
          ? "/auth/callback"
          : "/dashboard/callback"
    return url.pathname === allowedPath || (clientID === "nikcli-web" && url.pathname === "/user/callback")
  }

  return (CLIENTS[clientID] as readonly string[]).includes(value)
}
