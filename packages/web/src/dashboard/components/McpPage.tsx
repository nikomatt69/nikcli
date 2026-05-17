import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type NikcliConfig, type McpServerConfig } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function McpPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [config, setConfig] = useState<NikcliConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState<"local" | "remote">("local")
  const [newCommand, setNewCommand] = useState("")
  const [newUrl, setNewUrl] = useState("")
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    setLoading(true)
    studioApi.config
      .get()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const toggle = async (name: string, server: McpServerConfig) => {
    try {
      await studioApi.mcp.patch(name, { enabled: server.enabled === false ? true : false })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed")
    }
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    const cfg: McpServerConfig =
      newType === "remote"
        ? { type: "remote", url: newUrl.trim(), enabled: true }
        : { type: "local", command: newCommand.trim().split(/\s+/).filter(Boolean), enabled: true }
    setBusy(true)
    try {
      await studioApi.mcp.add(name, cfg)
      window.posthog?.capture("mcp_server_added", { server_name: name, server_type: newType })
      setNewName("")
      setNewCommand("")
      setNewUrl("")
      setShowAdd(false)
      load()
    } catch (e) {
      window.posthog?.captureException(e)
      setError(e instanceof Error ? e.message : "Add failed")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return
    try {
      await studioApi.mcp.delete(name)
      window.posthog?.capture("mcp_server_removed", { server_name: name })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed")
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

  const mcpEntries = Object.entries(config?.mcp ?? {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Manage MCP server integrations</p>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 rounded-xl bg-terminal-accent px-4 py-2 font-semibold text-white transition-colors hover:bg-terminal-accent/90"
        >
          <span>{showAdd ? "Cancel" : "+ Add Server"}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6 space-y-4">
          <h3 className="font-semibold text-terminal-text">New MCP Server</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-terminal-text">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-mcp-server"
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-terminal-text">Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "local" | "remote")}
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
              >
                <option value="local">Local (command)</option>
                <option value="remote">Remote (URL)</option>
              </select>
            </div>
          </div>
          {newType === "local" ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-terminal-text">Command</label>
              <input
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                placeholder="npx -y @my/mcp-server"
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 font-mono text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-terminal-text">URL</label>
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://my-mcp.example.com/sse"
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
              />
            </div>
          )}
          <button
            onClick={add}
            disabled={busy}
            className="rounded-xl bg-terminal-accent px-6 py-2 font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add Server"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : mcpEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <div className="mb-4 text-4xl">⚡</div>
          <h3 className="text-lg font-semibold text-terminal-text">No MCP servers</h3>
          <p className="mt-2 text-sm text-terminal-muted">Add an MCP server to extend nikcli capabilities</p>
        </div>
      ) : (
        <div className="space-y-3">
          {mcpEntries.map(([name, server]) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-2xl border border-terminal-border bg-terminal-panel px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${server.enabled !== false ? "bg-terminal-success" : "bg-terminal-muted"}`}
                />
                <div>
                  <div className="font-semibold text-terminal-text">{name}</div>
                  <div className="mt-0.5 font-mono text-xs text-terminal-muted">
                    {server.type === "local" ? (server.command ?? []).join(" ") : (server.url ?? "")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${server.type === "remote" ? "bg-terminal-accent/10 text-terminal-accent" : "bg-terminal-border/50 text-terminal-muted"}`}
                >
                  {server.type}
                </span>
                <button
                  onClick={() => toggle(name, server)}
                  className="rounded-lg border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-muted transition-colors hover:bg-terminal-border/50"
                >
                  {server.enabled !== false ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => remove(name)}
                  className="rounded-lg border border-terminal-error/30 px-3 py-1.5 text-xs font-medium text-terminal-error transition-colors hover:bg-terminal-error/10"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function McpPage() {
  return (
    <AuthProvider>
      <McpPageInner />
    </AuthProvider>
  )
}
