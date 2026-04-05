import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type ProfilesData } from "../lib/studio-api"

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
    studioApi.profiles
      .list()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      await studioApi.profiles.create(newName.trim())
      setNewName("")
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const activate = async (name: string) => {
    try {
      await studioApi.profiles.activate(name)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activate failed")
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">Configure server connection in Settings</p>
      </div>
    )
  }

  const profiles = Object.entries(data?.profiles ?? {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Switch between isolated nikcli configurations</p>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New profile name"
            className="rounded-xl border border-terminal-border bg-terminal-panel px-4 py-2 text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <button
            onClick={create}
            disabled={busy || !newName.trim()}
            className="rounded-xl bg-terminal-accent px-4 py-2 font-semibold text-sm text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <div className="mb-4 text-4xl">👤</div>
          <h3 className="text-lg font-semibold text-terminal-text">No profiles</h3>
          <p className="mt-2 text-sm text-terminal-muted">Create a profile to manage isolated configurations</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map(([name, profile]) => (
            <div
              key={name}
              className={`rounded-2xl border bg-terminal-panel p-5 ${data?.activeProfile === name ? "border-terminal-accent/50" : "border-terminal-border"}`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="font-semibold text-terminal-text">{name}</div>
                {data?.activeProfile === name && (
                  <span className="rounded-full bg-terminal-accent/10 px-2.5 py-0.5 text-xs font-medium text-terminal-accent">
                    Active
                  </span>
                )}
              </div>
              <div className="mb-4 flex gap-3 text-xs text-terminal-muted">
                {profile.mcpCount !== undefined && <span>MCP: {profile.mcpCount}</span>}
                {profile.plugins?.length ? <span>Plugins: {profile.plugins.length}</span> : null}
                {profile.providerCount !== undefined && <span>Providers: {profile.providerCount}</span>}
              </div>
              {data?.activeProfile !== name && (
                <button
                  onClick={() => activate(name)}
                  className="w-full rounded-lg border border-terminal-border py-1.5 text-xs font-medium text-terminal-text transition-colors hover:bg-terminal-border/50"
                >
                  Activate
                </button>
              )}
            </div>
          ))}
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
