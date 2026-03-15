import * as SecureStore from "expo-secure-store"
import type { AppPreferences, ServerConfig, SettingsSectionID } from "./types"

const SERVER_CONFIG_KEY = "nikcli_server_config"
const APP_PREFERENCES_KEY = "nikcli_app_preferences"

const DEFAULT_SETTINGS_SECTIONS: Record<SettingsSectionID, boolean> = {
  profile: true,
  connection: true,
  execution: true,
  providers: true,
  github: true,
  mcp: true,
  skills: true,
  advanced: true,
}

function defaultPreferences(): AppPreferences {
  return {
    themeMode: "system",
    visibleSettingsSections: DEFAULT_SETTINGS_SECTIONS,
  }
}

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

export async function getAppPreferences(): Promise<AppPreferences> {
  const raw = await SecureStore.getItemAsync(APP_PREFERENCES_KEY)
  if (!raw) return defaultPreferences()
  try {
    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    return {
      themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" ? parsed.themeMode : "system",
      visibleSettingsSections: {
        ...DEFAULT_SETTINGS_SECTIONS,
        ...(parsed.visibleSettingsSections ?? {}),
      },
    }
  } catch {
    return defaultPreferences()
  }
}

export async function setAppPreferences(preferences: AppPreferences): Promise<void> {
  await SecureStore.setItemAsync(APP_PREFERENCES_KEY, JSON.stringify(preferences))
}
