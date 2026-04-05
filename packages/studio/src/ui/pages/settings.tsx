import { createResource, createSignal, Show } from "solid-js"
import { api } from "~/api"
import type { NikcliConfig } from "~/types"
import { Loading } from "~/components/loading"

export function SettingsPage() {
  const [config, { refetch }] = createResource(api.config.get)
  const [ghStatus] = createResource(api.github.status)
  const [paths] = createResource(api.config.paths)
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  const save = async (patch: Partial<NikcliConfig>) => {
    setSaving(true)
    setSaved(false)
    try {
      await api.config.patch(patch)
      refetch()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const pushToGist = async () => {
    await api.github.push()
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Settings</h1>
        <Show when={saved()}>
          <span class="tag tag-success">Saved</span>
        </Show>
      </div>

      <Show when={config.loading}><Loading /></Show>
      <Show when={!config.loading}>
        <div class="card" style="margin-bottom:12px">
          <div class="card-header"><div class="card-title">General</div></div>
          <div class="form-grid">
            <div class="form-field">
              <label>Default Model</label>
              <input
                class="input"
                value={config()?.model ?? ""}
                onBlur={(e) => save({ model: e.currentTarget.value || undefined })}
                placeholder="e.g. anthropic/claude-sonnet-4-6"
              />
            </div>
            <div class="form-field">
              <label>Small Model</label>
              <input
                class="input"
                value={config()?.small_model ?? ""}
                onBlur={(e) => save({ small_model: e.currentTarget.value || undefined })}
                placeholder="e.g. anthropic/claude-haiku-4-5"
              />
            </div>
            <div class="form-field">
              <label>Theme</label>
              <select class="select" value={config()?.theme ?? "default"} onChange={(e) => save({ theme: e.currentTarget.value })}>
                <option value="default">Default</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div class="form-field">
              <label>Auto-update</label>
              <select
                class="select"
                value={String(config()?.autoupdate ?? true)}
                onChange={(e) => save({ autoupdate: e.currentTarget.value === "true" ? true : e.currentTarget.value === "false" ? false : "notify" })}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
                <option value="notify">Notify only</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:12px">
          <div class="card-header">
            <div class="card-title">GitHub Sync</div>
            <div class="card-actions">
              <Show when={ghStatus()?.available}>
                <span class="tag tag-success">gh CLI available</span>
              </Show>
              <Show when={ghStatus()?.authenticated}>
                <span class="tag tag-success">{ghStatus()?.username}</span>
              </Show>
            </div>
          </div>
          <p class="card-desc">Sync your nikcli config to a GitHub Gist for backup and portability.</p>
          <div class="btn-group">
            <button class="btn btn-secondary" onClick={pushToGist} disabled={!ghStatus()?.available}>
              Push to Gist
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title">Config Path</div></div>
          <div class="form-field">
            <label>Active config file</label>
            <input class="input" value={config()?._path ?? paths()?.detected ?? "Not found"} readonly />
          </div>
          <Show when={(paths()?.candidates ?? []).length > 1}>
            <p class="card-desc" style="margin-top:8px">Searched: {paths()?.candidates.join(", ")}</p>
          </Show>
        </div>
      </Show>
    </div>
  )
}
