import { createResource, For, Show } from "solid-js"
import { api } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

export function BackupPage() {
  const [data, { refetch }] = createResource(api.backup.list)

  const create = async () => {
    await api.backup.create()
    refetch()
  }

  const restore = async (name: string) => {
    await api.backup.restore(name)
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Backup & Restore</h1>
        <button class="btn btn-primary" onClick={create}>Create Backup</button>
      </div>
      <p class="page-desc">Snapshots of your nikcli configuration.</p>

      <Show when={data.loading}><Loading /></Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={data()?.backups ?? []}>
            {(backup) => (
              <div class="card">
                <div class="card-header">
                  <div class="card-title">{backup.name}</div>
                  <div class="card-actions">
                    <button class="btn btn-ghost btn-sm" onClick={() => restore(backup.name)}>Restore</button>
                  </div>
                </div>
                <div class="card-meta">
                  <span class="text-muted">{new Date(backup.date).toLocaleString()}</span>
                  <Show when={backup.size}>
                    <span class="text-muted">{Math.round(backup.size! / 1024)} KB</span>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={(data()?.backups ?? []).length === 0}>
            <EmptyState title="No backups yet." description="Create a backup to snapshot your current configuration." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
