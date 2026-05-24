import { useEffect, useMemo, useState } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import {
  getErrorMessage,
  studioApi,
  type CloudSessionInfo,
  type NikcliConfig,
  type ProfilesData,
} from "../lib/studio-api"

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">{label}</div>
      <div className="mt-2 text-3xl font-bold text-terminal-text">{value}</div>
      <div className="mt-2 text-xs text-terminal-muted">{detail}</div>
    </div>
  )
}

function QuickAction({ label, href, description }: { label: string; href: string; description: string }) {
  return (
    <a
      href={href}
      className="group rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-5 transition-colors hover:border-terminal-accent/50"
    >
      <div className="font-semibold text-terminal-text group-hover:text-terminal-accent">{label}</div>
      <div className="mt-1 text-sm leading-6 text-terminal-muted">{description}</div>
    </a>
  )
}

function OverviewPageInner() {
  const { user, token, serverUrl } = useAuth()
  const [sessions, setSessions] = useState<CloudSessionInfo[]>([])
  const [config, setConfig] = useState<NikcliConfig | null>(null)
  const [profiles, setProfiles] = useState<ProfilesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      studioApi.sessions.list({ limit: 200 }).catch(() => []),
      studioApi.config.get().catch(() => null),
      studioApi.profiles.list().catch(() => null),
    ])
      .then(([sessionList, cfg, profileData]) => {
        setSessions(sessionList)
        setConfig(cfg)
        setProfiles(profileData)
      })
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [token, serverUrl])

  const stats = useMemo(() => {
    const active = sessions.filter((session) => !session.time?.archived)
    const archived = sessions.length - active.length
    const messages = sessions.reduce((total, session) => total + (session.messageCount ?? session.messages ?? 0), 0)
    const mcpCount = Object.keys(config?.mcp ?? {}).length
    const enabledMcp = Object.values(config?.mcp ?? {}).filter((server) => server.enabled !== false).length
    const profileCount = Object.keys(profiles?.profiles ?? {}).length
    return { active: active.length, archived, messages, mcpCount, enabledMcp, profileCount }
  }, [sessions, config, profiles])

  const displayName = user?.displayName || (user as any)?.display_name || user?.username || "User"

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-terminal-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-terminal-accent">
            Studio overview
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold text-terminal-text">Welcome back, {displayName}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">
            Manage Cloud Sessions, MCP servers, profiles, skills, agents, and configuration for this authenticated user.
          </p>
        </div>
        <a
          href="/dashboard/sessions"
          className="w-fit rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terminal-accent/90"
        >
          New Cloud Session
        </a>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cloud Sessions"
          value={loading ? "..." : String(stats.active)}
          detail={`${stats.archived} archived`}
        />
        <StatCard
          label="MCP Servers"
          value={loading ? "..." : String(stats.enabledMcp)}
          detail={`${stats.mcpCount} configured`}
        />
        <StatCard
          label="Profiles"
          value={loading ? "..." : String(stats.profileCount)}
          detail={`Active: ${profiles?.activeProfile ?? "default"}`}
        />
        <StatCard
          label="Messages"
          value={loading ? "..." : stats.messages.toLocaleString()}
          detail="Across loaded Cloud Sessions"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <QuickAction
          label="Cloud Sessions"
          href="/dashboard/sessions"
          description="Create, archive, rename, and delete cloud-backed agent sessions."
        />
        <QuickAction
          label="MCP Servers"
          href="/dashboard/mcp"
          description="Add local or remote MCP servers and control whether each one is enabled."
        />
        <QuickAction
          label="Profiles"
          href="/dashboard/profiles"
          description="Switch isolated nikcli profiles and see profile-specific MCP/provider coverage."
        />
        <QuickAction
          label="Config"
          href="/dashboard/config"
          description="Edit default models, theme, auto-update behavior, providers, and config paths."
        />
        <QuickAction
          label="Skills & Agents"
          href="/dashboard/skills"
          description="Manage reusable skills, plugins, and agent definitions for this workspace."
        />
        <QuickAction
          label="Account Settings"
          href="/dashboard/settings"
          description="Update your display name, password, token, and server connection."
        />
      </div>

      <div className="rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-xl font-semibold text-terminal-text">Recent Cloud Sessions</h3>
            <p className="mt-1 text-sm text-terminal-muted">Latest sessions visible to the connected nikcli server.</p>
          </div>
          <a href="/dashboard/sessions" className="text-sm font-semibold text-terminal-accent hover:underline">
            Manage all
          </a>
        </div>
        <div className="mt-5 divide-y divide-terminal-border/60">
          {sessions.slice(0, 5).map((session) => (
            <div key={session.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-terminal-text">{session.title}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-terminal-muted">
                  {session.directory ?? session.id}
                </div>
              </div>
              <div className="shrink-0 text-xs text-terminal-muted">
                {session.time?.updated ? new Date(session.time.updated).toLocaleDateString() : "No activity"}
              </div>
            </div>
          ))}
          {!loading && sessions.length === 0 && (
            <div className="py-8 text-center text-sm text-terminal-muted">No Cloud Sessions yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export function OverviewPage() {
  return (
    <AuthProvider>
      <OverviewPageInner />
    </AuthProvider>
  )
}
