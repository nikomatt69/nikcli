import { create } from "zustand"

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
  openDrawer(): void
  closeDrawer(): void
  toggleDrawer(): void
  setActiveRoute(route: AppShellRoute): void
  setRouteLabel(route: AppShellRoute, meta: RouteLabelMeta): void
  resetRouteLabel(route: AppShellRoute): void
}

const defaultRouteLabels: RouteLabelState = {
  sessions: { label: "Sessions", subtitle: "Monitor active work" },
  repos: { label: "Repos", subtitle: "Manage connected codebases" },
  settings: { label: "Settings", subtitle: "Configure host access" },
}

export const useUIStore = create<AppShellState>((set) => ({
  drawerOpen: false,
  activeRoute: "sessions",
  routeLabels: defaultRouteLabels,
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
}))
