import * as Crypto from "expo-crypto"
import { getItem, setItem, STORAGE_KEYS } from "./storage"

export interface StoredServer {
  url: string
  secret: string
  name: string
  lastConnected: number
}

export type ConnectionMode = "local" | "cloud"

export interface StoredCloudConfig {
  url: string
  token: string
  deviceID: string
  publicKey?: string
}

export interface StoredCredentials {
  mode: ConnectionMode | null
  url: string | null
  secret: string | null
  cloudUrl: string | null
  cloudToken: string | null
  cloudDeviceID: string | null
  cloudPublicKey: string | null
}

export async function generateSecret(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16)
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return hex
}

export function getStoredCredentials(): StoredCredentials {
  const mode = getItem<ConnectionMode | null>(STORAGE_KEYS.CONNECTION_MODE, null)
  const url = getItem<string | null>(STORAGE_KEYS.SERVER_URL, null)
  const secret = getItem<string | null>(STORAGE_KEYS.SESSION_SECRET, null)
  const cloudUrl = getItem<string | null>(STORAGE_KEYS.CLOUD_URL, null)
  const cloudToken = getItem<string | null>(STORAGE_KEYS.CLOUD_TOKEN, null)
  const cloudDeviceID = getItem<string | null>(STORAGE_KEYS.CLOUD_DEVICE_ID, null)
  const cloudPublicKey = getItem<string | null>(STORAGE_KEYS.CLOUD_PUBLIC_KEY, null)

  return {
    mode,
    url,
    secret,
    cloudUrl,
    cloudToken,
    cloudDeviceID,
    cloudPublicKey,
  }
}

export function setStoredCredentials(url: string, secret: string): void {
  setItem(STORAGE_KEYS.CONNECTION_MODE, "local")
  setItem(STORAGE_KEYS.SERVER_URL, url)
  setItem(STORAGE_KEYS.SESSION_SECRET, secret)

  addToRecentServers({ url, secret, name: url, lastConnected: Date.now() })
}

export function clearStoredCredentials(): void {
  removeItem(STORAGE_KEYS.CONNECTION_MODE)
  removeItem(STORAGE_KEYS.SERVER_URL)
  removeItem(STORAGE_KEYS.SESSION_SECRET)
  removeItem(STORAGE_KEYS.CLOUD_URL)
  removeItem(STORAGE_KEYS.CLOUD_TOKEN)
  removeItem(STORAGE_KEYS.CLOUD_DEVICE_ID)
  removeItem(STORAGE_KEYS.CLOUD_PUBLIC_KEY)
}

export function setStoredCloudCredentials(config: StoredCloudConfig): void {
  setItem(STORAGE_KEYS.CONNECTION_MODE, "cloud")
  setItem(STORAGE_KEYS.CLOUD_URL, config.url)
  setItem(STORAGE_KEYS.CLOUD_TOKEN, config.token)
  setItem(STORAGE_KEYS.CLOUD_DEVICE_ID, config.deviceID)
  if (config.publicKey) {
    setItem(STORAGE_KEYS.CLOUD_PUBLIC_KEY, config.publicKey)
  }
}

export async function generateDevicePublicKey(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(32)
  return Array.from(randomBytes)
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
}

export function getRecentServers(): StoredServer[] {
  return getItem<StoredServer[]>(STORAGE_KEYS.RECENT_SERVERS, [])
}

function addToRecentServers(server: StoredServer): void {
  const recent = getRecentServers()
  const filtered = recent.filter((s) => s.url !== server.url)
  filtered.unshift(server)

  if (filtered.length > 10) {
    filtered.pop()
  }

  setItem(STORAGE_KEYS.RECENT_SERVERS, filtered)
}

export function removeFromRecentServers(url: string): void {
  const recent = getRecentServers()
  const filtered = recent.filter((s) => s.url !== url)
  setItem(STORAGE_KEYS.RECENT_SERVERS, filtered)
}

export function removeItem(key: string): void {
  const fn = require("./storage").removeItem
  fn(key)
}

export async function hashPassword(password: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, password)
  return digest
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function normalizeUrl(url: string): string {
  let normalized = url.trim()

  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `http://${normalized}`
  }

  try {
    const parsed = new URL(normalized)
    if (!parsed.port) {
      normalized = `${parsed.protocol}//${parsed.host}`
    }
    return normalized
  } catch {
    return url
  }
}
