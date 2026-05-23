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
  const [showPassword, setShowPassword] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [createdKey, setCreatedKey] = createSignal<IssuedKey | null>(null)

  const passwordScore = () => {
    const value = password()
    let score = 0
    if (value.length >= 8) score += 1
    if (value.length >= 12) score += 1
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1
    if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1
    return score
  }

  const passwordLabel = () => {
    if (!password()) return "Use at least 8 characters"
    if (passwordScore() <= 1) return "Weak"
    if (passwordScore() <= 3) return "Good"
    return "Strong"
  }

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
        <div class="rounded-[var(--radius-card)] border border-terminal-accent/40 bg-terminal-accent/10 p-5 shadow-soft">
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
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code class="flex-1 break-all rounded-[var(--radius-md)] border border-terminal-border bg-terminal-code px-3.5 py-2.5 font-mono text-xs text-terminal-text">
              {createdKey()!.plaintext}
            </code>
            <button onClick={() => copy(createdKey()!.plaintext)} class="app-button-primary text-xs">
              Copy
            </button>
          </div>
          <div class="mt-5 flex flex-col gap-3 sm:flex-row">
            <a href="/dashboard" class="app-button-primary flex-1">
              Go to Dashboard
            </a>
            <a href="/docs/quickstart" class="app-button-secondary">
              Read Docs
            </a>
          </div>
        </div>
      }
    >
      <form onSubmit={onSubmit} class="space-y-4">
        <div>
          <label class="app-label mb-1.5" for="signup-name">
            Name
          </label>
          <input
            id="signup-name"
            autocomplete="name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            class="app-input"
          />
        </div>
        <div>
          <label class="app-label mb-1.5" for="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            required
            autocomplete="email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="app-input"
          />
        </div>
        <div>
          <label class="app-label mb-1.5" for="signup-password">
            Password
          </label>
          <div class="relative">
            <input
              id="signup-password"
              type={showPassword() ? "text" : "password"}
              required
              minlength={8}
              autocomplete="new-password"
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
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9.9 4.2A10.6 10.6 0 0112 4c5 0 9 4 10 8a11.7 11.7 0 01-3 4.8M6.6 6.6A11.8 11.8 0 002 12c1 4 5 8 10 8a10.8 10.8 0 005.4-1.5"
                    />
                  </>
                ) : (
                  <>
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
                    />
                    <circle cx="12" cy="12" r="3" stroke-width="2" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div class="grid h-1.5 flex-1 grid-cols-4 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  class={`rounded-full ${
                    passwordScore() > i
                      ? passwordScore() <= 1
                        ? "bg-terminal-error"
                        : passwordScore() <= 3
                          ? "bg-terminal-warning"
                          : "bg-terminal-success"
                      : "bg-terminal-border"
                  }`}
                />
              ))}
            </div>
            <span class="text-left text-xs font-medium text-terminal-muted sm:min-w-[8rem] sm:text-right">
              {passwordLabel()}
            </span>
          </div>
        </div>
        {error() && (
          <div class="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
            <p class="text-sm text-terminal-error">{error()}</p>
          </div>
        )}
        <button type="submit" disabled={loading()} class="app-button-primary w-full">
          {loading() ? "Creating account…" : "Create account + get API key"}
        </button>
      </form>
    </Show>
  )
}
