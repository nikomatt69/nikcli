import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

export function AgentsPage() {
  const [data, { refetch }] = createResource(api.agents.list)
  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newDesc, setNewDesc] = createSignal("")
  const [newPrompt, setNewPrompt] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const create = async () => {
    if (!newName().trim()) return
    setBusy(true)
    try {
      await api.agents.create(newName().trim(), newDesc(), newPrompt())
      setNewName("")
      setNewDesc("")
      setNewPrompt("")
      setShowCreate(false)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Agents</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(!showCreate())}>
          {showCreate() ? "Cancel" : "+ New Agent"}
        </button>
      </div>

      <Show when={showCreate()}>
        <div class="add-form">
          <input class="input" placeholder="Agent name" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
          <input class="input" placeholder="Description (optional)" value={newDesc()} onInput={(e) => setNewDesc(e.currentTarget.value)} />
          <textarea class="textarea" rows={6} placeholder="Agent system prompt..." value={newPrompt()} onInput={(e) => setNewPrompt(e.currentTarget.value)} />
          <button class="btn btn-primary" disabled={busy()} onClick={create}>
            {busy() ? "Creating..." : "Create Agent"}
          </button>
        </div>
      </Show>

      <Show when={data.loading}><Loading /></Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={data()?.agents ?? []}>
            {(agent) => (
              <div class="card">
                <div class="card-header">
                  <div class="card-title">
                    {agent.name}
                    <Show when={agent.mode}><span class="tag">{agent.mode}</span></Show>
                    <Show when={agent.model}><span class="tag tag-muted">{agent.model}</span></Show>
                  </div>
                </div>
                <Show when={agent.description}>
                  <p class="card-desc">{agent.description}</p>
                </Show>
                <div class="card-meta">
                  <code class="code-inline text-xs">{agent.path}</code>
                </div>
              </div>
            )}
          </For>
          <Show when={(data()?.agents ?? []).length === 0}>
            <EmptyState title="No agents found." description="Create an agent to define custom AI behaviors." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
