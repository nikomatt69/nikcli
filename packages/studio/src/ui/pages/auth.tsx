import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

export function AuthPage() {
  const [data, { refetch }] = createResource(api.auth.list)
  const [showAdd, setShowAdd] = createSignal(false)
  const [provider, setProvider] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const add = async () => {
    if (!provider().trim() || !apiKey().trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.auth.set(provider().trim(), { type: "api", apiKey: apiKey() })
      setProvider("")
      setApiKey("")
      setShowAdd(false)
      refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: string) => {
    await api.auth.remove(p)
    refetch()
  }

  const authEntries = () => Object.entries(data()?.auth ?? {})

  return (
    <div class="page">
      <div class="page-header">
        <h1>Authentication</h1>
        <button class="btn btn-primary" onClick={() => setShowAdd(!showAdd())}>
          {showAdd() ? "Cancel" : "+ Add Provider"}
        </button>
      </div>
      <p class="page-desc">Configure API keys for AI providers.</p>

      <Show when={error()}>
        <div class="page-error" style="margin-bottom:12px">{error()}</div>
      </Show>

      <Show when={showAdd()}>
        <div class="add-form">
          <input
            class="input"
            placeholder="Provider ID (e.g. anthropic, openai, vertex)"
            value={provider()}
            onInput={(e) => setProvider(e.currentTarget.value)}
          />
          <input
            class="input"
            type="password"
            placeholder="API Key"
            value={apiKey()}
            onInput={(e) => setApiKey(e.currentTarget.value)}
          />
          <button class="btn btn-primary" disabled={busy()} onClick={add}>
            {busy() ? "Saving..." : "Save"}
          </button>
        </div>
      </Show>

      <Show when={data.loading}><Loading /></Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={authEntries()}>
            {([name, info]) => (
              <div class="card">
                <div class="card-header">
                  <div class="card-title">{name}</div>
                  <div class="card-actions">
                    <span class="tag tag-success">Configured</span>
                    <button class="btn btn-ghost btn-danger btn-sm" onClick={() => remove(name)}>Remove</button>
                  </div>
                </div>
                <div class="card-meta">
                  <span class="text-muted">{info.type}</span>
                  <Show when={info.apiKey}>
                    <code class="code-inline">{info.apiKey!.slice(0, 8)}••••••••</code>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={authEntries().length === 0}>
            <EmptyState title="No providers configured." description="Add your API keys to enable AI providers." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
