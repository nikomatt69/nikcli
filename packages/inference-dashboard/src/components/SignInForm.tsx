import { createSignal } from "solid-js"

export default function SignInForm() {
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [showPassword, setShowPassword] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email(), password: password() }),
      })
      const data = (await res.json()) as { user?: unknown; error?: string }
      if (!res.ok) throw new Error(data.error || "Sign-in failed")
      window.location.href = "/dashboard"
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} class="space-y-4">
      <div>
        <label class="app-label mb-1.5" for="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          type="email"
          required
          autocomplete="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          class="app-input"
        />
      </div>
      <div>
        <div class="mb-1.5 flex items-center justify-between gap-3">
          <label class="app-label" for="signin-password">
            Password
          </label>
          <a href="/sign-up" class="text-xs font-medium text-terminal-muted transition-colors hover:text-terminal-accent">
            Need a key?
          </a>
        </div>
        <div class="relative">
          <input
            id="signin-password"
            type={showPassword() ? "text" : "password"}
            required
            autocomplete="current-password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="app-input pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword())}
            class="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-terminal-muted transition-colors hover:bg-surface-hover hover:text-terminal-text"
            aria-label={showPassword() ? "Hide password" : "Show password"}
            title={showPassword() ? "Hide password" : "Show password"}
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {showPassword() ? (
                <>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.9 4.2A10.6 10.6 0 0112 4c5 0 9 4 10 8a11.7 11.7 0 01-3 4.8M6.6 6.6A11.8 11.8 0 002 12c1 4 5 8 10 8a10.8 10.8 0 005.4-1.5" />
                </>
              ) : (
                <>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" stroke-width="2" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {error() && (
        <div class="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
          <p class="text-sm text-terminal-error">{error()}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={loading()}
        class="app-button-primary w-full"
      >
        {loading() ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
