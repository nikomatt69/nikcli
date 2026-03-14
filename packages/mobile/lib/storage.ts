import * as SecureStore from "expo-secure-store"
import type { ServerConfig } from "./types"

const SERVER_CONFIG_KEY = "nikcli_server_config"

function envDefault(): ServerConfig | null {
  const url = process.env.EXPO_PUBLIC_NIKCLI_SERVER_URL
  if (!url) return null
  return {
    url,
    username: process.env.EXPO_PUBLIC_NIKCLI_USERNAME || undefined,
    password: process.env.EXPO_PUBLIC_NIKCLI_PASSWORD || undefined,
  }
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  const raw = await SecureStore.getItemAsync(SERVER_CONFIG_KEY)
  if (!raw) return envDefault()
  try {
    return JSON.parse(raw) as ServerConfig
  } catch {
    return envDefault()
  }
}

export async function setServerConfig(config: ServerConfig): Promise<void> {
  await SecureStore.setItemAsync(SERVER_CONFIG_KEY, JSON.stringify(config))
}

export async function clearServerConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(SERVER_CONFIG_KEY)
}
