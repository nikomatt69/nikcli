import { createSignal } from "solid-js"

export default function DeleteAccountSection() {
  const [confirming, setConfirming] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [deleted, setDeleted] = createSignal(false)

  async function onDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete account")
      }
      setDeleted(true)
      setTimeout(() => {
        window.location.href = "/"
      }, 1500)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  if (deleted()) {
    return (
      <div class="rounded-[var(--radius-card)] border border-terminal-error/30 bg-terminal-error/10 p-5">
        <p class="text-sm font-medium text-terminal-error flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          Account deleted. Redirecting
        </p>
      </div>
    )
  }

  if (!confirming()) {
    return (
      <div class="rounded-[var(--radius-card)] border border-terminal-error/30 bg-terminal-error/5 p-5">
        <p class="app-kicker text-terminal-error">Danger zone</p>
        <h2 class="mt-2 font-display text-xl font-semibold text-terminal-error">Delete account</h2>
        <p class="mt-2 text-sm leading-6 text-terminal-muted">Permanently delete your account, API keys, and usage history.</p>
        <button
          onClick={() => setConfirming(true)}
          class="app-button-danger mt-4"
        >
          Delete account
        </button>
      </div>
    )
  }

  return (
    <div class="rounded-[var(--radius-card)] border border-terminal-error bg-terminal-error/10 p-5 shadow-soft">
      <p class="app-kicker text-terminal-error">Confirm deletion</p>
      <h2 class="mt-2 font-display text-xl font-semibold text-terminal-error">Delete everything</h2>
      <p class="mt-2 text-sm text-terminal-muted">
        This will permanently delete your account, all API keys, and usage history. This action cannot be undone.
      </p>
      {error() && (
        <div class="mt-3 rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
          <p class="text-sm text-terminal-error">{error()}</p>
        </div>
      )}
      <div class="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          onClick={onDelete}
          disabled={loading()}
          class="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-terminal-error px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {loading() ? (
            <>
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Deleting…
            </>
          ) : (
            "Yes, delete everything"
          )}
        </button>
        <button
          onClick={() => setConfirming(false)}
          class="app-button-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
