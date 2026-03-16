import { create } from "zustand"
import type {
  AppPreferences,
  GesturePreferences,
  HapticPreferences,
  NotificationPreferences,
  SettingsSectionID,
  ThemeMode,
} from "@/lib/types"

export type AppShellRoute = "sessions" | "repos" | "settings"

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
}

const defaultRouteLabels: RouteLabelState = {
  sessions: { label: "Sessions", subtitle: "Monitor active work" },
  repos: { label: "Repos", subtitle: "Manage connected codebases" },
  settings: { label: "Settings", subtitle: "Configure host access" },
}

const defaultVisibleSettingsSections: Record<SettingsSectionID, boolean> = {
  profile: true,
  interaction: true,
  connection: true,
  execution: true,
  providers: true,
  github: true,
  mcp: true,
  skills: true,
  advanced: true,
}

const defaultNotifications: NotificationPreferences = {
  enabled: true,
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

export const useUIStore = create<AppShellState>((set) => ({
  drawerOpen: false,
  activeRoute: "sessions",
  routeLabels: defaultRouteLabels,
  themeMode: "system",
  visibleSettingsSections: defaultVisibleSettingsSections,
  notifications: defaultNotifications,
  haptics: defaultHaptics,
  gestures: defaultGestures,
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
}))
