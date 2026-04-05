import type { ReactNode } from "react"
import { useEffect } from "react"
import { useAuth } from "../auth/AuthContext"

interface DashboardShellProps {
  title: string
  children: ReactNode
}

export function DashboardShell({ title, children }: DashboardShellProps) {
  const { user, loading, logout } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = "/dashboard/login"
    }
  }, [loading, user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-terminal-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
      </div>
    )
  }

  if (!user) return null

  const pathname = window.location.pathname
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/")

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-terminal-border bg-terminal-panel">
        <div className="flex h-16 items-center border-b border-terminal-border px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-terminal-accent text-lg font-bold text-white">
              N
            </div>
            <div className="text-sm font-semibold">
              <div>nikcli</div>
              <div className="text-xs font-normal text-terminal-muted">Dashboard</div>
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-1 p-4">
          <a
            href="/dashboard"
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
              pathname === "/dashboard"
                ? "bg-terminal-accent/10 text-terminal-accent"
                : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
            }`}
          >
            <span className="text-lg">🏠</span>
            <span>Overview</span>
          </a>
          <a
            href="/dashboard/sessions"
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
              isActive("/dashboard/sessions")
                ? "bg-terminal-accent/10 text-terminal-accent"
                : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
            }`}
          >
            <span className="text-lg">💬</span>
            <span>Sessions</span>
          </a>
          <a
            href="/dashboard/settings"
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
              isActive("/dashboard/settings")
                ? "bg-terminal-accent/10 text-terminal-accent"
                : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
            }`}
          >
            <span className="text-lg">⚙️</span>
            <span>Settings</span>
          </a>
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-terminal-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-terminal-accent/20 text-sm font-semibold text-terminal-accent">
                {user.displayName?.[0]?.toUpperCase() || user.username[0].toUpperCase()}
              </div>
              <div className="text-sm">
                <div className="font-medium text-terminal-text">{user.displayName || user.username}</div>
                <div className="text-xs text-terminal-muted">{user.email}</div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="rounded-lg border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-muted transition-colors hover:border-terminal-error/50 hover:text-terminal-error"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className="ml-64 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-terminal-border bg-terminal-bg/80 px-8 backdrop-blur-md">
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
