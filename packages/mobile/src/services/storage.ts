import { MMKV } from "react-native-mmkv"

const storage = new MMKV({
  id: "nikcli-mobile",
  encryptionKey: "nikcli-secure-storage-key",
})

export function setItem<T>(key: string, value: T): void {
  try {
    const serialized = JSON.stringify(value)
    storage.set(key, serialized)
  } catch (error) {
    console.error("Storage setItem error:", error)
  }
}

export function getItem<T>(key: string, defaultValue: T): T {
  try {
    const value = storage.getString(key)
    if (value === undefined) return defaultValue
    return JSON.parse(value) as T
  } catch {
    return defaultValue
  }
}

export function removeItem(key: string): void {
  storage.delete(key)
}

export function clearAll(): void {
  storage.clearAll()
}

export const STORAGE_KEYS = {
  CONNECTION_MODE: "connection:mode",
  SERVER_URL: "connection:serverUrl",
  SESSION_SECRET: "connection:sessionSecret",
  CLOUD_URL: "connection:cloudUrl",
  CLOUD_TOKEN: "connection:cloudToken",
  CLOUD_DEVICE_ID: "connection:cloudDeviceId",
  CLOUD_PUBLIC_KEY: "connection:cloudPublicKey",
  RECENT_SERVERS: "connection:recentServers",
  LAST_EVENT_ID: "sse:lastEventId",
  OFFLINE_QUEUE: "offline:queue",
  SESSIONS: "data:sessions",
  SETTINGS: "app:settings",
} as const
