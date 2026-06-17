import { AuthProvider } from "../auth/AuthContext"

function BackupPageInner() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
      <div className="mb-4 text-4xl">💾</div>
      <h3 className="text-lg font-semibold text-terminal-text">Backups unavailable</h3>
      <p className="mt-2 max-w-sm text-sm text-terminal-muted">
        This nikcli server doesn’t expose a backup API. Manage config backups from the CLI instead.
      </p>
    </div>
  )
}

export function BackupPage() {
  return (
    <AuthProvider>
      <BackupPageInner />
    </AuthProvider>
  )
}
