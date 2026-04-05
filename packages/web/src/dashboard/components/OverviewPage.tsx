import { AuthProvider, useAuth } from "../auth/AuthContext"

interface StatCardProps {
  label: string
  value: string
  icon: string
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-terminal-muted">{label}</div>
          <div className="mt-1 text-2xl font-bold text-terminal-text">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-terminal-accent/10 text-xl">
          {icon}
        </div>
      </div>
    </div>
  )
}

interface QuickActionProps {
  label: string
  href: string
  icon: string
  description: string
}

function QuickAction({ label, href, icon, description }: QuickActionProps) {
  return (
    <a
      href={href}
      className="group flex flex-col gap-3 rounded-2xl border border-terminal-border bg-terminal-panel p-5 transition-all hover:border-terminal-accent/50 hover:shadow-lg"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-terminal-accent/10 text-xl transition-colors group-hover:bg-terminal-accent/20">
        {icon}
      </div>
      <div>
        <div className="font-semibold text-terminal-text">{label}</div>
        <div className="mt-1 text-sm text-terminal-muted">{description}</div>
      </div>
    </a>
  )
}

function OverviewPageInner() {
  const { user } = useAuth()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-terminal-text">
          Welcome back, {user?.displayName || user?.username || "User"}
        </h2>
        <p className="mt-1 text-terminal-muted">Here's an overview of your nikcli dashboard</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Sessions" value="0" icon="💬" />
        <StatCard label="Total Sessions" value="0" icon="📊" />
        <StatCard label="API Calls" value="0" icon="⚡" />
        <StatCard label="Storage Used" value="0 MB" icon="💾" />
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold text-terminal-text">Quick Actions</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <QuickAction label="New Session" href="/dashboard/sessions" icon="➕" description="Start a new AI session" />
          <QuickAction label="View Sessions" href="/dashboard/sessions" icon="💬" description="Browse your sessions" />
          <QuickAction label="Settings" href="/dashboard/settings" icon="⚙️" description="Configure your account" />
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold text-terminal-text">Getting Started</h3>
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terminal-accent text-sm font-bold text-white">
                1
              </div>
              <div>
                <div className="font-semibold text-terminal-text">Connect to your nikcli server</div>
                <div className="mt-1 text-sm text-terminal-muted">
                  Make sure your nikcli server is running locally or accessible via URL
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terminal-accent text-sm font-bold text-white">
                2
              </div>
              <div>
                <div className="font-semibold text-terminal-text">Start a new session</div>
                <div className="mt-1 text-sm text-terminal-muted">
                  Create a session to interact with the AI agent and work on your projects
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terminal-accent text-sm font-bold text-white">
                3
              </div>
              <div>
                <div className="font-semibold text-terminal-text">Monitor and manage</div>
                <div className="mt-1 text-sm text-terminal-muted">
                  Track your sessions, view history, and manage configurations
                </div>
              </div>
            </div>
          </div>
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
