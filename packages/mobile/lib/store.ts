import { create } from "zustand"
import type { AppPreferences, SettingsSectionID, ThemeMode } from "@/lib/types"

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
}

const defaultRouteLabels: RouteLabelState = {
  sessions: { label: "Sessions", subtitle: "Monitor active work" },
  repos: { label: "Repos", subtitle: "Manage connected codebases" },
  settings: { label: "Settings", subtitle: "Configure host access" },
}

const defaultVisibleSettingsSections: Record<SettingsSectionID, boolean> = {
  profile: true,
  connection: true,
  execution: true,
  providers: true,
  github: true,
  mcp: true,
  skills: true,
  advanced: true,
}

export const useUIStore = create<AppShellState>((set) => ({
  drawerOpen: false,
  activeRoute: "sessions",
  routeLabels: defaultRouteLabels,
  themeMode: "system",
  visibleSettingsSections: defaultVisibleSettingsSections,
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
}))
