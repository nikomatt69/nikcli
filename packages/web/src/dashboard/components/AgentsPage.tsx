import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type AgentInfo } from "../lib/studio-api"
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, PageSpinner, emptyIcons } from "./ui"

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
      <EmptyState
        icon={emptyIcons.lock}
        title="Not connected"
        description="Configure server connection in Settings to view this user's agents."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agents"
        title="AI agents"
        description="AI agents available on your nikcli server. Define new agents from the CLI with nikcli agent create."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <PageSpinner />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={emptyIcons.robot}
          title="No agents"
          description="Define agents on the server with nikcli agent create."
        />
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.name} className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-terminal-text">{agent.name}</span>
                {agent.mode && <Badge>{agent.mode}</Badge>}
                {agent.model && <Badge tone="accent">{agent.model}</Badge>}
              </div>
              {agent.description && <p className="text-sm text-terminal-muted">{agent.description}</p>}
              {agent.path && <code className="mt-1 block text-xs text-terminal-muted">{agent.path}</code>}
            </Card>
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
