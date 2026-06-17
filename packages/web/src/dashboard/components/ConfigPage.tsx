import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type NikcliConfig, type ConfigPathsData } from "../lib/studio-api"
import {
  Card,
  EmptyState,
  ErrorBanner,
  NoticeBanner,
  PageHeader,
  PageSpinner,
  emptyIcons,
  inputClass,
  labelClass,
  selectClass,
} from "./ui"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function ConfigPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [config, setConfig] = useState<NikcliConfig | null>(null)
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
    Promise.all([studioApi.config.get(), studioApi.config.paths().catch(() => null)])
      .then(([cfg, p]) => {
        setConfig(cfg)
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

  if (!isConnected) {
    return (
      <EmptyState
        icon={emptyIcons.lock}
        title="Not connected"
        description="Configure server connection in Settings to edit this user's config."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Server config"
        description="Edit default models, theme, auto-update behavior, and inspect the resolved config path."
        actions={
          <span className="text-sm text-terminal-muted">
            {saving ? "Saving…" : saved ? <span className="text-terminal-success">✓ Saved</span> : " "}
          </span>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <Card>
            <h3 className="mb-4 font-display text-xl font-semibold text-terminal-text">General</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Default Model</label>
                <input
                  defaultValue={config?.model ?? ""}
                  onBlur={(e) => save({ model: e.target.value || undefined })}
                  placeholder="e.g. anthropic/claude-sonnet-4-6"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Small Model</label>
                <input
                  defaultValue={config?.small_model ?? ""}
                  onBlur={(e) => save({ small_model: e.target.value || undefined })}
                  placeholder="e.g. anthropic/claude-haiku-4-5"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Theme</label>
                <select
                  value={config?.theme ?? "default"}
                  onChange={(e) => save({ theme: e.target.value })}
                  className={selectClass}
                >
                  <option value="default">Default</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Auto-update</label>
                <select
                  value={String(config?.autoupdate ?? true)}
                  onChange={(e) =>
                    save({ autoupdate: e.target.value === "true" ? true : e.target.value === "false" ? false : "notify" })
                  }
                  className={selectClass}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                  <option value="notify">Notify only</option>
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-4 font-display text-xl font-semibold text-terminal-text">Config Path</h3>
            <input
              value={config?._path ?? paths?.detected ?? "Not found"}
              readOnly
              className={`${inputClass} cursor-default font-mono text-terminal-muted`}
            />
            {(paths?.candidates ?? []).length > 1 && (
              <p className="mt-2 text-xs text-terminal-muted">Searched: {paths?.candidates.join(", ")}</p>
            )}
          </Card>
        </>
      )}
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
