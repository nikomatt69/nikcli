import { useState, useEffect, useCallback, useMemo } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { DashboardApiError, getErrorMessage, studioApi, type CloudSessionInfo } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function formatTime(value?: number): string {
  if (!value) return "Never"
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function messageCount(session: CloudSessionInfo): number {
  return session.messageCount ?? session.messages ?? 0
}

function statusFor(session: CloudSessionInfo, status?: string): { label: string; className: string } {
  if (session.time?.archived) return { label: "Archived", className: "bg-terminal-muted/10 text-terminal-muted" }
  if (status === "busy" || status === "running")
    return { label: "Running", className: "bg-terminal-accent/10 text-terminal-accent" }
  if (status === "error") return { label: "Error", className: "bg-terminal-error/10 text-terminal-error" }
  return { label: "Ready", className: "bg-terminal-success/10 text-terminal-success" }
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] border border-terminal-accent/20 bg-terminal-accent/10 text-terminal-accent">
        <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-terminal-text">No Cloud Sessions yet</h3>
      <p className="mt-2 max-w-sm text-sm text-terminal-muted">
        Create a Cloud Session to track remote agent work, history, and project context from the dashboard.
      </p>
      <button
        onClick={onCreate}
        className="mt-6 rounded-[var(--radius-md)] bg-terminal-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90"
      >
        Create Cloud Session
      </button>
    </div>
  )
}

function SessionsPageInner() {
  const { token, serverUrl, logout } = useAuth()
  const [sessions, setSessions] = useState<CloudSessionInfo[]>([])
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  const connected = isDev || (!!token && !!serverUrl)

  const load = useCallback(() => {
    if (!connected) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    Promise.all([studioApi.sessions.list({ limit: 200 }), studioApi.sessions.status().catch(() => ({}))])
      .then(([list, statusMap]) => {
        setSessions(Array.isArray(list) ? list : [])
        setStatuses(Object.fromEntries(Object.entries(statusMap).map(([id, info]) => [id, info.status ?? "ready"])))
      })
      .catch(async (e) => {
        if (e instanceof DashboardApiError && (e.status === 401 || e.status === 403)) {
          await logout()
          setError("Session expired")
          return
        }
        setError(getErrorMessage(e))
      })
      .finally(() => setLoading(false))
  }, [connected, logout])

  useEffect(() => {
    load()
  }, [load])

  const visibleSessions = useMemo(() => {
    const term = search.trim().toLowerCase()
    return sessions.filter((session) => {
      if (!showArchived && session.time?.archived) return false
      if (!term) return true
      return [session.title, session.id, session.directory]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    })
  }, [sessions, search, showArchived])

  const activeCount = sessions.filter((session) => !session.time?.archived).length
  const archivedCount = sessions.length - activeCount

  async function createCloudSession() {
    setCreating(true)
    setError(null)
    try {
      const session = await studioApi.sessions.create({ title: newTitle.trim() || "Cloud Session" })
      window.posthog?.capture("cloud_session_created", { session_id: session.id })
      setNewTitle("")
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Create failed")
    } finally {
      setCreating(false)
    }
  }

  async function saveTitle(id: string) {
    const title = editingTitle.trim()
    if (!title) return
    setError(null)
    try {
      await studioApi.sessions.update(id, { title })
      setEditingId(null)
      setEditingTitle("")
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Rename failed")
    }
  }

  async function archiveSession(session: CloudSessionInfo) {
    setError(null)
    try {
      await studioApi.sessions.update(session.id, { time: { archived: session.time?.archived ? 0 : Date.now() } })
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Archive failed")
    }
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this Cloud Session and its history?")) return
    setError(null)
    try {
      await studioApi.sessions.delete(id)
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Delete failed")
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">
          Configure server connection in Settings to manage Cloud Sessions.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-terminal-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-terminal-accent">
            Cloud Sessions
          </p>
          <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-terminal-text">Manage Cloud Sessions</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">
            Create, rename, archive, delete, and inspect the authenticated Cloud Sessions attached to this nikcli
            server.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Cloud Session title"
            className="min-h-10 rounded-[var(--radius-md)] border border-terminal-border bg-terminal-panel px-3.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
          />
          <button
            onClick={createCloudSession}
            disabled={creating}
            className="rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {creating ? "Creating..." : "New Cloud Session"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">Active</div>
          <div className="mt-2 text-3xl font-bold text-terminal-text">{activeCount}</div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">Archived</div>
          <div className="mt-2 text-3xl font-bold text-terminal-text">{archivedCount}</div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">Messages</div>
          <div className="mt-2 text-3xl font-bold text-terminal-text">
            {sessions.reduce((total, session) => total + messageCount(session), 0)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Cloud Sessions"
          className="min-h-10 flex-1 rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
        />
        <label className="flex items-center gap-2 text-sm text-terminal-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-terminal-accent"
          />
          Show archived
        </label>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : visibleSessions.length === 0 ? (
        <EmptyState onCreate={createCloudSession} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-terminal-border bg-terminal-bg/60 text-left text-[11px] uppercase tracking-[0.16em] text-terminal-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Cloud Session</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Project</th>
                <th className="px-4 py-3 text-right font-semibold">Messages</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/60">
              {visibleSessions.map((session) => {
                const status = statusFor(session, statuses[session.id])
                return (
                  <tr key={session.id} className="hover:bg-terminal-border/20">
                    <td className="px-4 py-3">
                      {editingId === session.id ? (
                        <div className="flex gap-2">
                          <input
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="min-h-9 w-full rounded-[var(--radius-sm)] border border-terminal-border bg-terminal-bg px-2 text-sm text-terminal-text outline-none focus:border-terminal-accent"
                          />
                          <button
                            onClick={() => saveTitle(session.id)}
                            className="rounded-[var(--radius-sm)] bg-terminal-accent px-3 text-xs font-semibold text-white"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="font-semibold text-terminal-text">{session.title}</div>
                          <div className="mt-0.5 font-mono text-xs text-terminal-muted">{session.id}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs text-terminal-muted">
                      {session.directory ?? "Default workspace"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-terminal-text">{messageCount(session)}</td>
                    <td className="px-4 py-3 text-terminal-muted">{formatTime(session.time?.updated)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingId(session.id)
                            setEditingTitle(session.title)
                          }}
                          className="rounded-[var(--radius-sm)] border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-text hover:bg-terminal-border/40"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => archiveSession(session)}
                          className="rounded-[var(--radius-sm)] border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-text hover:bg-terminal-border/40"
                        >
                          {session.time?.archived ? "Restore" : "Archive"}
                        </button>
                        <button
                          onClick={() => deleteSession(session.id)}
                          className="rounded-[var(--radius-sm)] border border-terminal-error/30 px-3 py-1.5 text-xs font-medium text-terminal-error hover:bg-terminal-error/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
