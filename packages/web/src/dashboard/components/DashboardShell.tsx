import type { ReactNode } from "react"
import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

interface DashboardShellProps {
  title: string
  children: ReactNode
}

function ServerSetup() {
  const { setServerUrl } = useAuth()
  const [url, setUrl] = useState("http://localhost:4096")
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setChecking(true)
    try {
      const normalized = url.trim().replace(/\/$/, "")
      const res = await fetch(`${normalized}/user/status`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error("Server not reachable")
      setServerUrl(normalized)
      window.location.href = "/dashboard/login"
    } catch {
      setError("Cannot reach the nikcli server. Make sure it is running.")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-terminal-bg p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-terminal-accent text-2xl font-bold text-white">
            N
          </div>
          <div>
            <div className="text-xl font-bold text-terminal-text">nikcli Dashboard</div>
            <div className="text-sm text-terminal-muted">Connect to your server</div>
          </div>
        </div>

        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
          <h2 className="mb-1 text-lg font-semibold text-terminal-text">Server URL</h2>
          <p className="mb-4 text-sm text-terminal-muted">Enter the address of your running nikcli server</p>
          <form onSubmit={handleConnect} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
                {error}
              </div>
            )}
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:4096"
              required
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-3 text-terminal-text placeholder:text-terminal-muted/50 focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
            />
            <button
              type="submit"
              disabled={checking}
              className="w-full rounded-xl bg-terminal-accent px-4 py-3 font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
            >
              {checking ? "Connecting…" : "Connect"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function DashboardShellInner({ title, children }: DashboardShellProps) {
  const { user, loading, logout, serverUrl } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted && !loading && !user && (serverUrl || isDev)) {
      window.location.href = "/dashboard/login"
    }
  }, [mounted, loading, user, serverUrl])

  // Show spinner during SSR and until localStorage is read — prevents hydration mismatch
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-terminal-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
      </div>
    )
  }

  if (!serverUrl && !isDev) return <ServerSetup />

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

        <nav className="flex flex-col gap-0.5 overflow-y-auto p-3">
          <div className="mb-1 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-terminal-muted/60">
            Dashboard
          </div>
          {[
            { href: "/dashboard", label: "Overview", icon: "🏠", exact: true },
            { href: "/dashboard/sessions", label: "Sessions", icon: "💬" },
          ].map(({ href, label, icon, exact }) => (
            <a
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                exact
                  ? pathname === href
                  : isActive(href)
                    ? "bg-terminal-accent/10 text-terminal-accent"
                    : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </a>
          ))}

          <div className="mb-1 mt-3 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-terminal-muted/60">
            Studio
          </div>
          {[
            { href: "/dashboard/mcp", label: "MCP Servers", icon: "⚡" },
            { href: "/dashboard/profiles", label: "Profiles", icon: "👤" },
            { href: "/dashboard/skills", label: "Skills", icon: "🧠" },
            { href: "/dashboard/agents", label: "Agents", icon: "🤖" },
            { href: "/dashboard/config", label: "Config", icon: "🛠️" },
            { href: "/dashboard/backup", label: "Backup", icon: "💾" },
          ].map(({ href, label, icon }) => (
            <a
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(href)
                  ? "bg-terminal-accent/10 text-terminal-accent"
                  : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </a>
          ))}

          <div className="mb-1 mt-3 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-terminal-muted/60">
            Account
          </div>
          {[
            { href: "/dashboard/users", label: "Users", icon: "👥" },
            { href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
          ].map(({ href, label, icon }) => (
            <a
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(href)
                  ? "bg-terminal-accent/10 text-terminal-accent"
                  : "text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text"
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </a>
          ))}
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-terminal-border bg-terminal-bg/80 px-8 backdrop-blur-md">
          <h1 className="text-lg font-semibold">{title}</h1>
          {serverUrl ? (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-terminal-success" />
              <span className="max-w-xs truncate font-mono text-xs text-terminal-muted">{serverUrl}</span>
            </div>
          ) : isDev ? (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-terminal-success" />
              <span className="font-mono text-xs text-terminal-muted">dev proxy</span>
            </div>
          ) : null}
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}

export function DashboardShell({ title, children }: DashboardShellProps) {
  return (
    <AuthProvider>
      <DashboardShellInner title={title}>{children}</DashboardShellInner>
    </AuthProvider>
  )
}
