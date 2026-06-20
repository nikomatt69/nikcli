import { useState, useEffect, useCallback } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { DashboardApiError, getErrorMessage, requestJson } from "../lib/studio-api"
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PageSpinner,
  btnDangerSm,
  btnGhostSm,
  btnPrimary,
  emptyIcons,
  inputClass,
} from "./ui"

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
      <EmptyState
        icon={emptyIcons.lock}
        title="Not connected"
        description="Configure server connection in Settings to manage users."
      />
    )
  }

  if (currentUser?.role !== "admin") {
    return (
      <EmptyState icon={emptyIcons.lock} title="Admin only" description="You need admin privileges to manage users." />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Users"
        title="Manage users"
        description="Manage server users and their permissions."
        actions={
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>
            {showCreate ? "Cancel" : "+ New User"}
          </button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {showCreate && (
        <Card className="space-y-4">
          <h3 className="font-semibold text-terminal-text">Create User</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className={inputClass}
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              placeholder="Email"
              className={inputClass}
            />
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="password"
              placeholder="Password (min 8 chars)"
              className={inputClass}
            />
            <input
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              placeholder="Display name (optional)"
              className={inputClass}
            />
          </div>
          <button onClick={create} disabled={busy} className={btnPrimary}>
            {busy ? "Creating…" : "Create User"}
          </button>
        </Card>
      )}

      {loading ? (
        <PageSpinner />
      ) : users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-terminal-accent/20 bg-terminal-accent/15 text-sm font-semibold text-terminal-accent">
                  {(u.displayName || u.display_name || u.username)[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-terminal-text">
                    {u.displayName || u.display_name || u.username}
                  </div>
                  <div className="truncate text-xs text-terminal-muted">{u.email}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={u.role === "admin" ? "accent" : "neutral"}>{u.role}</Badge>
                {u.id !== currentUser?.id && (
                  <>
                    <button
                      onClick={() => changeRole(u.id, u.role === "admin" ? "user" : "admin")}
                      className={btnGhostSm}
                    >
                      {u.role === "admin" ? "→ User" : "→ Admin"}
                    </button>
                    <button onClick={() => deleteUser(u.id)} className={btnDangerSm}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </Card>
          ))}
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
