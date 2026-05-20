import { createSignal, Show } from "solid-js"

interface IssuedKey {
  id: string
  plaintext: string
  prefix: string
  tier: string
  name: string
  createdAt: number
}

export default function SignUpForm() {
  const [name, setName] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [createdKey, setCreatedKey] = createSignal<IssuedKey | null>(null)

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name() || undefined, email: email(), password: password() }),
      })
      const data = (await res.json()) as { user?: unknown; apiKey?: IssuedKey; error?: string }
      if (!res.ok) throw new Error(data.error || "Sign-up failed")
      if (data.apiKey) {
        setCreatedKey(data.apiKey)
        setLoading(false)
      } else {
        window.location.href = "/dashboard"
      }
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <Show
      when={!createdKey()}
      fallback={
        <div class="rounded-xl border border-terminal-accent/40 bg-terminal-accent/10 p-5 shadow-soft">
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-5 h-5 text-terminal-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p class="text-sm font-semibold text-terminal-text">Account created!</p>
          </div>
          <p class="text-sm text-terminal-muted mb-4">Copy your API key now — it's shown only once.</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 break-all rounded-lg border border-terminal-border bg-terminal-code px-3.5 py-2.5 font-mono text-xs text-terminal-text">
              {createdKey()!.plaintext}
            </code>
            <button
              onClick={() => copy(createdKey()!.plaintext)}
              class="rounded-lg bg-terminal-accent px-4 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            >
              Copy
            </button>
          </div>
          <div class="mt-5 flex gap-3">
            <a
              href="/dashboard"
              class="flex-1 rounded-lg bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-white text-center transition-all hover:opacity-90"
            >
              Go to Dashboard
            </a>
            <a
              href="/docs/quickstart"
              class="rounded-lg border border-terminal-border bg-terminal-panel px-4 py-2.5 text-sm text-terminal-text text-center transition-all hover:bg-surface-hover"
            >
              Read Docs
            </a>
          </div>
        </div>
      }
    >
      <form onSubmit={onSubmit} class="space-y-4">
        <div>
          <label class="block text-xs font-medium uppercase tracking-wider text-terminal-muted mb-1.5">Name</label>
          <input
            autocomplete="name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            class="w-full rounded-lg border border-terminal-border bg-terminal-panel px-3.5 py-2.5 text-sm text-terminal-text outline-none transition-all duration-150 focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20 placeholder:text-terminal-muted/50"
            placeholder="John Doe"
          />
        </div>
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
          <label class="block text-xs font-medium uppercase tracking-wider text-terminal-muted mb-1.5">
            Password (8+ chars)
          </label>
          <input
            type="password"
            required
            minlength={8}
            autocomplete="new-password"
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
          {loading() ? "Creating account…" : "Create account + get API key"}
        </button>
      </form>
    </Show>
  )
}
