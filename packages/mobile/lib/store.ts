import { create } from "zustand"
import type {
  AppPreferences,
  ComposerPreferences,
  GesturePreferences,
  HapticPreferences,
  NotificationPreferences,
  PromptPreset,
  SecurityPreferences,
  SettingsSectionID,
  ThemeMode,
  WallpaperPreferences,
} from "@/lib/types"

export type ToastKind = "success" | "error" | "info"

export type ToastEntry = {
  id: string
  message: string
  kind: ToastKind
}

export interface AppShellState {
  themeMode: ThemeMode
  visibleSettingsSections: Record<SettingsSectionID, boolean>
  notifications: NotificationPreferences
  haptics: HapticPreferences
  gestures: GesturePreferences
  composer: ComposerPreferences
  promptPresets: PromptPreset[]
  wallpaper: WallpaperPreferences
  security: SecurityPreferences
  tipsHidden: boolean
  mathEnabled: boolean
  preferencesReady: boolean
  toasts: ToastEntry[]
  offlineQueueCount: number
  offlineQueueRevision: number
  hydratePreferences(preferences: AppPreferences): void
  setThemeMode(mode: ThemeMode): void
  setSettingsSectionVisible(section: SettingsSectionID, visible: boolean): void
  setNotificationPreference<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]): void
  setHapticPreference<K extends keyof HapticPreferences>(key: K, value: HapticPreferences[K]): void
  setGesturePreference<K extends keyof GesturePreferences>(key: K, value: GesturePreferences[K]): void
  setComposerPreference<K extends keyof ComposerPreferences>(key: K, value: ComposerPreferences[K]): void
  setPromptPresets(presets: PromptPreset[]): void
  setWallpaper(wallpaper: WallpaperPreferences): void
  setSecurityPreference<K extends keyof SecurityPreferences>(key: K, value: SecurityPreferences[K]): void
  setTipsHidden(hidden: boolean): void
  setMathEnabled(enabled: boolean): void
  showToast(input: { message: string; kind?: ToastKind }): void
  dismissToast(id: string): void
  setOfflineQueueCount(count: number): void
}

const defaultVisibleSettingsSections: Record<SettingsSectionID, boolean> = {
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
  plugins: true,
  permissions: true,
}

const defaultNotifications: NotificationPreferences = {
  enabled: false,
  sessionReady: true,
  permissions: true,
  failures: true,
}

const defaultHaptics: HapticPreferences = {
  enabled: true,
  send: true,
  commands: true,
  permissions: true,
  errors: true,
}

const defaultGestures: GesturePreferences = {
  bubbleSwipeActions: true,
  bubbleLongPressActions: true,
}

const defaultComposer: ComposerPreferences = {
  defaultMode: "code",
  autoFollowTranscript: true,
  slashSuggestions: true,
}

const defaultWallpaper: WallpaperPreferences = {
  uri: null,
  opacity: 0.22,
  enabled: false,
}

const defaultSecurity: SecurityPreferences = {
  biometricsEnabled: false,
  lockOnBackground: true,
  confirmSensitiveActions: true,
}

const defaultPromptPresets: PromptPreset[] = [
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

export const useUIStore = create<AppShellState>((set) => ({
  themeMode: "system",
  visibleSettingsSections: defaultVisibleSettingsSections,
  notifications: defaultNotifications,
  haptics: defaultHaptics,
  gestures: defaultGestures,
  composer: defaultComposer,
  promptPresets: defaultPromptPresets,
  wallpaper: defaultWallpaper,
  security: defaultSecurity,
  tipsHidden: false,
  mathEnabled: false,
  preferencesReady: false,
  toasts: [],
  offlineQueueCount: 0,
  offlineQueueRevision: 0,
  hydratePreferences: (preferences) =>
    set({
      themeMode: preferences.themeMode,
      visibleSettingsSections: {
        ...defaultVisibleSettingsSections,
        ...preferences.visibleSettingsSections,
      },
      notifications: {
        ...defaultNotifications,
        ...preferences.notifications,
      },
      haptics: {
        ...defaultHaptics,
        ...preferences.haptics,
      },
      gestures: {
        ...defaultGestures,
        ...preferences.gestures,
      },
      composer: {
        ...defaultComposer,
        ...preferences.composer,
      },
      promptPresets: preferences.promptPresets?.length ? preferences.promptPresets : defaultPromptPresets,
      wallpaper: {
        ...defaultWallpaper,
        ...preferences.wallpaper,
      },
      security: {
        ...defaultSecurity,
        ...preferences.security,
      },
      tipsHidden: preferences.tipsHidden === true,
      mathEnabled: preferences.mathEnabled === true,
      preferencesReady: true,
    }),
  setThemeMode: (mode) => set({ themeMode: mode }),
  setSettingsSectionVisible: (section, visible) =>
    set((state) => ({
      visibleSettingsSections: {
        ...state.visibleSettingsSections,
        [section]: visible,
      },
    })),
  setNotificationPreference: (key, value) =>
    set((state) => ({
      notifications: {
        ...state.notifications,
        [key]: value,
      },
    })),
  setHapticPreference: (key, value) =>
    set((state) => ({
      haptics: {
        ...state.haptics,
        [key]: value,
      },
    })),
  setGesturePreference: (key, value) =>
    set((state) => ({
      gestures: {
        ...state.gestures,
        [key]: value,
      },
    })),
  setComposerPreference: (key, value) =>
    set((state) => ({
      composer: {
        ...state.composer,
        [key]: value,
      },
    })),
  setPromptPresets: (presets) => set({ promptPresets: presets }),
  setWallpaper: (wallpaper) => set({ wallpaper }),
  setSecurityPreference: (key, value) =>
    set((state) => ({
      security: {
        ...state.security,
        [key]: value,
      },
    })),
  setTipsHidden: (hidden) => set({ tipsHidden: hidden }),
  setMathEnabled: (enabled) => set({ mathEnabled: enabled }),
  showToast: (input) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const entry: ToastEntry = { id, message: input.message, kind: input.kind ?? "info" }
    set((state) => ({ toasts: [...state.toasts, entry].slice(-3) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setOfflineQueueCount: (count) => set({ offlineQueueCount: count }),
}))
