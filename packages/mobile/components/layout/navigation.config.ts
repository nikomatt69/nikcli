import type { LucideIcon } from "lucide-react-native"
import { GitBranch, Settings, TerminalSquare, UserCircle2 } from "lucide-react-native"
import type { MobileBootstrap } from "@/lib/types"

export type AppTabRoute = "sessions" | "repos" | "settings" | "user"
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
    route: "settings",
    path: "/settings",
    label: "Settings",
    subtitle: "Control host trust, GitHub access, and operator preferences.",
    icon: Settings,
  },
  {
    route: "user",
    path: "/user",
    label: "Profile",
    subtitle: "Manage your account, credentials, and user administration.",
    icon: UserCircle2,
  },
]

export function getCurrentTab(routeName: string) {
  return APP_TABS.find((tab) => tab.route === routeName) ?? APP_TABS[0]
}

export function getGitHubStatusLabel(bootstrap: MobileBootstrap | null, fallback: string) {
  const login = bootstrap?.github?.user?.login
  if (!bootstrap?.github?.connected || !login) return fallback
  return `@${login}`
}

export function getCurrentProjectLabel(bootstrap: MobileBootstrap | null, fallback: string) {
  return bootstrap?.currentProject?.name ?? bootstrap?.currentProject?.worktree?.split("/").pop() ?? fallback
}
