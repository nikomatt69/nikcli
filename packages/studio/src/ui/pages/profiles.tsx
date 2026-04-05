import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

export function ProfilesPage() {
  const [data, { refetch }] = createResource(api.profiles.list)
  const [newName, setNewName] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const create = async () => {
    if (!newName().trim()) return
    setBusy(true)
    try {
      await api.profiles.create(newName().trim())
      setNewName("")
      refetch()
    } finally {
      setBusy(false)
    }
  }

  const activate = async (name: string) => {
    await api.profiles.activate(name)
    refetch()
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Profiles</h1>
        <div class="add-form" style="margin:0;flex-direction:row;align-items:center">
          <input
            class="input"
            style="width:200px"
            placeholder="New profile name"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button class="btn btn-primary" disabled={busy()} onClick={create}>Create</button>
        </div>
      </div>
      <p class="page-desc">Profiles let you switch between isolated nikcli configurations.</p>

      <Show when={data.loading}><Loading /></Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={Object.entries(data()?.profiles ?? {})}>
            {([name, profile]) => (
              <div class={`card${data()?.activeProfile === name ? " card-active" : ""}`}>
                <div class="card-header">
                  <div class="card-title">
                    {name}
                    <Show when={data()?.activeProfile === name}>
                      <span class="tag tag-active">Active</span>
                    </Show>
                  </div>
                  <div class="card-actions">
                    <Show when={data()?.activeProfile !== name}>
                      <button class="btn btn-ghost btn-sm" onClick={() => activate(name)}>Activate</button>
                    </Show>
                  </div>
                </div>
                <div class="card-meta">
                  <Show when={profile.mcpCount !== undefined}><span>MCP: {profile.mcpCount}</span></Show>
                  <Show when={profile.plugins?.length}><span>Plugins: {profile.plugins!.length}</span></Show>
                  <Show when={profile.providerCount !== undefined}><span>Providers: {profile.providerCount}</span></Show>
                </div>
              </div>
            )}
          </For>
          <Show when={Object.keys(data()?.profiles ?? {}).length === 0}>
            <EmptyState title="No profiles found." description="Create a profile to manage isolated configurations." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
