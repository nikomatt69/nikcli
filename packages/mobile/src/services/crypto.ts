import * as Crypto from "expo-crypto"
import { getItem, setItem, STORAGE_KEYS } from "./storage"

export interface StoredServer {
  url: string
  secret: string
  name: string
  lastConnected: number
}

export async function generateSecret(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16)
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return hex
}

export function getStoredCredentials(): { url: string | null; secret: string | null } {
  const url = getItem<string | null>(STORAGE_KEYS.SERVER_URL, null)
  const secret = getItem<string | null>(STORAGE_KEYS.SESSION_SECRET, null)
  return { url, secret }
}

export function setStoredCredentials(url: string, secret: string): void {
  setItem(STORAGE_KEYS.SERVER_URL, url)
  setItem(STORAGE_KEYS.SESSION_SECRET, secret)

  addToRecentServers({ url, secret, name: url, lastConnected: Date.now() })
}

export function clearStoredCredentials(): void {
  removeItem(STORAGE_KEYS.SERVER_URL)
  removeItem(STORAGE_KEYS.SESSION_SECRET)
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
