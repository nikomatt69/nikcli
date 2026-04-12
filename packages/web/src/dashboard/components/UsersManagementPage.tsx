import { useState, useEffect, useCallback } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { DashboardApiError, getErrorMessage, requestJson } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

type UserProfile = {
  id: string
  username: string
  email: string
  displayName?: string | null
  display_name?: string | null
  role: "admin" | "user"
  created_at?: number
}

function UsersManagementPageInner() {
  const { user: currentUser, token, serverUrl, logout } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newDisplay, setNewDisplay] = useState("")
  const [busy, setBusy] = useState(false)

  const userReq = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!isDev && !serverUrl) throw new Error("No server configured")
      if (!token) throw new Error("Not authenticated")
      try {
        return await requestJson<T>(`/user${path}`, { ...init, token, serverUrl })
      } catch (err) {
        if (err instanceof DashboardApiError && (err.status === 401 || err.status === 403)) {
          await logout()
          throw new Error("Session expired")
        }
        throw err
      }
    },
    [serverUrl, token, logout],
  )

  const load = useCallback(() => {
    if (!token || currentUser?.role !== "admin") {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    userReq<UserProfile[]>("/list")
      .then(setUsers)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [userReq, token, currentUser?.role])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await userReq("/register", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername,
          email: newEmail,
          password: newPassword,
          displayName: newDisplay || undefined,
        }),
      })
      setNewUsername("")
      setNewEmail("")
      setNewPassword("")
      setNewDisplay("")
      setShowCreate(false)
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (id: string, role: "admin" | "user") => {
    setError(null)
    try {
      await userReq(`/${id}`, { method: "PATCH", body: JSON.stringify({ role }) })
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Update failed")
    }
  }

  const deleteUser = async (id: string) => {
    if (!confirm("Delete this user?")) return
    setError(null)
    try {
      await userReq(`/${id}`, { method: "DELETE" })
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Delete failed")
    }
  }

  if (!token || (!isDev && !serverUrl)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">Configure server connection in Settings</p>
      </div>
    )
  }

  if (currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="text-lg font-semibold text-terminal-text">Admin only</h3>
        <p className="mt-2 text-sm text-terminal-muted">You need admin privileges to manage users</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Manage server users and permissions</p>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-xl bg-terminal-accent px-4 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90"
        >
          {showCreate ? "Cancel" : "+ New User"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6 space-y-4">
          <h3 className="font-semibold text-terminal-text">Create User</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              placeholder="Email"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="password"
              placeholder="Password (min 8 chars)"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
            <input
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              placeholder="Display name (optional)"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
          </div>
          <button
            onClick={create}
            disabled={busy}
            className="rounded-xl bg-terminal-accent px-6 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create User"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-2xl border border-terminal-border bg-terminal-panel px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-terminal-accent/20 text-sm font-semibold text-terminal-accent">
                  {(u.displayName || u.display_name || u.username)[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-terminal-text">
                    {u.displayName || u.display_name || u.username}
                  </div>
                  <div className="text-xs text-terminal-muted">{u.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    u.role === "admin"
                      ? "bg-terminal-accent/10 text-terminal-accent"
                      : "bg-terminal-border/50 text-terminal-muted"
                  }`}
                >
                  {u.role}
                </span>
                {u.id !== currentUser?.id && (
                  <>
                    <button
                      onClick={() => changeRole(u.id, u.role === "admin" ? "user" : "admin")}
                      className="rounded-lg border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-text hover:bg-terminal-border/50"
                    >
                      {u.role === "admin" ? "→ User" : "→ Admin"}
                    </button>
                    <button
                      onClick={() => deleteUser(u.id)}
                      className="rounded-lg border border-terminal-error/30 px-3 py-1.5 text-xs font-medium text-terminal-error hover:bg-terminal-error/10"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!loading && users.length === 0 && (
            <div className="py-8 text-center text-sm text-terminal-muted">No users found.</div>
          )}
        </div>
      )}
    </div>
  )
}

export function UsersManagementPage() {
  return (
    <AuthProvider>
      <UsersManagementPageInner />
    </AuthProvider>
  )
}
