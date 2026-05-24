import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { getErrorMessage, studioApi, type ProfilesData } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function ProfilesPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [data, setData] = useState<ProfilesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    studioApi.profiles
      .list()
      .then(setData)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await studioApi.profiles.create(newName.trim())
      setNewName("")
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const activate = async (name: string) => {
    setBusy(true)
    setError(null)
    try {
      await studioApi.profiles.activate(name)
      load()
    } catch (e) {
      setError(getErrorMessage(e) || "Activate failed")
    } finally {
      setBusy(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">
          Configure server connection in Settings to manage user profiles.
        </p>
      </div>
    )
  }

  const profiles = Object.entries(data?.profiles ?? {})

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-terminal-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-terminal-accent">
            Profiles
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold text-terminal-text">Manage configuration profiles</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">
            Save and switch isolated nikcli configurations, including MCP servers, providers, plugins, and model
            defaults.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="profile-name"
            className="min-h-10 rounded-[var(--radius-md)] border border-terminal-border bg-terminal-panel px-3.5 text-sm text-terminal-text outline-none focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
          />
          <button
            onClick={create}
            disabled={busy || !newName.trim()}
            className="rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create profile"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <h3 className="text-lg font-semibold text-terminal-text">No profiles</h3>
          <p className="mt-2 text-sm text-terminal-muted">Create a profile to preserve the current config snapshot.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map(([name, profile]) => {
            const active = data?.activeProfile === name
            return (
              <div
                key={name}
                className={`rounded-[var(--radius-card)] border bg-terminal-panel p-5 ${active ? "border-terminal-accent/60" : "border-terminal-border"}`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-terminal-text">{name}</div>
                    <div className="mt-1 text-xs text-terminal-muted">
                      {active ? "Currently active" : "Saved config snapshot"}
                    </div>
                  </div>
                  {active && (
                    <span className="rounded-full bg-terminal-accent/10 px-2.5 py-1 text-xs font-medium text-terminal-accent">
                      Active
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg p-3">
                    <div className="text-lg font-bold text-terminal-text">{profile.mcpCount ?? 0}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">MCP</div>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg p-3">
                    <div className="text-lg font-bold text-terminal-text">{profile.providerCount ?? 0}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Providers</div>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg p-3">
                    <div className="text-lg font-bold text-terminal-text">{profile.plugins?.length ?? 0}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Plugins</div>
                  </div>
                </div>
                {!active && (
                  <button
                    onClick={() => activate(name)}
                    disabled={busy}
                    className="mt-4 w-full rounded-[var(--radius-md)] border border-terminal-border px-4 py-2 text-sm font-medium text-terminal-text transition-colors hover:bg-terminal-border/50 disabled:opacity-50"
                  >
                    Activate profile
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ProfilesPage() {
  return (
    <AuthProvider>
      <ProfilesPageInner />
    </AuthProvider>
  )
}
