import { useState } from "react"
import { useAuth } from "../auth/AuthContext"

export function RegisterForm() {
  const { login, loading } = useAuth()
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch("/user/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Registration failed")
      await login(email, password)
      window.location.href = "/dashboard"
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="username" className="block text-sm font-medium text-terminal-text">
            Username
          </label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            placeholder="johndoe"
            className="w-full rounded-xl border border-terminal-border bg-terminal-panel px-4 py-3 text-terminal-text placeholder:text-terminal-muted/50 focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-terminal-text">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full rounded-xl border border-terminal-border bg-terminal-panel px-4 py-3 text-terminal-text placeholder:text-terminal-muted/50 focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-terminal-text">
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="••••••••"
            className="w-full rounded-xl border border-terminal-border bg-terminal-panel px-4 py-3 text-terminal-text placeholder:text-terminal-muted/50 focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-terminal-accent px-4 py-3 font-semibold text-white transition-colors hover:bg-terminal-accent/90 disabled:opacity-50"
      >
        {loading ? "Creating account..." : "Create account"}
      </button>
    </form>
  )
}
