import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import type { PluginInfo } from "~/types"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"
import { Modal } from "~/components/modal"

const PLUGIN_TEMPLATES = ["hooks", "watcher", "lifecycle"] as const
type PluginTemplate = (typeof PLUGIN_TEMPLATES)[number]

export function PluginsPage() {
  const [data, { refetch }] = createResource(api.plugins.list)
  const [editPlugin, setEditPlugin] = createSignal<PluginInfo | null>(null)
  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [template, setTemplate] = createSignal<PluginTemplate>("hooks")
  const [busy, setBusy] = createSignal(false)

  const openEdit = async (name: string) => {
    const plugin = await api.plugins.get(name)
    setEditPlugin(plugin)
  }

  const savePlugin = async () => {
    const plugin = editPlugin()
    if (!plugin) return
    setBusy(true)
    try {
      await api.plugins.update(plugin.name, plugin.content ?? "")
      setEditPlugin(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  const createPlugin = async () => {
    if (!newName().trim()) return
    setBusy(true)
    try {
      await api.plugins.create(newName().trim(), template())
      setNewName("")
      setShowCreate(false)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Plugins</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(!showCreate())}>
          {showCreate() ? "Cancel" : "+ New Plugin"}
        </button>
      </div>

      <Show when={showCreate()}>
        <div class="add-form">
          <input class="input" placeholder="Plugin name" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
          <select class="select" value={template()} onChange={(e) => setTemplate(e.currentTarget.value as PluginTemplate)}>
            {PLUGIN_TEMPLATES.map((t) => <option value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          <button class="btn btn-primary" disabled={busy()} onClick={createPlugin}>
            {busy() ? "Creating..." : "Create Plugin"}
          </button>
        </div>
      </Show>

      <Show when={editPlugin()}>
        <Modal
          title={`Edit Plugin: ${editPlugin()!.name}`}
          onClose={() => setEditPlugin(null)}
          wide
          footer={
            <button class="btn btn-primary" disabled={busy()} onClick={savePlugin}>
              {busy() ? "Saving..." : "Save"}
            </button>
          }
        >
          <textarea
            class="textarea mono"
            rows={24}
            value={editPlugin()!.content ?? ""}
            onInput={(e) => setEditPlugin({ ...editPlugin()!, content: e.currentTarget.value })}
          />
        </Modal>
      </Show>

      <Show when={data.loading}>
        <Loading />
      </Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={data()?.plugins ?? []}>
            {(plugin) => (
              <div class="card">
                <div class="card-header">
                  <div class="card-title">{plugin.name}</div>
                  <div class="card-actions">
                    <button class="btn btn-ghost btn-sm" onClick={() => openEdit(plugin.name)}>Edit</button>
                  </div>
                </div>
                <div class="card-meta">
                  <code class="code-inline text-xs">{plugin.path}</code>
                </div>
              </div>
            )}
          </For>
          <Show when={(data()?.plugins ?? []).length === 0}>
            <EmptyState title="No plugins found." description="Create a plugin to extend nikcli functionality." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
