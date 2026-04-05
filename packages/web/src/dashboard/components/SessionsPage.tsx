import { useState, useEffect, useCallback } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"

interface Session {
  id: string
  title: string
  status: string
  createdAt: string
  messages: number
}

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-terminal-accent/10 text-3xl">
        💬
      </div>
      <h3 className="text-lg font-semibold text-terminal-text">No sessions yet</h3>
      <p className="mt-2 max-w-sm text-terminal-muted">Start your first session to interact with the nikcli AI agent</p>
      <button
        onClick={() => (window.location.href = "/dashboard/sessions")}
        className="mt-6 rounded-xl bg-terminal-accent px-6 py-3 font-semibold text-white transition-colors hover:bg-terminal-accent/90"
      >
        Create Session
      </button>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const statusColors: Record<string, string> = {
    busy: "bg-terminal-accent/20 text-terminal-accent",
    idle: "bg-terminal-success/20 text-terminal-success",
    error: "bg-terminal-error/20 text-terminal-error",
  }
  const statusLabel: Record<string, string> = {
    busy: "Active",
    idle: "Ready",
    error: "Error",
  }

  return (
    <a
      href={`/dashboard/sessions/${session.id}`}
      className="group flex flex-col gap-4 rounded-2xl border border-terminal-border bg-terminal-panel p-6 transition-all hover:border-terminal-accent/50 hover:shadow-lg"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-terminal-text group-hover:text-terminal-accent">{session.title}</div>
          <div className="mt-1 text-sm text-terminal-muted">{session.createdAt}</div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[session.status] || statusColors.idle}`}
        >
          {statusLabel[session.status] || "Ready"}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm text-terminal-muted">
        <span>{session.messages} messages</span>
      </div>
    </a>
  )
}

function SessionsPageInner() {
  const { token, serverUrl, logout } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token || (!isDev && !serverUrl)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const base = isDev ? "" : serverUrl
    fetch(`${base}/session`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          await logout()
          throw new Error("Session expired")
        }
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch((e) => {
        setSessions([])
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [token, serverUrl, logout])

  useEffect(() => {
    load()
  }, [load])

  if (!token || (!isDev && !serverUrl)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">Configure server connection in Settings</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Manage your AI sessions</p>
        <button
          onClick={() => (window.location.href = "/dashboard/sessions")}
          className="flex items-center gap-2 rounded-xl bg-terminal-accent px-4 py-2 font-semibold text-white transition-colors hover:bg-terminal-accent/90"
        >
          <span>➕</span>
          <span>New Session</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SessionsPage() {
  return (
    <AuthProvider>
      <SessionsPageInner />
    </AuthProvider>
  )
}
