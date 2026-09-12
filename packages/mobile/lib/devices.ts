import type { ServerConfig } from "@/lib/types"

/**
 * The hosts this app knows how to reach.
 *
 * nikcli drives one host at a time — that is what `ServerConfig` holds — but a
 * phone moves between them: a laptop at a desk, a container in the cloud, a
 * machine on the LAN. This keeps the ones you have connected to, so switching
 * back is a tap instead of retyping a URL and a token.
 *
 * The active host stays `ServerConfig`: everything downstream reads it, and a
 * second source of truth for "where are we pointed" would be a bug waiting to
 * happen. Switching device writes that device into the config.
 */

export type SavedDevice = {
  id: string
  /** What the user sees. Defaults to the host, and can be renamed. */
  label: string
  url: string
  token?: string
  username?: string
  password?: string
  directory?: string
  addedAt: number
  lastUsedAt?: number
}

/** Trailing slashes and stray whitespace make two spellings of one host. */
export function normalizeDeviceUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") : trimmed
}

/** "nikcli.store", "192.168.1.4:4096" — the host, which is what identifies a device. */
export function deviceLabelFor(url: string): string {
  try {
    const parsed = new URL(normalizeDeviceUrl(url))
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return normalizeDeviceUrl(url) || "Unknown device"
  }
}

function deviceID(url: string): string {
  // The normalized URL *is* the identity: the same host added twice is one
  // device, however it was reached (connect screen, deep link, QR pairing).
  return `dev_${normalizeDeviceUrl(url).toLowerCase()}`
}

export function isSameDevice(a: string, b: string): boolean {
  return deviceID(a) === deviceID(b)
}

/** The device a connection describes, or null when there is nothing to remember. */
export function deviceFromConfig(
  config: Pick<ServerConfig, "url" | "token" | "username" | "password" | "directory">,
  now = Date.now(),
): SavedDevice | null {
  const url = normalizeDeviceUrl(config.url ?? "")
  if (!url) return null
  return {
    id: deviceID(url),
    label: deviceLabelFor(url),
    url,
    token: config.token,
    username: config.username,
    password: config.password,
    directory: config.directory,
    addedAt: now,
    lastUsedAt: now,
  }
}

/**
 * Add a device, or refresh the one already saved for that host.
 *
 * A re-connect carries newer credentials and a newer directory, so those win;
 * the label the user chose and the date it was first added do not.
 */
export function upsertDevice(devices: SavedDevice[], next: SavedDevice): SavedDevice[] {
  const existing = devices.find((device) => device.id === next.id)
  if (!existing) return [...devices, next]
  return devices.map((device) =>
    device.id === next.id
      ? {
          ...next,
          label: existing.label,
          addedAt: existing.addedAt,
        }
      : device,
  )
}

export function removeDevice(devices: SavedDevice[], id: string): SavedDevice[] {
  return devices.filter((device) => device.id !== id)
}

export function renameDevice(devices: SavedDevice[], id: string, label: string): SavedDevice[] {
  const trimmed = label.trim()
  if (!trimmed) return devices
  return devices.map((device) => (device.id === id ? { ...device, label: trimmed } : device))
}

/** Most recently used first, then most recently added — the order to show them in. */
export function sortDevices(devices: SavedDevice[]): SavedDevice[] {
  return [...devices].sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt))
}

/** The config to save when switching to a device, carrying over app-level choices. */
export function configForDevice(device: SavedDevice, current?: ServerConfig | null): ServerConfig {
  return {
    ...current,
    url: device.url,
    token: device.token,
    username: device.username,
    password: device.password,
    directory: device.directory,
  }
}

export function activeDevice(devices: SavedDevice[], config?: ServerConfig | null): SavedDevice | undefined {
  if (!config?.url) return undefined
  return devices.find((device) => isSameDevice(device.url, config.url))
}
