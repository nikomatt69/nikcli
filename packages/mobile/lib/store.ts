import { create } from "zustand"
import type {
  AppPreferences,
  ComposerPreferences,
  GesturePreferences,
  HapticPreferences,
  NotificationPreferences,
  PromptPreset,
  SettingsSectionID,
  ThemeMode,
} from "@/lib/types"
import {
  DEFAULT_SETTINGS_SECTIONS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_HAPTIC_PREFERENCES,
  DEFAULT_GESTURE_PREFERENCES,
  DEFAULT_COMPOSER_PREFERENCES,
  DEFAULT_PROMPT_PRESETS,
} from "@/lib/defaults"

export type AppShellRoute = "sessions" | "repos" | "settings" | "routines" | "terminal"

export type RouteLabelMeta = {
  label: string
  subtitle?: string
}

type RouteLabelState = Partial<Record<AppShellRoute, RouteLabelMeta>>

export interface AppShellState {
  drawerOpen: boolean
  activeRoute: AppShellRoute
  routeLabels: RouteLabelState
  themeMode: ThemeMode
  visibleSettingsSections: Record<SettingsSectionID, boolean>
  notifications: NotificationPreferences
  haptics: HapticPreferences
  gestures: GesturePreferences
  composer: ComposerPreferences
  promptPresets: PromptPreset[]
  preferencesReady: boolean
  openDrawer(): void
  closeDrawer(): void
  toggleDrawer(): void
  setActiveRoute(route: AppShellRoute): void
  setRouteLabel(route: AppShellRoute, meta: RouteLabelMeta): void
  resetRouteLabel(route: AppShellRoute): void
  hydratePreferences(preferences: AppPreferences): void
  setThemeMode(mode: ThemeMode): void
  setSettingsSectionVisible(section: SettingsSectionID, visible: boolean): void
  setNotificationPreference<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]): void
  setHapticPreference<K extends keyof HapticPreferences>(key: K, value: HapticPreferences[K]): void
  setGesturePreference<K extends keyof GesturePreferences>(key: K, value: GesturePreferences[K]): void
  setComposerPreference<K extends keyof ComposerPreferences>(key: K, value: ComposerPreferences[K]): void
  setPromptPresets(presets: PromptPreset[]): void
}

const defaultRouteLabels: RouteLabelState = {
  sessions: { label: "Sessions", subtitle: "Monitor active work" },
  repos: { label: "Repos", subtitle: "Manage connected codebases" },
  settings: { label: "Settings", subtitle: "Configure host access" },
  routines: { label: "Routines", subtitle: "Scheduled & triggered automations" },
  terminal: { label: "Terminal", subtitle: "Shell on your nikcli server" },
}

export const useUIStore = create<AppShellState>((set) => ({
  drawerOpen: false,
  activeRoute: "sessions",
  routeLabels: defaultRouteLabels,
  themeMode: "system",
  visibleSettingsSections: DEFAULT_SETTINGS_SECTIONS,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  haptics: DEFAULT_HAPTIC_PREFERENCES,
  gestures: DEFAULT_GESTURE_PREFERENCES,
  composer: DEFAULT_COMPOSER_PREFERENCES,
  promptPresets: DEFAULT_PROMPT_PRESETS,
  preferencesReady: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  setActiveRoute: (route) => set({ activeRoute: route }),
  setRouteLabel: (route, meta) =>
    set((state) => ({
      routeLabels: {
        ...state.routeLabels,
        [route]: meta,
      },
    })),
  resetRouteLabel: (route) =>
    set((state) => ({
      routeLabels: {
        ...state.routeLabels,
        [route]: defaultRouteLabels[route],
      },
    })),
  hydratePreferences: (preferences) =>
    set({
      themeMode: preferences.themeMode,
      visibleSettingsSections: {
        ...DEFAULT_SETTINGS_SECTIONS,
        ...preferences.visibleSettingsSections,
      },
      notifications: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...preferences.notifications,
      },
      haptics: {
        ...DEFAULT_HAPTIC_PREFERENCES,
        ...preferences.haptics,
      },
      gestures: {
        ...DEFAULT_GESTURE_PREFERENCES,
        ...preferences.gestures,
      },
      composer: {
        ...DEFAULT_COMPOSER_PREFERENCES,
        ...preferences.composer,
      },
      promptPresets: preferences.promptPresets?.length ? preferences.promptPresets : DEFAULT_PROMPT_PRESETS,
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
}))
