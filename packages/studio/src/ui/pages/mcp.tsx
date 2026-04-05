import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import type { McpServerConfig } from "~/types"
import { Loading, PageError } from "~/components/loading"
import { EmptyState } from "~/components/empty"
import { Toggle } from "~/components/toggle"

export function McpPage() {
  const [config, { refetch }] = createResource(api.config.get)
  const [showAdd, setShowAdd] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newCommand, setNewCommand] = createSignal("")
  const [newUrl, setNewUrl] = createSignal("")
  const [newType, setNewType] = createSignal<"local" | "remote">("local")
  const [error, setError] = createSignal<string | null>(null)

  const mcpEntries = () => Object.entries(config()?.mcp ?? {})

  const toggle = async (name: string, server: McpServerConfig) => {
    setError(null)
    try {
      await api.mcp.patch(name, { enabled: server.enabled === false ? true : false })
      refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed")
    }
  }

  const add = async () => {
    const name = newName().trim()
    if (!name) return
    const cfg: McpServerConfig =
      newType() === "remote"
        ? { type: "remote", url: newUrl().trim(), enabled: true }
        : { type: "local", command: newCommand().trim().split(/\s+/).filter(Boolean), enabled: true }
    try {
      await api.mcp.add(name, cfg)
      setNewName("")
      setNewCommand("")
      setNewUrl("")
      setShowAdd(false)
      refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed")
    }
  }

  const remove = async (name: string) => {
    try {
      await api.mcp.delete(name)
      refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    }
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>MCP Servers</h1>
        <button class="btn btn-primary" onClick={() => setShowAdd(!showAdd())}>
          {showAdd() ? "Cancel" : "+ Add Server"}
        </button>
      </div>

      <Show when={error()}>
        <PageError message={error()!} />
      </Show>

      <Show when={showAdd()}>
        <div class="add-form">
          <div class="form-row">
            <input
              class="input"
              placeholder="Server name (e.g. filesystem)"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
            <select class="select" style="width:auto" value={newType()} onChange={(e) => setNewType(e.currentTarget.value as "local" | "remote")}>
              <option value="local">Local (command)</option>
              <option value="remote">Remote (URL)</option>
            </select>
          </div>
          <Show
            when={newType() === "local"}
            fallback={
              <input
                class="input"
                placeholder="Server URL (e.g. https://mcp.example.com/sse)"
                value={newUrl()}
                onInput={(e) => setNewUrl(e.currentTarget.value)}
              />
            }
          >
            <input
              class="input"
              placeholder="Command (e.g. npx -y @modelcontextprotocol/server-filesystem /path)"
              value={newCommand()}
              onInput={(e) => setNewCommand(e.currentTarget.value)}
            />
          </Show>
          <button class="btn btn-primary" onClick={add}>Add Server</button>
        </div>
      </Show>

      <Show when={config.loading}>
        <Loading />
      </Show>
      <Show when={config.error}>
        <PageError message={String(config.error)} />
      </Show>
      <Show when={!config.loading && !config.error}>
        <div class="card-list">
          <For each={mcpEntries()}>
            {([name, server]) => (
              <div class={`card${server.enabled === false ? " card-disabled" : ""}`}>
                <div class="card-header">
                  <div class="card-title">
                    {name}
                    <Show when={server.type}>
                      <span class="tag">{server.type}</span>
                    </Show>
                  </div>
                  <div class="card-actions">
                    <Toggle checked={server.enabled !== false} onChange={() => toggle(name, server)} />
                    <button class="btn btn-ghost btn-danger btn-sm" onClick={() => remove(name)}>Delete</button>
                  </div>
                </div>
                <div class="card-meta">
                  <Show when={server.command}>
                    <code class="code-inline">{server.command!.join(" ")}</code>
                  </Show>
                  <Show when={server.url}>
                    <code class="code-inline">{server.url}</code>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={mcpEntries().length === 0}>
            <EmptyState title="No MCP servers configured." description="Add a server to get started with MCP integrations." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
