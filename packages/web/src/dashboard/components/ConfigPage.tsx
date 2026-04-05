import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type NikcliConfig, type GitHubStatus, type ConfigPathsData } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function ConfigPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [config, setConfig] = useState<NikcliConfig | null>(null)
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [paths, setPaths] = useState<ConfigPathsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    Promise.all([
      studioApi.config.get(),
      studioApi.github.status().catch(() => null),
      studioApi.config.paths().catch(() => null),
    ])
      .then(([cfg, gh, p]) => {
        setConfig(cfg)
        setGhStatus(gh)
        setPaths(p)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, serverUrl])

  const save = async (patch: Partial<NikcliConfig>) => {
    setSaving(true)
    setSaved(false)
    try {
      await studioApi.config.patch(patch)
      setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const pushToGist = async () => {
    try {
      await studioApi.github.push()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed")
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Configure your nikcli server settings</p>
        {saved && <span className="text-sm text-terminal-success">✓ Saved</span>}
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
        <h3 className="mb-4 text-lg font-semibold text-terminal-text">General</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Default Model</label>
            <input
              defaultValue={config?.model ?? ""}
              onBlur={(e) => save({ model: e.target.value || undefined })}
              placeholder="e.g. anthropic/claude-sonnet-4-6"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Small Model</label>
            <input
              defaultValue={config?.small_model ?? ""}
              onBlur={(e) => save({ small_model: e.target.value || undefined })}
              placeholder="e.g. anthropic/claude-haiku-4-5"
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Theme</label>
            <select
              value={config?.theme ?? "default"}
              onChange={(e) => save({ theme: e.target.value })}
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            >
              <option value="default">Default</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-terminal-text">Auto-update</label>
            <select
              value={String(config?.autoupdate ?? true)}
              onChange={(e) =>
                save({ autoupdate: e.target.value === "true" ? true : e.target.value === "false" ? false : "notify" })
              }
              className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
              <option value="notify">Notify only</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-terminal-text">GitHub Sync</h3>
          <div className="flex items-center gap-2">
            {ghStatus?.available && (
              <span className="rounded-full bg-terminal-success/10 px-2.5 py-0.5 text-xs text-terminal-success">
                gh CLI available
              </span>
            )}
            {ghStatus?.authenticated && (
              <span className="rounded-full bg-terminal-success/10 px-2.5 py-0.5 text-xs text-terminal-success">
                {ghStatus.username}
              </span>
            )}
          </div>
        </div>
        <p className="mb-4 text-sm text-terminal-muted">
          Sync your nikcli config to a GitHub Gist for backup and portability.
        </p>
        <button
          onClick={pushToGist}
          disabled={!ghStatus?.available}
          className="rounded-xl border border-terminal-border px-5 py-2 text-sm font-medium text-terminal-text transition-colors hover:bg-terminal-border/50 disabled:opacity-40"
        >
          Push to Gist
        </button>
      </div>

      <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
        <h3 className="mb-4 text-lg font-semibold text-terminal-text">Config Path</h3>
        <input
          value={config?._path ?? paths?.detected ?? "Not found"}
          readOnly
          className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 font-mono text-sm text-terminal-muted cursor-default"
        />
        {(paths?.candidates ?? []).length > 1 && (
          <p className="mt-2 text-xs text-terminal-muted">Searched: {paths?.candidates.join(", ")}</p>
        )}
      </div>
    </div>
  )
}

export function ConfigPage() {
  return (
    <AuthProvider>
      <ConfigPageInner />
    </AuthProvider>
  )
}
