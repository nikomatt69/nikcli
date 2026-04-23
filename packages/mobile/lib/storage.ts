import * as SecureStore from "expo-secure-store"
import type {
  AppPreferences,
  ComposerPreferences,
  GesturePreferences,
  HapticPreferences,
  NotificationPreferences,
  PromptPreset,
  ServerConfig,
  SettingsSectionID,
} from "./types"

const SERVER_CONFIG_KEY = "nikcli_server_config"
const APP_PREFERENCES_KEY = "nikcli_app_preferences"
const USER_TOKEN_KEY = "nikcli_user_token"
const REMEMBERED_USER_KEY = "nikcli_remembered_user"
const LIVE_ACTIVITY_REGISTRY_KEY = "nikcli_live_activity_registry"

export type RememberedUser = {
  email: string
  timestamp: number
}

export async function getRememberedUser(): Promise<RememberedUser | null> {
  const raw = await SecureStore.getItemAsync(REMEMBERED_USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as RememberedUser
  } catch {
    return null
  }
}

export async function setRememberedUser(email: string): Promise<void> {
  await SecureStore.setItemAsync(REMEMBERED_USER_KEY, JSON.stringify({ email, timestamp: Date.now() }))
}

export async function clearRememberedUser(): Promise<void> {
  await SecureStore.deleteItemAsync(REMEMBERED_USER_KEY)
}

export async function getUserToken(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_TOKEN_KEY)
}

export async function setUserToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(USER_TOKEN_KEY, token)
}

export async function clearUserToken(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_TOKEN_KEY)
}

const DEFAULT_SETTINGS_SECTIONS: Record<SettingsSectionID, boolean> = {
  profile: true,
  interaction: true,
  commands: true,
  memories: true,
  connection: true,
  execution: true,
  providers: true,
  github: true,
  mcp: true,
  skills: true,
  advanced: true,
  connectors: true,
  agents: true,
  tokens: true,
  routines: true,
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  sessionReady: true,
  permissions: true,
  failures: true,
}

const DEFAULT_HAPTIC_PREFERENCES: HapticPreferences = {
  enabled: true,
  send: true,
  commands: true,
  permissions: true,
  errors: true,
}

const DEFAULT_GESTURE_PREFERENCES: GesturePreferences = {
  bubbleSwipeActions: true,
  bubbleLongPressActions: true,
}

const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  defaultMode: "code",
  autoFollowTranscript: true,
  slashSuggestions: true,
}

const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "preset-review",
    title: "Review current work",
    prompt: "Review the current changes, call out risks, and propose the smallest safe next steps.",
    mode: "plan",
  },
  {
    id: "preset-fix",
    title: "Fix latest error",
    prompt: "Investigate the latest failure, explain the root cause, and apply the smallest correct fix.",
    mode: "code",
  },
  {
    id: "preset-publish",
    title: "Prepare publish",
    prompt: "Check the diff, summarize the work, and get this session ready to publish safely.",
    mode: "plan",
  },
]

function defaultPreferences(): AppPreferences {
  return {
    themeMode: "system",
    visibleSettingsSections: DEFAULT_SETTINGS_SECTIONS,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    haptics: DEFAULT_HAPTIC_PREFERENCES,
    gestures: DEFAULT_GESTURE_PREFERENCES,
    composer: DEFAULT_COMPOSER_PREFERENCES,
    promptPresets: DEFAULT_PROMPT_PRESETS,
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
      notifications: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...(parsed.notifications ?? {}),
      },
      haptics: {
        ...DEFAULT_HAPTIC_PREFERENCES,
        ...(parsed.haptics ?? {}),
      },
      gestures: {
        ...DEFAULT_GESTURE_PREFERENCES,
        ...(parsed.gestures ?? {}),
      },
      composer: {
        ...DEFAULT_COMPOSER_PREFERENCES,
        ...(parsed.composer ?? {}),
      },
      promptPresets: Array.isArray(parsed.promptPresets)
        ? parsed.promptPresets.filter(
            (item): item is PromptPreset =>
              typeof item === "object" &&
              item !== null &&
              typeof item.id === "string" &&
              typeof item.title === "string" &&
              typeof item.prompt === "string" &&
              (item.mode === "plan" || item.mode === "code"),
          )
        : DEFAULT_PROMPT_PRESETS,
    }
  } catch {
    return defaultPreferences()
  }
}

export async function setAppPreferences(preferences: AppPreferences): Promise<void> {
  await SecureStore.setItemAsync(APP_PREFERENCES_KEY, JSON.stringify(preferences))
}

export async function getLiveActivityRegistry(): Promise<Record<string, string>> {
  const raw = await SecureStore.getItemAsync(LIVE_ACTIVITY_REGISTRY_KEY)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    )
  } catch {
    return {}
  }
}

export async function setLiveActivityRegistry(registry: Record<string, string>): Promise<void> {
  if (!Object.keys(registry).length) {
    await SecureStore.deleteItemAsync(LIVE_ACTIVITY_REGISTRY_KEY)
    return
  }

  await SecureStore.setItemAsync(LIVE_ACTIVITY_REGISTRY_KEY, JSON.stringify(registry))
}
