import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type NikcliConfig, type McpServerConfig } from "../lib/studio-api"
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PageSpinner,
  btnAccentSm,
  btnDangerSm,
  btnGhostSm,
  btnPrimary,
  emptyIcons,
  inputClass,
  labelClass,
  selectClass,
} from "./ui"

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
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editCommand, setEditCommand] = useState("")
  const [editUrl, setEditUrl] = useState("")

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
      await studioApi.mcp.toggle(name, server.enabled === false ? true : false)
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

  const beginEdit = (name: string, server: McpServerConfig) => {
    setEditingName(name)
    setEditCommand(server.type === "local" ? (server.command ?? []).join(" ") : "")
    setEditUrl(server.type === "remote" ? server.url : "")
  }

  const saveEdit = async (name: string, server: McpServerConfig) => {
    setBusy(true)
    setError(null)
    try {
      const patch =
        server.type === "remote"
          ? { url: editUrl.trim() }
          : { command: editCommand.trim().split(/\s+/).filter(Boolean) }
      await studioApi.mcp.patch(name, patch as Partial<McpServerConfig>)
      setEditingName(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed")
    } finally {
      setBusy(false)
    }
  }

  if (!isConnected) {
    return (
      <EmptyState
        icon={emptyIcons.lock}
        title="Not connected"
        description="Configure server connection in Settings to manage this user's MCP servers."
      />
    )
  }

  const mcpEntries = Object.entries(config?.mcp ?? {})

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="User MCP"
        title="Manage MCP servers"
        description="Add, edit, enable, disable, or remove MCP servers from the connected nikcli user configuration."
        actions={
          <button onClick={() => setShowAdd(!showAdd)} className={btnPrimary}>
            {showAdd ? "Cancel" : "+ Add Server"}
          </button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {showAdd && (
        <Card className="space-y-4">
          <h3 className="font-semibold text-terminal-text">New MCP Server</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelClass}>Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-mcp-server"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "local" | "remote")}
                className={selectClass}
              >
                <option value="local">Local (command)</option>
                <option value="remote">Remote (URL)</option>
              </select>
            </div>
          </div>
          {newType === "local" ? (
            <div className="space-y-1.5">
              <label className={labelClass}>Command</label>
              <input
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                placeholder="npx -y @my/mcp-server"
                className={`${inputClass} font-mono`}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={labelClass}>URL</label>
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://my-mcp.example.com/sse"
                className={inputClass}
              />
            </div>
          )}
          <button onClick={add} disabled={busy} className={btnPrimary}>
            {busy ? "Adding…" : "Add Server"}
          </button>
        </Card>
      )}

      {loading ? (
        <PageSpinner />
      ) : mcpEntries.length === 0 ? (
        <EmptyState
          icon={emptyIcons.bolt}
          title="No MCP servers"
          description="Add an MCP server to extend nikcli capabilities."
        />
      ) : (
        <div className="space-y-3">
          {mcpEntries.map(([name, server]) => (
            <Card key={name} className="px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${server.enabled !== false ? "bg-terminal-success" : "bg-terminal-muted"}`}
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-terminal-text">{name}</div>
                    {editingName === name ? (
                      <input
                        value={server.type === "local" ? editCommand : editUrl}
                        onChange={(e) =>
                          server.type === "local" ? setEditCommand(e.target.value) : setEditUrl(e.target.value)
                        }
                        className={`${inputClass} mt-2 font-mono text-xs sm:min-w-[280px]`}
                      />
                    ) : (
                      <div className="mt-0.5 truncate font-mono text-xs text-terminal-muted">
                        {server.type === "local" ? (server.command ?? []).join(" ") : (server.url ?? "")}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={server.type === "remote" ? "accent" : "neutral"}>{server.type}</Badge>
                  {editingName === name ? (
                    <>
                      <button onClick={() => saveEdit(name, server)} disabled={busy} className={btnAccentSm}>
                        Save
                      </button>
                      <button onClick={() => setEditingName(null)} className={btnGhostSm}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => beginEdit(name, server)} className={btnGhostSm}>
                      Edit
                    </button>
                  )}
                  <button onClick={() => toggle(name, server)} className={btnGhostSm}>
                    {server.enabled !== false ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => remove(name)} className={btnDangerSm}>
                    Remove
                  </button>
                </div>
              </div>
            </Card>
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
