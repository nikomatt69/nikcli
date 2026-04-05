import { useState, useEffect } from "react"
import { useAuth } from "../auth/AuthContext"

interface Session {
  id: string
  title: string
  status: string
  createdAt: string
  messages: number
}

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

export function SessionsPage() {
  const { token } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    fetch("/session/list", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setSessions(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => {
        setSessions([])
        setLoading(false)
      })
  }, [token])

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
