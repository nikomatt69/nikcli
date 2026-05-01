import type { LucideIcon } from "lucide-react-native"
import { GitBranch, Repeat2, Settings, TerminalSquare, UserCircle2 } from "lucide-react-native"
import type { MobileBootstrap } from "@/lib/types"

export type AppTabRoute = "sessions" | "repos" | "routines" | "terminal"
export type AppRoutePath = `/${AppTabRoute}`

export type AppTabConfig = {
  route: AppTabRoute
  path: AppRoutePath
  label: string
  subtitle: string
  icon: LucideIcon
}

export const APP_TABS: AppTabConfig[] = [
  {
    route: "sessions",
    path: "/sessions",
    label: "Sessions",
    subtitle: "Monitor live runs, approvals, and publish readiness.",
    icon: TerminalSquare,
  },
  {
    route: "repos",
    path: "/repos",
    label: "Repos",
    subtitle: "Launch repo-scoped worktrees and branch-native execution flows.",
    icon: GitBranch,
  },
  {
    route: "routines",
    path: "/routines",
    label: "Routines",
    subtitle: "Manage scheduled and API-triggered AI workflows.",
    icon: Repeat2,
  },
  {
    route: "terminal",
    path: "/terminal",
    label: "Terminal",
    subtitle: "Open a real shell on your nikcli server.",
    icon: TerminalSquare,
  },
]

const ROUTE_META: Record<string, Pick<AppTabConfig, "label" | "subtitle" | "icon">> = {
  settings: {
    label: "Settings",
    subtitle: "Tune connection, models, automation, and trust controls.",
    icon: Settings,
  },
  user: {
    label: "Profile",
    subtitle: "Manage account access and signed-in identity.",
    icon: UserCircle2,
  },
}

export function getCurrentTab(routeName: string) {
  return APP_TABS.find((tab) => tab.route === routeName) ?? { ...APP_TABS[0], ...ROUTE_META[routeName] }
}

export function getGitHubStatusLabel(bootstrap: MobileBootstrap | null, fallback: string) {
  const login = bootstrap?.github?.user?.login
  if (!bootstrap?.github?.connected || !login) return fallback
  return `@${login}`
}

export function getCurrentProjectLabel(bootstrap: MobileBootstrap | null, fallback: string) {
  return bootstrap?.currentProject?.name ?? bootstrap?.currentProject?.worktree?.split("/").pop() ?? fallback
}
