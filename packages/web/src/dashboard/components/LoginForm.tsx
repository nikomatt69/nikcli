import { useState } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { getErrorMessage } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function LoginFormInner() {
  const { login, loading, error, serverUrl, setServerUrl } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [urlInput, setUrlInput] = useState(serverUrl || "http://localhost:4096")
  const [connectError, setConnectError] = useState<string | null>(null)

  const isConnected = isDev || !!serverUrl

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      try {
        setConnectError(null)
        setServerUrl(urlInput)
      } catch (err) {
        setConnectError(getErrorMessage(err))
      }
      return
    }
    await login(email, password)
    window.location.href = "/dashboard"
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {(connectError || error) && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {connectError || error}
        </div>
      )}

      {!isConnected && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-terminal-text">Server URL</label>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            required
            placeholder="http://localhost:4096"
            className="w-full rounded-xl border border-terminal-border bg-terminal-panel px-4 py-3 text-terminal-text placeholder:text-terminal-muted/50 focus:border-terminal-accent focus:outline-none focus:ring-2 focus:ring-terminal-accent/20"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-terminal-accent px-4 py-3 font-semibold text-white transition-colors hover:bg-terminal-accent/90"
          >
            Connect to Server
          </button>
        </div>
      )}

      {isConnected && (
        <>
          {!isDev && serverUrl && (
            <div className="flex items-center justify-between rounded-xl border border-terminal-border bg-terminal-panel px-4 py-2">
              <span className="text-xs text-terminal-muted">{serverUrl}</span>
              <button
                type="button"
                onClick={() => setServerUrl("")}
                className="text-xs text-terminal-accent hover:underline"
              >
                Change
              </button>
            </div>
          )}

          <div className="space-y-4">
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
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </>
      )}
    </form>
  )
}

export function LoginForm() {
  return (
    <AuthProvider>
      <LoginFormInner />
    </AuthProvider>
  )
}
