import { useState } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"

interface SettingsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-terminal-text">{title}</h3>
        {description && <p className="mt-1 text-sm text-terminal-muted">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function SettingsPageInner() {
  const { user, logout } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName || "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setSaved(false)
    await new Promise((r) => setTimeout(r, 500))
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Profile" description="Manage your account information">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-terminal-accent text-2xl font-bold text-white">
              {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <div className="font-semibold text-terminal-text">{user?.displayName || user?.username}</div>
              <div className="text-sm text-terminal-muted">{user?.email}</div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-terminal-border bg-terminal-panel px-4 py-3 text-terminal-text focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Username</label>
            <input
              type="text"
              value={user?.username || ""}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-terminal-border bg-terminal-border/30 px-4 py-3 text-terminal-muted"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Email</label>
            <input
              type="email"
              value={user?.email || ""}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-terminal-border bg-terminal-border/30 px-4 py-3 text-terminal-muted"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-terminal-accent px-6 py-2 font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && <span className="text-sm text-terminal-success">✓ Saved</span>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Security" description="Manage your account security">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-terminal-border p-4">
            <div>
              <div className="font-medium text-terminal-text">Password</div>
              <div className="text-sm text-terminal-muted">Last changed: never</div>
            </div>
            <button className="rounded-lg border border-terminal-border px-4 py-2 text-sm font-medium text-terminal-text transition-colors hover:bg-terminal-border/50">
              Change
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Account" description="Manage your account access">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-terminal-border p-4">
            <div>
              <div className="font-medium text-terminal-text">Role</div>
              <div className="text-sm text-terminal-muted">{user?.role || "user"}</div>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-6 py-2 font-semibold text-terminal-error transition-colors hover:bg-terminal-error/20"
          >
            Sign Out
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="Danger Zone" description="Irreversible actions">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-terminal-error/30 p-4">
            <div>
              <div className="font-medium text-terminal-error">Delete Account</div>
              <div className="text-sm text-terminal-muted">Permanently delete your account and all data</div>
            </div>
            <button className="rounded-lg border border-terminal-error/30 bg-terminal-error/10 px-4 py-2 text-sm font-medium text-terminal-error transition-colors hover:bg-terminal-error/20">
              Delete
            </button>
          </div>
        </div>
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
