import { createSignal } from "solid-js"

export default function SignInForm() {
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
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
        <label class="block text-xs font-medium uppercase tracking-wider text-terminal-muted mb-1.5">Email</label>
        <input
          type="email"
          required
          autocomplete="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          class="w-full rounded-lg border border-terminal-border bg-terminal-panel px-3.5 py-2.5 text-sm text-terminal-text outline-none transition-all duration-150 focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20 placeholder:text-terminal-muted/50"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label class="block text-xs font-medium uppercase tracking-wider text-terminal-muted mb-1.5">Password</label>
        <input
          type="password"
          required
          autocomplete="current-password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          class="w-full rounded-lg border border-terminal-border bg-terminal-panel px-3.5 py-2.5 text-sm text-terminal-text outline-none transition-all duration-150 focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"
        />
      </div>
      {error() && (
        <div class="rounded-lg border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
          <p class="text-sm text-terminal-error">{error()}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={loading()}
        class="w-full rounded-lg bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading() ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
