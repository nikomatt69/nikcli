import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type AgentInfo } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function AgentsPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newPrompt, setNewPrompt] = useState("")
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    setLoading(true)
    studioApi.agents
      .list()
      .then((d) => setAgents(d.agents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      await studioApi.agents.create(newName.trim(), newDesc, newPrompt)
      window.posthog?.capture("agent_created", { agent_name: newName.trim(), has_description: !!newDesc, has_prompt: !!newPrompt })
      setNewName("")
      setNewDesc("")
      setNewPrompt("")
      setShowCreate(false)
      load()
    } catch (e) {
      window.posthog?.captureException(e)
      setError(e instanceof Error ? e.message : "Create failed")
    } finally {
      setBusy(false)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Define custom AI agent behaviors</p>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-xl bg-terminal-accent px-4 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90"
        >
          {showCreate ? "Cancel" : "+ New Agent"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6 space-y-4">
          <h3 className="font-semibold text-terminal-text">New Agent</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name"
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <textarea
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            rows={6}
            placeholder="Agent system prompt..."
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-3 font-mono text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <button
            onClick={create}
            disabled={busy}
            className="rounded-xl bg-terminal-accent px-6 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create Agent"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <div className="mb-4 text-4xl">🤖</div>
          <h3 className="text-lg font-semibold text-terminal-text">No agents</h3>
          <p className="mt-2 text-sm text-terminal-muted">Create an agent to define custom AI behaviors</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.name} className="rounded-2xl border border-terminal-border bg-terminal-panel p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-terminal-text">{agent.name}</span>
                {agent.mode && (
                  <span className="rounded-full bg-terminal-border/50 px-2 py-0.5 text-xs text-terminal-muted">
                    {agent.mode}
                  </span>
                )}
                {agent.model && (
                  <span className="rounded-full bg-terminal-accent/10 px-2 py-0.5 text-xs text-terminal-accent">
                    {agent.model}
                  </span>
                )}
              </div>
              {agent.description && <p className="text-sm text-terminal-muted">{agent.description}</p>}
              {agent.path && <code className="mt-1 block text-xs text-terminal-muted">{agent.path}</code>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AgentsPage() {
  return (
    <AuthProvider>
      <AgentsPageInner />
    </AuthProvider>
  )
}
