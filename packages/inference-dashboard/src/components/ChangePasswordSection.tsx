import { createSignal } from "solid-js"

export default function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = createSignal("")
  const [nextPassword, setNextPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const [showPasswords, setShowPasswords] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal<string | null>(null)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (nextPassword() !== confirmPassword()) {
      setError("New passwords do not match")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPassword(), nextPassword: nextPassword() }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to update password")
      setCurrentPassword("")
      setNextPassword("")
      setConfirmPassword("")
      setSuccess("Password updated")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const fieldType = () => (showPasswords() ? "text" : "password")

  return (
    <section class="app-panel app-panel-pad">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="app-kicker">Security</p>
          <h2 class="mt-2 font-display text-xl font-semibold text-terminal-text">Change password</h2>
          <p class="mt-2 text-sm leading-6 text-terminal-muted">Update the password used to access this dashboard.</p>
        </div>
        <button type="button" onClick={() => setShowPasswords(!showPasswords())} class="app-button-secondary w-full sm:w-fit">
          {showPasswords() ? "Hide" : "Show"}
        </button>
      </div>

      <form onSubmit={onSubmit} class="mt-5 grid gap-4">
        <div>
          <label class="app-label mb-1.5" for="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type={fieldType()}
            required
            autocomplete="current-password"
            value={currentPassword()}
            onInput={(e) => setCurrentPassword(e.currentTarget.value)}
            class="app-input"
          />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="app-label mb-1.5" for="new-password">
              New password
            </label>
            <input
              id="new-password"
              type={fieldType()}
              required
              minlength={8}
              autocomplete="new-password"
              value={nextPassword()}
              onInput={(e) => setNextPassword(e.currentTarget.value)}
              class="app-input"
            />
          </div>
          <div>
            <label class="app-label mb-1.5" for="confirm-password">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type={fieldType()}
              required
              minlength={8}
              autocomplete="new-password"
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              class="app-input"
            />
          </div>
        </div>

        {error() && (
          <div class="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
            <p class="text-sm text-terminal-error">{error()}</p>
          </div>
        )}
        {success() && (
          <div class="rounded-[var(--radius-md)] border border-terminal-success/30 bg-terminal-success/10 px-4 py-3">
            <p class="text-sm text-terminal-success">{success()}</p>
          </div>
        )}

        <div>
          <button type="submit" disabled={loading()} class="app-button-primary w-full sm:w-fit">
            {loading() ? "Updating" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  )
}
