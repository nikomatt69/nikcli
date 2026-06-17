import { AuthProvider } from "../auth/AuthContext"
import { EmptyState, emptyIcons } from "./ui"

function BackupPageInner() {
  return (
    <EmptyState
      icon={emptyIcons.disk}
      title="Backups unavailable"
      description="This nikcli server doesn’t expose a backup API. Manage config backups from the CLI instead."
    />
  )
}

export function BackupPage() {
  return (
    <AuthProvider>
      <BackupPageInner />
    </AuthProvider>
  )
}
