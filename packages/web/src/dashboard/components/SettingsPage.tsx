import { useState } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { USER_TOKEN_KEY, getErrorMessage, normalizeServerUrl, studioApi } from "../lib/studio-api"

interface SettingsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-6">
      <div className="mb-5">
        <h3 className="font-display text-xl font-semibold text-terminal-text">{title}</h3>
        {description && <p className="mt-1 text-sm leading-6 text-terminal-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function SettingsPageInner() {
  const { user, logout, serverUrl, setServerUrl } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName || (user as any)?.display_name || "")
  const [serverUrlInput, setServerUrlInput] = useState(serverUrl || "")
  const [authToken, setAuthToken] = useState(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem(USER_TOKEN_KEY) || ""
  })
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function saveProfile() {
    if (!user) return
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const updated = await studioApi.users.update(user.id, { displayName: displayName.trim() || undefined })
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "nikcli_dashboard_user",
          JSON.stringify({ ...user, displayName: updated.display_name ?? displayName.trim() }),
        )
      }
      setNotice("Profile updated")
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function savePassword() {
    if (!user) return
    setNotice(null)
    setError(null)
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    setSaving(true)
    try {
      await studioApi.users.update(user.id, { password: newPassword })
      setNewPassword("")
      setConfirmPassword("")
      setNotice("Password updated")
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function saveServer() {
    setNotice(null)
    setError(null)
    const trimmed = serverUrlInput.trim()
    if (!trimmed) {
      setServerUrl("")
      setNotice("Server connection cleared")
      return
    }
    try {
      setServerUrl(normalizeServerUrl(trimmed))
      setNotice("Server connection updated")
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  function saveToken() {
    if (typeof window === "undefined") return
    if (authToken.trim()) localStorage.setItem(USER_TOKEN_KEY, authToken.trim())
    else localStorage.removeItem(USER_TOKEN_KEY)
    setNotice("Token updated")
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-terminal-border/60 pb-5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-terminal-accent">
          Account settings
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold text-terminal-text">User, security, and server access</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">
          Manage the authenticated dashboard user, Cloud Sessions token, server connection, and account access.
        </p>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[var(--radius-md)] border border-terminal-success/30 bg-terminal-success/10 px-4 py-3 text-sm text-terminal-success">
          {notice}
        </div>
      )}

      <SettingsSection title="Profile" description="This profile is attached to the logged-in dashboard user.">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-md)] border border-terminal-accent/25 bg-terminal-accent/10 text-2xl font-bold text-terminal-accent">
            {(displayName || user?.username || "U")[0].toUpperCase()}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                Display name
              </span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                Username
              </span>
              <input
                value={user?.username || ""}
                disabled
                className="w-full cursor-not-allowed rounded-[var(--radius-md)] border border-terminal-border bg-terminal-border/30 px-3.5 py-2.5 text-sm text-terminal-muted"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">Email</span>
              <input
                value={user?.email || ""}
                disabled
                className="w-full cursor-not-allowed rounded-[var(--radius-md)] border border-terminal-border bg-terminal-border/30 px-3.5 py-2.5 text-sm text-terminal-muted"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">Role</span>
              <input
                value={user?.role || "user"}
                disabled
                className="w-full cursor-not-allowed rounded-[var(--radius-md)] border border-terminal-border bg-terminal-border/30 px-3.5 py-2.5 text-sm text-terminal-muted"
              />
            </label>
          </div>
        </div>
        <button
          onClick={saveProfile}
          disabled={saving}
          className="mt-5 rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
        >
          Save profile
        </button>
      </SettingsSection>

      <SettingsSection title="Security" description="Rotate the password used by this dashboard account.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
              New password
            </span>
            <input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              className="w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
              Confirm password
            </span>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              className="w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={savePassword}
            disabled={saving || !newPassword || !confirmPassword}
            className="rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            Update password
          </button>
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="rounded-[var(--radius-md)] border border-terminal-border px-4 py-2.5 text-sm font-medium text-terminal-text hover:bg-terminal-border/40"
          >
            {showPassword ? "Hide passwords" : "Show passwords"}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Server & Cloud Sessions"
        description="Connect the dashboard to the nikcli server that owns your Cloud Sessions and config."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
              Server URL
            </span>
            <input
              type="url"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="http://localhost:4096"
              className="w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
              Cloud Sessions auth token
            </span>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 pr-16 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
              />
              <button
                type="button"
                onClick={() => setShowToken((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-terminal-muted hover:text-terminal-text"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={saveServer}
            className="rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90"
          >
            Save server
          </button>
          <button
            onClick={saveToken}
            className="rounded-[var(--radius-md)] border border-terminal-border px-4 py-2.5 text-sm font-medium text-terminal-text hover:bg-terminal-border/40"
          >
            Save token
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="Account" description="End the current dashboard session.">
        <button
          onClick={() => logout()}
          className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-2.5 text-sm font-semibold text-terminal-error transition-colors hover:bg-terminal-error/20"
        >
          Sign out
        </button>
      </SettingsSection>
    </div>
  )
}

export function SettingsPage() {
  return (
    <AuthProvider>
      <SettingsPageInner />
    </AuthProvider>
  )
}
