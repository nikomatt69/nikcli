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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-terminal-muted">AI agents available on your nikcli server</p>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
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
          <p className="mt-2 text-sm text-terminal-muted">Define agents on the server with nikcli agent create</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.name} className="rounded-2xl border border-terminal-border bg-terminal-panel p-5">
              <div className="flex flex-wrap items-center gap-2 mb-1">
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
