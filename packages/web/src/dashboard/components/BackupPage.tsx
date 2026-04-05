import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type BackupInfo } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function BackupPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastCreated, setLastCreated] = useState<string | null>(null)

  const load = () => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    setLoading(true)
    studioApi.backup
      .list()
      .then((d) => setBackups(d.backups))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const create = async () => {
    setBusy(true)
    try {
      const result = await studioApi.backup.create()
      setLastCreated(result.name)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed")
    } finally {
      setBusy(false)
    }
  }

  const restore = async (name: string) => {
    if (!confirm(`Restore backup "${name}"? Current config will be overwritten.`)) return
    setBusy(true)
    try {
      await studioApi.backup.restore(name)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed")
    } finally {
      setBusy(false)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Create and restore configuration backups</p>
        <button
          onClick={create}
          disabled={busy}
          className="rounded-xl bg-terminal-accent px-4 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "💾 Create Backup"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}
      {lastCreated && (
        <div className="rounded-xl border border-terminal-success/30 bg-terminal-success/10 px-4 py-3 text-sm text-terminal-success">
          ✓ Backup created: {lastCreated}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <div className="mb-4 text-4xl">💾</div>
          <h3 className="text-lg font-semibold text-terminal-text">No backups</h3>
          <p className="mt-2 text-sm text-terminal-muted">Create your first backup to protect your configuration</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <div
              key={backup.name}
              className="flex items-center justify-between rounded-2xl border border-terminal-border bg-terminal-panel px-5 py-4"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-terminal-text">{backup.name}</div>
                <div className="mt-0.5 text-xs text-terminal-muted">
                  {backup.createdAt && <span>{backup.createdAt}</span>}
                  {backup.size && <span> · {Math.round(backup.size / 1024)} KB</span>}
                </div>
              </div>
              <button
                onClick={() => restore(backup.name)}
                disabled={busy}
                className="rounded-lg border border-terminal-border px-4 py-1.5 text-xs font-medium text-terminal-text transition-colors hover:bg-terminal-border/50 disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BackupPage() {
  return (
    <AuthProvider>
      <BackupPageInner />
    </AuthProvider>
  )
}
